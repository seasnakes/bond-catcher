"""Regression coverage for slow RPC queues exhausting gateway sockets."""

import contextlib
import http.client
import importlib.util
import json
import socket
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).parents[1] / "scripts" / "qmt_compat_gateway.py"
sys.path.insert(0, str(SOURCE.parent))
SPEC = importlib.util.spec_from_file_location("gateway_capacity_test", SOURCE)
GATEWAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GATEWAY
SPEC.loader.exec_module(GATEWAY)


class SlowRpc:
    timeout_seconds = 1.0

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = []

    def call(self, method, params=None, **kwargs):
        self.calls.append((method, kwargs))
        if method == "slow":
            self.started.set()
            self.release.wait(2)
        if method == "fail":
            raise RuntimeError("upstream unavailable")
        return {"method": method}


@contextlib.contextmanager
def serving(router, **kwargs):
    server = GATEWAY.GatewayServer(("127.0.0.1", 0), router, **kwargs)
    thread = threading.Thread(
        target=lambda: server.serve_forever(poll_interval=0.01), daemon=True,
    )
    with patch.object(GATEWAY.GatewayHandler, "log_message"):
        thread.start()
        try:
            yield server
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)


def request(server):
    conn = http.client.HTTPConnection(*server.server_address, timeout=1)
    try:
        conn.request("GET", "/api/meta/health")
        response = conn.getresponse()
        response.read()
        return response.status
    finally:
        conn.close()


