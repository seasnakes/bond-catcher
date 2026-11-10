import importlib.util
import io
import os
import sys
import threading
import time
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "qmt_compat_gateway.py"
if str(MODULE_PATH.parent) not in sys.path:
    sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("qmt_compat_gateway", MODULE_PATH)
GATEWAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GATEWAY
SPEC.loader.exec_module(GATEWAY)

class FakeBackend:
    def __init__(self, name, result=None, error=None):
        self.name = name
        self.result = result
        self.error = error
        self.calls = []

    def request(self, method, path, query, body, headers):
        self.calls.append((method, path, query, body, headers))
        if self.error:
            raise self.error
        return self.result

class BlockingBackend(FakeBackend):
    def __init__(self, name):
        super().__init__(name)
        self.started = threading.Event()
        self.release = threading.Event()

    def request(self, method, path, query, body, headers):
        self.calls.append((method, path, query, body, headers))
        self.started.set()
        self.release.wait(timeout=1.0)
        raise TimeoutError("offline")

class FakeData:
    def get_trading_dates(self, market, start_time="", end_time="", count=-1):
        return [1788105600000, "20260901", "2026-09-02"]

    def get_stock_list_in_sector(self, name):
        self.sector_name = name
        return ["123001.SZ"]

class FakePreviousCloseData(FakeData):
    def __init__(self):
        self.daily_calls = 0
        self.shanghai_close = 3941.387

    def get_full_tick(self, stocks):
        return {
            "000001.SH": {"lastPrice": 3961.582, "lastClose": 3979.8877},
            "399006.SZ": {"lastPrice": 3347.253, "lastClose": 3393.4296},
            "000680.SH": {"lastPrice": 1911.199, "lastClose": 1933.1382},
            "123270.SZ": {"lastPrice": 235.28, "lastClose": 225.88},
        }

    def get_market_data_ex(self, **_kwargs):
        self.daily_calls += 1
        return {
            "000001.SH": [
                {"index": "20260901", "close": 3979.888},
                {"index": "20260902", "close": self.shanghai_close},
            ],
            "399006.SZ": [
                {"index": "20260901", "close": 0.0},
                {"index": "20260902", "close": 3312.243},
            ],
            "000680.SH": [
                {"index": "20260901", "close": 0.0},
                {"index": "20260902", "close": 1906.639},
            ],
            "123270.SZ": [
                {"index": "20260902", "close": 230.474},
            ],
        }

