import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from test_miniqmt_dashboard_api import load_dashboard_module


class QuoteResilienceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.module = load_dashboard_module(Path(self.temp.name))
        for name, result in (
            ("quote_backend_metadata", {"active": "bigqmt"}),
            ("record_live_intraday_sample", None),
            ("persist_live_intraday_samples", None),
        ):
            patcher = mock.patch.object(self.module, name, return_value=result)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def ticks(codes):
        return {code: {"lastPrice": 123, "lastClose": 120} for code in codes}

    def test_failed_middle_batch_does_not_discard_valid_quotes(self):
        codes = [f"{600000 + i}.SH" for i in range(250)]
        bridge = mock.Mock()
        bridge.full_tick.side_effect = [
            self.ticks(codes[:100]), TimeoutError("RPC busy"), self.ticks(codes[200:]),
        ]
        with mock.patch.object(self.module.MONITOR, "BridgeClient", return_value=bridge):
            result = self.module.quotes_payload(",".join(codes))
        self.assertEqual(result["returned"], 150)
        self.assertEqual(result["failed"], codes[100:200])
        self.assertTrue(result["partial"])
        self.assertEqual(result["batch_errors"][0]["error"], "TimeoutError: RPC busy")

    def test_request_budget_stops_later_batches_without_losing_successes(self):
        codes = [f"{600000 + i}.SH" for i in range(150)]
        now = [0]
        bridge = mock.Mock()

        def slow_batch(group):
            now[0] = self.module.QUOTE_REQUEST_BUDGET_SECONDS + 1
            return self.ticks(group)

        bridge.full_tick.side_effect = slow_batch
        with (
            mock.patch.object(self.module, "time", SimpleNamespace(monotonic=lambda: now[0])),
            mock.patch.object(self.module.MONITOR, "BridgeClient", return_value=bridge),
        ):
            result = self.module.quotes_payload(",".join(codes))
        self.assertEqual(bridge.full_tick.call_count, 1)
        self.assertEqual(result["returned"], 100)
        self.assertEqual(result["failed"], codes[100:])
        self.assertEqual(result["batch_errors"][0]["error"], "quote deadline exceeded")

    def test_complete_transport_failure_remains_an_error(self):
        bridge = mock.Mock()
        bridge.full_tick.side_effect = TimeoutError("RPC busy")
        with mock.patch.object(self.module.MONITOR, "BridgeClient", return_value=bridge):
            with self.assertRaisesRegex(RuntimeError, "TimeoutError: RPC busy"):
                self.module.quotes_payload("600000.SH")

    def test_invalid_price_is_reported_as_missing(self):
        bridge = mock.Mock()
        bridge.full_tick.return_value = {
            "600000.SH": {"lastPrice": 123, "lastClose": 120},
            "600001.SH": {"lastPrice": 0, "lastClose": 120},
        }
        with mock.patch.object(self.module.MONITOR, "BridgeClient", return_value=bridge):
            result = self.module.quotes_payload("600000.SH,600001.SH")
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["failed"], ["600001.SH"])


if __name__ == "__main__":
    unittest.main()