class GatewayCapacityTests(unittest.TestCase):
    def test_calendar_reuses_matching_ranges_and_retries_empty_or_failed_reads(self):
        class Calendar:
            calls = 0
            result = ["20260915", "20260916"]

            def get_trading_dates(self, *_args, **_kwargs):
                self.calls += 1
                if isinstance(self.result, Exception):
                    raise self.result
                return self.result

        data = Calendar()
        backend = GATEWAY.BigQmtRpcBackend(GATEWAY.GatewayConfig())
        backend._data = data
        first = backend._trading_dates("SH", "20260901", "20260916")
        first.clear()
        self.assertEqual(backend._trading_dates("SH", "20260901", "20260916"), data.result)
        self.assertEqual(data.calls, 1)
        backend._trading_dates("SZ", "20260901", "20260916")
        self.assertEqual(data.calls, 2)
        key = next(iter(backend._calendar_cache))
        stamp, values = backend._calendar_cache[key]
        backend._calendar_cache[key] = (stamp - 301, values)
        data.result = []
        self.assertEqual(backend._trading_dates("SH", "20260901", "20260916"), [])
        self.assertEqual(backend._trading_dates("SH", "20260901", "20260916"), [])
        self.assertEqual(data.calls, 4)
        data.result = TimeoutError("offline")
        with self.assertRaises(TimeoutError):
            backend._trading_dates("SH", "20260901", "20260916")
        data.result = ["20260916"]
        self.assertEqual(backend._trading_dates("SH", "20260901", "20260916"), ["20260916"])

    def test_timed_out_zmq_connection_is_replaced_without_replaying_request(self):
        try:
            import zmq
            from bigqmt_signal_trader.transports.zmq_transport import ZmqTransport
            from bigqmt_signal_trader.redis_rpc import decode_rpc_request_payload
        except ImportError:
            self.skipTest("Big QMT ZMQ package is not installed")

        ready = threading.Event()
        address = []
        identities = []
        server_errors = []

        def serve():
            context = zmq.Context()
            router = context.socket(zmq.ROUTER)
            router.setsockopt(zmq.RCVTIMEO, 2000)
            port = router.bind_to_random_port("tcp://127.0.0.1")
            address.append(f"tcp://127.0.0.1:{port}")
            ready.set()
            try:
                for index in range(2):
                    identity, payload = router.recv_multipart()
                    identities.append(identity)
                    request_data = json.loads(decode_rpc_request_payload(payload.decode()))
                    if index:
                        router.send_multipart([identity, json.dumps({
                            "request_id": request_data["request_id"],
                            "ok": True, "data": {"pong": True},
                        }).encode()])
                    # The first connection deliberately receives no reply.
            except Exception as error:
                server_errors.append(error)
            finally:
                router.close(linger=0)
                context.term()

        server = threading.Thread(target=serve, daemon=True)
        server.start()
        self.assertTrue(ready.wait(1))

        class Rpc:
            timeout_seconds = 1

            def __init__(self):
                self._transport_instance = ZmqTransport(connect_address=address[0])
                self.calls = 0

            def call(self, method, params=None, timeout_seconds=None, **kwargs):
                self.calls += 1
                return self._transport_instance.send_request({
                    "request_id": uuid.uuid4().hex, "method": method, "params": params or {},
                }, timeout_seconds)["data"]

        raw = Rpc()
        client = GATEWAY.DeadlineRpcClient(raw)
        try:
            with self.assertRaises(TimeoutError):
                client.call("ping", timeout_seconds=0.1)
            self.assertEqual(raw.calls, 1)
            self.assertEqual(client.call("ping"), {"pong": True})
        finally:
            raw._transport_instance.stop()
            server.join(3)
        self.assertFalse(server.is_alive())
        self.assertEqual(server_errors, [])
        self.assertEqual(len(identities), 2)
        self.assertNotEqual(identities[0], identities[1])

    def test_local_queue_timeout_does_not_reset_active_rpc_connection(self):
        class Transport:
            name = "zmq"

            def stop(self):
                raise AssertionError("Queue pressure must not interrupt active RPC")

        raw = SlowRpc()
        raw._transport_instance = Transport()
        client = GATEWAY.DeadlineRpcClient(raw)
        client._call_lock.acquire()
        try:
            with self.assertRaises(GATEWAY.GatewayBusy):
                client.call("ping", timeout_seconds=0.01)
        finally:
            client._call_lock.release()
        self.assertEqual(raw.calls, [])

    def test_previous_close_refresh_keeps_cached_quotes_and_status_available(self):
        started = threading.Event()
        release = threading.Event()

        class SlowHistory:
            def get_market_data_ex(self, **kwargs):
                started.set()
                release.wait(2)
                return {}

        backend = GATEWAY.BigQmtRpcBackend(GATEWAY.GatewayConfig())
        backend._data = SlowHistory()
        today = GATEWAY.dt.datetime.now(GATEWAY.CHINA_TIMEZONE).strftime("%Y%m%d")
        backend._previous_close_cache_date = today
        backend._previous_close_cache = {"110075.SH": 106.4}
        backend._previous_close_cache_checked_at = {"110075.SH": time.monotonic()}
        backend._previous_close_quote_dates = {"110075.SH": today}
        result = []
        thread = threading.Thread(
            target=lambda: result.append(backend._daily_previous_closes(["123277.SZ"])),
        )
        thread.start()
        try:
            self.assertTrue(started.wait(1))
            before = time.monotonic()
            self.assertEqual(
                backend._daily_previous_closes(["110075.SH"]),
                {"110075.SH": 106.4},
            )
            backend.previous_close_backfill_status()
            backend.raw_previous_close_status()
            self.assertLess(time.monotonic() - before, 0.5)
        finally:
            release.set()
            thread.join(2)
        self.assertEqual(result, [{}])

    def test_previous_close_refresh_queue_has_a_deadline(self):
        backend = GATEWAY.BigQmtRpcBackend(
            GATEWAY.GatewayConfig(timeout_seconds=0.03),
        )
        backend._previous_close_refresh_lock.acquire()
        try:
            before = time.monotonic()
            with self.assertRaises(GATEWAY.GatewayBusy):
                backend._daily_previous_closes(["110075.SH"])
            self.assertLess(time.monotonic() - before, 0.5)
            backend.previous_close_backfill_status()
        finally:
            backend._previous_close_refresh_lock.release()

    def test_slow_healthy_ping_does_not_disable_working_market_source(self):
        class ResponsiveRpc:
            def call(self, method, params=None, timeout_seconds=None, **kwargs):
                # Healthy replies observed at startup took over two seconds.
                if timeout_seconds < 2.1:
                    raise TimeoutError("healthy reply arrives after short probe")
                return {"pong": True}

        class OfflineBackup:
            def request(self, *_args):
                raise AssertionError("Healthy Big QMT must stay selected")

        config = GATEWAY.GatewayConfig()
        backend = GATEWAY.BigQmtRpcBackend(config)
        backend._client = ResponsiveRpc()
        backend._data = object()
        backend._trader = object()
        router = GATEWAY.BackendRouter(
            config, bigqmt=backend,
        )
        # Covers both cold discovery and subsequent health polling.
        for _ in range(2):
            self.assertEqual(
                router.request("GET", "/api/meta/health", {}, None, {})["status"],
                "ok",
            )
            self.assertEqual(router.status()["market"]["active"], "bigqmt")
            self.assertEqual(router.status()["backends"]["bigqmt"]["failures"], 0)

    def test_queued_rpc_expires_without_reaching_upstream(self):
        raw = SlowRpc()
        client = GATEWAY.DeadlineRpcClient(raw)
        thread = threading.Thread(target=lambda: client.call("slow"))
        thread.start()
        try:
            self.assertTrue(raw.started.wait(1))
            started = time.monotonic()
            with self.assertRaises(GATEWAY.GatewayBusy):
                client.call("expired", timeout_seconds=0.04)
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertEqual([method for method, _ in raw.calls], ["slow"])
        finally:
            raw.release.set()
            thread.join(2)
        self.assertEqual(client.call("ping"), {"method": "ping"})

    def test_queue_wait_reduces_remaining_upstream_budget(self):
        raw = SlowRpc()
        client = GATEWAY.DeadlineRpcClient(raw)
        client._call_lock.acquire()
        result = []
        thread = threading.Thread(
            target=lambda: result.append(client.call("ping", timeout_seconds=1)),
        )
        # A monotonic clock keeps the deadline calculation deterministic while
        # the real lock exercises admission and cleanup across threads.
        with patch.object(GATEWAY.time, "monotonic", side_effect=[10.0, 10.25, 10.3]):
            thread.start()
            client._call_lock.release()
            thread.join(2)
        self.assertEqual(result, [{"method": "ping"}])
        self.assertAlmostEqual(raw.calls[0][1]["timeout_seconds"], 0.75)

    def test_rpc_failure_releases_capacity(self):
        client = GATEWAY.DeadlineRpcClient(SlowRpc())
        with self.assertRaisesRegex(RuntimeError, "upstream unavailable"):
            client.call("fail")
        self.assertEqual(client.call("ping", timeout_seconds=0.1), {"method": "ping"})

    def test_local_queue_pressure_does_not_fail_over_or_open_circuit(self):
        class BusyBackend:
            def probe(self):
                raise GATEWAY.GatewayBusy("queue full")

            def request(self, *_args):
                raise GATEWAY.GatewayBusy("queue full")

        class Backup:
            def request(self, *_args):
                raise AssertionError("Local overload must not reach backup")

        for active in ("", "bigqmt"):
            with self.subTest(active=active):
                router = GATEWAY.BackendRouter(
                    GATEWAY.GatewayConfig(), bigqmt=BusyBackend(),
                )
                router._active_market_backend = active
                before = router.status()
                with self.assertRaises(GATEWAY.GatewayBusy):
                    router.request("GET", "/api/market/full_tick", {}, None, {})
                self.assertEqual(router.status(), before)

    def test_busy_http_server_rejects_excess_clients_then_recovers(self):
        raw = SlowRpc()

        class Router:
            def request(self, *_args):
                return raw.call("slow")

        with serving(Router(), max_active_requests=1) as server:
            result = []
            first = threading.Thread(target=lambda: result.append(request(server)))
            first.start()
            try:
                self.assertTrue(raw.started.wait(1))
                # These would each allocate a retained thread/socket in the
                # old ThreadingHTTPServer while the upstream call is blocked.
                for _ in range(40):
                    self.assertEqual(request(server), 503)
                self.assertEqual(len(raw.calls), 1)
            finally:
                raw.release.set()
                first.join(2)
            self.assertEqual(result, [200])
            self.assertEqual(request(server), 200)

    def test_incomplete_http_request_times_out_and_releases_slot(self):
        class Router:
            def request(self, *_args):
                return {"status": "ok"}

        with serving(
            Router(), max_active_requests=1, request_timeout_seconds=0.1,
        ) as server:
            with socket.create_connection(server.server_address, timeout=1) as conn:
                conn.sendall(b"GET /api/meta/health HTTP/1.1\r\nX-Partial: ")
                self.assertEqual(conn.recv(1024), b"")
            self.assertEqual(request(server), 200)

    def test_failed_thread_start_releases_slot(self):
        server = GATEWAY.GatewayServer(("127.0.0.1", 0), None, max_active_requests=1)
        try:
            with patch.object(
                GATEWAY.ThreadingHTTPServer, "process_request",
                side_effect=RuntimeError("thread unavailable"),
            ):
                with self.assertRaises(RuntimeError):
                    server.process_request(None, ("127.0.0.1", 1))
            self.assertTrue(server._request_slots.acquire(blocking=False))
            server._request_slots.release()
        finally:
            server.server_close()


if __name__ == "__main__":
    unittest.main()