class GatewayTests(unittest.TestCase):
    def test_unsupported_optional_api_does_not_disable_bigqmt_quotes(self):
        big = FakeBackend("bigqmt", error=GATEWAY.UnsupportedEndpoint("sector list unsupported"))
        router = GATEWAY.BackendRouter(self.config(), bigqmt=big)
        with self.assertRaises(GATEWAY.UnsupportedEndpoint):
            router.request("GET", "/api/sector/list", {}, None, {})
        self.assertEqual(router.status()["backends"]["bigqmt"]["circuit_open_seconds"], 0)
        big.error = None
        big.result = {"data": {"123247.SZ": {"lastPrice": 208.5}}}
        quote = router.request("GET", "/api/market/full_tick", {"stocks": "123247.SZ"}, None, {})
        self.assertEqual(quote["data"]["123247.SZ"]["lastPrice"], 208.5)
        self.assertEqual(set(router.backends), {"bigqmt"})

    def test_weekend_and_mixed_stale_quotes_use_their_own_session_reference(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        class Data:
            def get_market_data_ex(self, **kwargs):
                return {code: [
                    {"index": "20260902", "close": 200.797},
                    {"index": "20260903", "close": 211.888},
                    {"index": "20260904", "close": 208.5},
                ] for code in kwargs["stock_list"]}
        backend._data = Data()
        result = backend._correct_previous_closes({
            "123247.SZ": {"lastPrice": 208.5, "lastClose": 0, "timetag": "20260904 15:00:00"},
            "123270.SZ": {"lastPrice": 211.888, "lastClose": 0, "timetag": "20260903 15:00:00"},
        }, ["123247.SZ", "123270.SZ"])
        self.assertEqual(result["123247.SZ"]["lastClose"], 211.888)
        self.assertEqual(result["123270.SZ"]["lastClose"], 200.797)
        # The same symbol rolls into a new quote session without a stale cache hit.
        next_session = backend._correct_previous_closes({
            "123247.SZ": {"lastPrice": 210, "lastClose": 0, "timetag": "20260907 09:31:00"},
        }, ["123247.SZ"])
        self.assertEqual(next_session["123247.SZ"]["lastClose"], 208.5)

    def config(self, **changes):
        values = dict(
            market_backend="bigqmt",
            trading_backend="disabled",
            circuit_cooldown_seconds=60.0,
        )
        values.update(changes)
        return GATEWAY.GatewayConfig(**values)

    def test_retired_settings_and_saved_selection_never_restore_miniqmt(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "market.json"
            target.write_text('{"market_backend":"miniqmt"}')
            for old_mode in ("auto", "miniqmt", "bigqmt"):
                config = self.config(market_backend=old_mode, trading_backend="miniqmt",
                                     market_selection_path=str(target))
                big = FakeBackend("bigqmt", error=TimeoutError("offline"))
                router = GATEWAY.BackendRouter(config, bigqmt=big)
                self.assertEqual(router.status()["market"]["configured"], "bigqmt")
                self.assertEqual(router.status()["trading"]["configured"], "disabled")
                self.assertEqual(set(router.backends), {"bigqmt"})
                with self.assertRaises(TimeoutError):
                    router.request("GET", "/api/market/full_tick", {}, None, {})
                self.assertEqual(len(big.calls), 1)

    def test_removed_selections_are_rejected_without_upstream_calls(self):
        big = FakeBackend("bigqmt")
        router = GATEWAY.BackendRouter(self.config(), bigqmt=big)
        for selection in ("miniqmt", "auto", None):
            with self.assertRaises(GATEWAY.GatewayError) as caught:
                router.select_market_backend({"market_backend": selection}, {})
            self.assertEqual(caught.exception.status, 400)
        self.assertEqual(big.calls, [])

    def test_bigqmt_selection_checks_quotes_and_preserves_disabled_trading(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "market.json"
            ticks = {"data": {code: {"lastPrice": 100} for code in ("000001.SH", "123247.SZ")}}
            big = FakeBackend("bigqmt", result=ticks)
            router = GATEWAY.BackendRouter(self.config(market_selection_path=str(target)), bigqmt=big)
            result = router.select_market_backend({"market_backend": "bigqmt"}, {})
            self.assertEqual(result["market"]["active"], "bigqmt")
            self.assertEqual(result["trading"]["configured"], "disabled")
            self.assertIn('"bigqmt"', target.read_text())
            big.result = {"data": {}}
            with self.assertRaises(GATEWAY.GatewayError):
                router.select_market_backend({"market_backend": "bigqmt"}, {})
            self.assertEqual(router.status(), result)

    def test_disabled_trading_never_contacts_any_backend(self):
        big = FakeBackend("bigqmt")
        router = GATEWAY.BackendRouter(self.config(), bigqmt=big)
        for path in GATEWAY.TRADING_READ_PATHS | GATEWAY.TRADING_WRITE_PATHS:
            with self.assertRaises(GATEWAY.GatewayError) as caught:
                router.request("GET" if path in GATEWAY.TRADING_READ_PATHS else "POST", path, {}, {}, {})
            self.assertEqual(caught.exception.status, 503)
        self.assertEqual(big.calls, [])

    def test_trading_requires_matching_api_key(self):
        big = FakeBackend("bigqmt", result={"data": []})
        router = GATEWAY.BackendRouter(self.config(api_key="secret", trading_backend="bigqmt"), bigqmt=big)
        with self.assertRaises(GATEWAY.GatewayError) as caught:
            router.request("GET", "/api/trading/orders", {}, None, {})
        self.assertEqual(caught.exception.status, 401)
        result = router.request("GET", "/api/trading/orders", {}, None, {"x-api-key": "secret"})
        self.assertEqual(result, {"data": []})

    def test_calendar_mapping_matches_existing_http_contract(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        backend._client = object()
        backend._data = FakeData()
        backend._trader = object()

        result = backend.request(
            "GET",
            "/api/calendar/prev_trading_date",
            {"date": "20260902", "market": "SH"},
            None,
            {},
        )
        self.assertEqual(
            GATEWAY.compact_date(result["prev_trading_date"]), "20260901"
        )

    def test_calendar_confirms_missing_today_with_traded_index_and_keeps_previous_day(self):
        from unittest.mock import Mock
        now = GATEWAY.dt.datetime(2026, 9, 17, 9, 40, tzinfo=GATEWAY.CHINA_TIMEZONE)
        tick = {"time": int(now.timestamp() * 1000), "lastPrice": 3898,
                "amount": 1000000, "volume": 1000}
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        backend._client = backend._trader = object()
        backend._data = Mock()
        backend._data.get_trading_dates.return_value = ["20260916"]
        backend._data.get_full_tick.return_value = {"000001.SH": tick}
        with patch.object(GATEWAY.dt, "datetime", wraps=GATEWAY.dt.datetime) as clock:
            clock.now.return_value = now
            def request(path, date="20260917", market="SH"):
                return backend.request("GET", "/api/calendar/" + path,
                                       {"date": date, "market": market}, None, {})
            self.assertTrue(request("is_trading_date")["is_trading"])
            self.assertTrue(request("is_trading_date")["is_trading"])
            backend._data.get_full_tick.assert_called_once_with(["000001.SH"])
            previous = request("prev_trading_date")["prev_trading_date"]
            self.assertEqual(GATEWAY.compact_date(previous), "20260916")
            # Historical gaps do not borrow today's trade, and SZ uses its own index.
            self.assertFalse(request("is_trading_date", "20260915")["is_trading"])
            backend._data.get_full_tick.return_value = {"399001.SZ": tick}
            self.assertTrue(request("is_trading_date", market="SZ")["is_trading"])
            backend._data.get_full_tick.assert_called_with(["399001.SZ"])

    def test_calendar_trade_evidence_rejects_stale_future_preopen_and_empty_ticks(self):
        now = GATEWAY.dt.datetime(2026, 9, 17, 10, 0, tzinfo=GATEWAY.CHINA_TIMEZONE)
        tick = {"time": int(now.timestamp() * 1000), "lastPrice": 3898,
                "amount": 1000000, "volume": 1000}
        self.assertTrue(GATEWAY.has_current_session_trade(tick, now))
        # A morning trade remains proof of the date during lunch and after close.
        self.assertTrue(GATEWAY.has_current_session_trade(tick, now.replace(hour=16)))
        for change in [
            {"time": int(now.replace(day=16).timestamp() * 1000)},
            {"time": int(now.replace(hour=11).timestamp() * 1000)},
            {"time": int(now.replace(hour=9, minute=25).timestamp() * 1000)},
            {"time": int(now.replace(hour=12).timestamp() * 1000)},
            {"time": None}, {"time": "garbage"}, {"time": 1e40},
            {"time": float("nan")}, {"lastPrice": 0}, {"lastPrice": True},
            {"amount": 0}, {"volume": 0}, {"amount": float("inf")},
        ]:
            with self.subTest(change=change):
                self.assertFalse(GATEWAY.has_current_session_trade({**tick, **change}, now))
        self.assertFalse(GATEWAY.has_current_session_trade(None, now))

    def test_empty_calendar_and_unconfirmed_quote_are_retried_after_open(self):
        from unittest.mock import Mock
        now = GATEWAY.dt.datetime(2026, 9, 17, 9, 29, tzinfo=GATEWAY.CHINA_TIMEZONE)
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        backend._data = Mock()
        backend._data.get_trading_dates.return_value = []
        backend._data.get_full_tick.return_value = {}
        with patch.object(GATEWAY.dt, "datetime", wraps=GATEWAY.dt.datetime) as clock:
            clock.now.return_value = now
            self.assertEqual(backend._trading_dates("SH", "20260917", "20260917"), [])
            backend._data.get_full_tick.assert_not_called()
            clock.now.return_value = now.replace(minute=31)
            self.assertEqual(backend._trading_dates("SH", "20260917", "20260917"), [])
            backend._data.get_full_tick.return_value = {"000001.SH": {
                "time": int(clock.now.return_value.timestamp() * 1000),
                "lastPrice": 3898, "amount": 1000000, "volume": 1000}}
            self.assertEqual(backend._trading_dates("SH", "20260917", "20260917"), ["20260917"])
            self.assertEqual(backend._data.get_trading_dates.call_count, 3)

    def test_minute_history_rejects_suspended_placeholders_but_keeps_real_flat_bars(self):
        from unittest.mock import Mock
        base = {"time": 1788489660000, "open": 561, "high": 561,
                "low": 561, "close": 561, "volume": 0, "amount": 0,
                "suspendFlag": 1}
        good = {**base, "suspendFlag": 0}
        traded = {**base, "volume": 5, "amount": 28050}
        empty = {**base, "open": 0, "high": 0, "low": 0, "close": 0}
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        backend._client = backend._trader = object()
        backend._data = Mock()
        backend._data.get_market_data_ex.return_value = {"127037.SZ": [base, empty, good, traded]}
        result = backend.request("GET", "/api/market/market_data_ex", {"period": "1m"}, None, {})
        self.assertEqual(len(result["data"]["127037.SZ"]), 2)
        self.assertEqual(result["data"]["127037.SZ"][0]["_minute_start_ms"], 1788489600000)
        self.assertEqual(result["data_quality"]["rejected_suspended_placeholders"], {"127037.SZ": 2})
        backend._data.get_market_data_ex.return_value = {"127037.SZ": [base]}
        daily = backend.request("GET", "/api/market/market_data_ex", {"period": "1d"}, None, {})
        self.assertEqual(daily, {"data": {"127037.SZ": [base]}})

    def test_bigqmt_uses_broker_convertible_bond_sector_name(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        data = FakeData()
        backend._client = object()
        backend._data = data
        backend._trader = object()

        result = backend.request("GET", "/api/cb/list", {}, None, {})

        self.assertEqual(data.sector_name, "沪深转债")
        self.assertEqual(result, {"count": 1, "stocks": ["123001.SZ"]})

    def test_bigqmt_ticks_use_latest_completed_daily_close(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        data = FakePreviousCloseData()
        backend._client = object()
        backend._data = data
        backend._trader = object()

        query = {"stocks": "000001.SH,399006.SZ,000680.SH,123270.SZ"}
        first = backend.request("GET", "/api/market/full_tick", query, None, {})
        second = backend.request("GET", "/api/market/full_tick", query, None, {})

        self.assertEqual(first["data"]["000001.SH"]["lastClose"], 3941.387)
        self.assertEqual(first["data"]["399006.SZ"]["lastClose"], 3312.243)
        self.assertEqual(first["data"]["000680.SH"]["lastClose"], 1906.639)
        self.assertEqual(first["data"]["123270.SZ"]["lastClose"], 230.474)
        self.assertEqual(
            first["data"]["000001.SH"]["lastSettlementPrice"], 3941.387
        )
        self.assertEqual(second["data"], first["data"])
        self.assertEqual(data.daily_calls, 1)

    def test_bigqmt_previous_close_cache_is_revalidated(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        data = FakePreviousCloseData()
        backend._client = object()
        backend._data = data
        backend._trader = object()

        query = {"stocks": "000001.SH"}
        first = backend.request("GET", "/api/market/full_tick", query, None, {})
        data.shanghai_close = 3942.5
        cached = backend.request("GET", "/api/market/full_tick", query, None, {})
        backend._previous_close_cache_checked_at["000001.SH"] -= (
            GATEWAY.PREVIOUS_CLOSE_CACHE_TTL_SECONDS + 1
        )
        refreshed = backend.request("GET", "/api/market/full_tick", query, None, {})

        self.assertEqual(first["data"]["000001.SH"]["lastClose"], 3941.387)
        self.assertEqual(cached["data"]["000001.SH"]["lastClose"], 3941.387)
        self.assertEqual(refreshed["data"]["000001.SH"]["lastClose"], 3942.5)
        self.assertEqual(data.daily_calls, 2)

    def test_bigqmt_marks_broad_raw_previous_close_mismatch_as_stale(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        codes = [f"{600000 + index:06d}.SH" for index in range(20)]
        ticks = {
            code: {"lastPrice": 11.0, "lastClose": 9.0}
            for code in codes
        }
        daily_closes = {code: 10.0 for code in codes}

        backend._record_raw_previous_close_health(ticks, codes, daily_closes)

        status = backend.raw_previous_close_status()
        self.assertEqual(status["status"], "stale")
        self.assertEqual(status["checked_codes"], 20)
        self.assertEqual(status["mismatched_codes"], 20)
        self.assertEqual(status["mismatch_ratio"], 1.0)
        self.assertTrue(status["restart_recommended"])

    def test_bigqmt_does_not_treat_native_ex_dividend_reference_as_stale(self):
        backend = GATEWAY.BigQmtRpcBackend(self.config())
        ticks = {
            "002709.SZ": {
                "lastPrice": 34.6,
                "lastClose": 34.34,
                "_bigqmtQuoteChannel": "native_xtdata",
            }
        }

        backend._record_raw_previous_close_health(
            ticks,
            ["002709.SZ"],
            {"002709.SZ": 34.44},
        )

        self.assertEqual(
            backend.raw_previous_close_status()["status"],
            "unknown",
        )

    def test_latest_completed_close_excludes_current_day_bar(self):
        result = GATEWAY.latest_completed_closes(
            {
                "000001.SH": [
                    {"index": "20260902", "close": 3941.387},
                    {"index": "20260903", "close": 3999.999},
                ]
            },
            ["000001.SH"],
            "20260903",
        )

        self.assertEqual(result, {"000001.SH": 3941.387})

    def test_missing_daily_bar_does_not_replace_live_previous_close(self):
        from unittest.mock import Mock

        backend = GATEWAY.BigQmtRpcBackend(self.config())
        backend._client = backend._trader = object()
        backend._data = Mock()
        backend._data.get_full_tick.return_value = {
            "301628.SZ": {
                "lastPrice": 122.03,
                "lastClose": 119.86,
                "timetag": "20260923 10:43:42",
            }
        }
        backend._data.get_market_data_ex.return_value = {
            "301628.SZ": [
                {"index": "20260921", "close": 114.09,
                 "preClose": 115.00, "volume": 30217, "amount": 345369648},
                {"index": "20260922", "close": 114.09,
                 "preClose": 0, "volume": 0, "amount": 0},
            ]
        }

        tick = backend.request(
            "GET", "/api/market/full_tick", {"stocks": "301628.SZ"}, None, {}
        )["data"]["301628.SZ"]

        self.assertEqual(tick["lastClose"], 119.86)
        self.assertEqual(tick["previousCloseSource"], "bigqmt_context_tick")
        self.assertEqual(
            backend._data.get_market_data_ex.call_args.kwargs["fill_data"], False
        )

    def test_environment_rejects_trading_auto(self):
        old = os.environ.get("FINANCE_QMT_TRADING_BACKEND")
        os.environ["FINANCE_QMT_TRADING_BACKEND"] = "auto"
        try:
            with self.assertRaises(ValueError):
                GATEWAY.GatewayConfig.from_env()
        finally:
            if old is None:
                os.environ.pop("FINANCE_QMT_TRADING_BACKEND", None)
            else:
                os.environ["FINANCE_QMT_TRADING_BACKEND"] = old

    def test_formula_host_defaults_to_bigqmt_zmq_host(self):
        old_zmq = os.environ.get("FINANCE_BIGQMT_ZMQ_ADDRESS")
        old_formula = os.environ.pop("FINANCE_BIGQMT_FORMULA_HOST", None)
        os.environ["FINANCE_BIGQMT_ZMQ_ADDRESS"] = "tcp://192.0.2.7:15588"
        try:
            config = GATEWAY.GatewayConfig.from_env()
            self.assertEqual(config.bigqmt_formula_host, "192.0.2.7")
            self.assertEqual(config.bigqmt_formula_port, 58600)
        finally:
            if old_zmq is None:
                os.environ.pop("FINANCE_BIGQMT_ZMQ_ADDRESS", None)
            else:
                os.environ["FINANCE_BIGQMT_ZMQ_ADDRESS"] = old_zmq
            if old_formula is not None:
                os.environ["FINANCE_BIGQMT_FORMULA_HOST"] = old_formula

    def test_request_log_does_not_include_query_parameters(self):
        handler = object.__new__(GATEWAY.GatewayHandler)
        handler.path = "/api/trading/asset?account_id=sensitive"
        handler.command = "GET"
        handler.client_address = ("127.0.0.1", 12345)
        handler.log_date_time_string = lambda: "now"
        output = io.StringIO()
        old_stdout = sys.stdout
        try:
            sys.stdout = output
            handler.log_message(
                '"%s" %s %s',
                "GET /api/trading/asset?account_id=sensitive HTTP/1.1",
                "200",
                "-",
            )
        finally:
            sys.stdout = old_stdout
        self.assertIn("GET /api/trading/asset 200", output.getvalue())
        self.assertNotIn("sensitive", output.getvalue())
        self.assertNotIn("account_id", output.getvalue())

if __name__ == "__main__":
    unittest.main()
