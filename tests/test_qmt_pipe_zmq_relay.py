import importlib.util
import sys
import socket
import unittest
from pathlib import Path

SOURCE = Path(__file__).parents[1] / "scripts/qmt_pipe_zmq_relay.py"
SPEC = importlib.util.spec_from_file_location("qmt_pipe_zmq_relay_test", SOURCE)
RELAY = importlib.util.module_from_spec(SPEC)
try:
    SPEC.loader.exec_module(RELAY)
except ImportError as error:
    raise unittest.SkipTest(f"Big QMT ZMQ package is not installed: {error}")


class Pipe:
    def __init__(self):
        self.calls = []

    def send_request(self, payload, timeout):
        self.calls.append((payload, timeout))
        return {"request_id": payload["request_id"], "ok": True, "data": {"pong": True}}


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.pipe = Pipe()
        self.relay = RELAY.ReadOnlyPipeRelay("test-account", self.pipe)

    def request(self, method="ping", **kwargs):
        return dict(account_id="test-account", request_id="original-id", method=method, **kwargs)

    def test_preserves_request_id_and_strips_transport_metadata(self):
        reply = self.relay.forward(self.request(_zmq_identity=b"peer"))
        self.assertEqual(reply["request_id"], "original-id")
        self.assertNotIn("_zmq_identity", self.pipe.calls[0][0])
        self.assertEqual(len(self.pipe.calls), 1)

    def test_read_aliases_are_forwarded(self):
        self.relay.forward(self.request("get_full_tick", params={"stock_list": ["000001.SH"]}))
        self.assertEqual(len(self.pipe.calls), 1)

    def test_rejects_writes_and_maintenance_before_any_pipe_request(self):
        for method in ("passorder", "submit_order", "cancel_order", "order_stock",
                       "reload_deployment", "smt_appointment", "add_sector", "unknown"):
            with self.subTest(method=method), self.assertRaises(PermissionError):
                self.relay.forward(self.request(method))
        self.assertEqual(self.pipe.calls, [])

    def test_rejects_another_account(self):
        request = self.request()
        request["account_id"] = "another-account"
        with self.assertRaises(PermissionError):
            self.relay.forward(request)
        self.assertEqual(self.pipe.calls, [])

    def test_does_not_retry_uncertain_timeout(self):
        def fail(payload, timeout):
            self.pipe.calls.append((payload, timeout))
            raise TimeoutError("unknown outcome")
        self.pipe.send_request = fail
        with self.assertRaises(TimeoutError):
            self.relay.forward(self.request())
        self.assertEqual(len(self.pipe.calls), 1)

    def test_rejects_a_mismatched_reply(self):
        self.pipe.send_request = lambda *_args: {"request_id": "another-id", "ok": True}
        with self.assertRaises(RuntimeError):
            self.relay.forward(self.request())

    def test_zmq_client_reaches_pipe_and_write_is_rejected_on_the_wire(self):
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            address = "tcp://127.0.0.1:%d" % reserve.getsockname()[1]
        server = RELAY.ZmqTransport(account_id="test-account", bind_address=address)
        client = None
        try:
            server.start_receiving(self.relay.forward, background_threads=True)
            client = RELAY.ZmqTransport(account_id="test-account", connect_address=address)
            self.assertTrue(client.send_request(self.request(), 2)["data"]["pong"])
            rejected = client.send_request(self.request("submit_order"), 2)
            self.assertFalse(rejected["ok"])
            self.assertEqual(len(self.pipe.calls), 1)
        finally:
            if client is not None:
                client.stop()
            server.stop()


if __name__ == "__main__":
    unittest.main()
