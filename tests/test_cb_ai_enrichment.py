import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cb_announcement import announcement_facts
from test_miniqmt_dashboard_api import load_dashboard_module


class AnnouncementTests(unittest.TestCase):
    def test_historical_ai_uses_cached_stock_when_gateway_is_down_and_keeps_terms(self):
        with tempfile.TemporaryDirectory() as directory:
            module = load_dashboard_module(Path(directory))
            class Bridge:
                def __init__(self, *args, **kwargs):
                    pass
                def get(self, *args, **kwargs):
                    raise TimeoutError("offline")
                def full_tick(self, *args):
                    raise AssertionError("historical AI must not fetch current quotes")
                def details(self, *args):
                    raise AssertionError("historical AI must not fetch current balances")
            stamp = int(datetime(2026, 9, 4, 15, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp() * 1000)
            bars = {"rows": [{"minute_ms": stamp, "close": 32.17}, {"minute_ms": stamp + 86400000, "close": 999}]}
            with ExitStack() as stack:
                stack.enter_context(patch.object(module.MONITOR, "BridgeClient", Bridge, create=True))
                stack.enter_context(patch.object(module, "china_now", return_value=datetime(2026, 9, 6, 20, tzinfo=ZoneInfo("Asia/Shanghai"))))
                stack.enter_context(patch.object(module, "load_bond_fundamentals", return_value={"123283.SZ": {"正股代码": "301459", "转股价": 35.59, "开始转股日": "20270224"}}))
                stack.enter_context(patch.object(module, "bond_tag_row", return_value={}))
                stack.enter_context(patch.object(module, "load_persisted_intraday_cache", return_value=bars))
                stack.enter_context(patch.object(module, "latest_local_redeem_status", return_value={}))
                stack.enter_context(patch.object(module, "latest_redeem_announcement", return_value={}))
                stack.enter_context(patch.object(module, "dated_bond_terms", return_value={"as_of": "20260901", "facts": {"conversion_price": 35.59}}))
                result = module.bond_metadata_payload("123283", "20260904", include_ai=True)
            self.assertEqual(result["stock_price"], 32.17)
            self.assertEqual(len(result["stock_intraday"]), 1)
            self.assertEqual(result["stock_tick"]["_source"], "本地QMT历史1m收盘")
            self.assertEqual(result["ai_terms"]["facts"]["conversion_price"], 35.59)
            self.assertFalse(result["bond_daily"])

    def test_explicit_dates_remain_distinct_and_conversion_requires_effective_date(self):
        content = "赎回日：2026年9月17日。停止交易日：2026年9月14日。停止转股日：2026年9月17日。赎回登记日：2026年9月16日。赎回价格：101.332元/张。转股价调整为6.43元/股，自2026年7月13日起生效。随后调整为5.5元/股，自2026年9月8日起生效。"
        facts = announcement_facts(content, "20260904")
        self.assertEqual(facts["redeem_date"], "20260917")
        self.assertEqual(facts["stop_trading_date"], "20260914")
        self.assertEqual(facts["record_date"], "20260916")
        self.assertEqual(facts["redeem_price"], 101.332)
        self.assertEqual(facts["conversion_price"], 6.43)
        self.assertEqual(facts["conversion_effective_from"], "20260713")
        self.assertNotIn("conversion_price", announcement_facts("转股价调整为6.43元/股", "20260904"))

    def test_announcement_date_filter_reads_all_pages_and_separates_cache_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            module = load_dashboard_module(Path(directory))
            def fetch(url):
                query = parse_qs(urlparse(url).query)
                if "/security/ann" in url:
                    return {"data": {"list": [
                        {"notice_date": "2026-09-07", "title": "关于提前赎回的第八次提示", "art_code": "future"},
                        {"notice_date": "2026-09-04", "title": "关于提前赎回的第七次提示", "art_code": "asof"},
                    ]}}
                return {"data": {"page_size": 2, "notice_content": "赎回日：2026年9月17日。" if query["page_index"] == ["1"] else "转股价调整为6.43元/股，自2026年7月13日起生效。"}}
            with patch.object(module, "fetch_external_json", side_effect=fetch):
                historical = module.latest_redeem_announcement("300112.SZ", "20260904")
                current = module.latest_redeem_announcement("300112.SZ")
            self.assertEqual(historical["article_code"], "asof")
            self.assertEqual(current["article_code"], "future")
            self.assertTrue(historical["content_complete"])
            self.assertEqual(historical["content_pages"], 2)
            self.assertEqual(historical["facts"]["conversion_price"], 6.43)

    def test_stock_minutes_do_not_accept_a_later_day_returned_by_gateway(self):
        with tempfile.TemporaryDirectory() as directory:
            module = load_dashboard_module(Path(directory))
            class Bridge:
                def get(self, *args, **kwargs):
                    return {"data": {"300112.SZ": [{"index": "20260904150000", "close": 8.79}, {"index": "20260907150000", "close": 99}]}}
            rows = module.stock_intraday_prices(Bridge(), "300112.SZ", "20260904")
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["date"], "20260904")
            self.assertGreater(rows[0]["timestamp"], 0)

    def test_historical_metadata_uses_historical_close_and_does_not_refresh_or_backfill_balance(self):
        with tempfile.TemporaryDirectory() as directory:
            module = load_dashboard_module(Path(directory))
            class Bridge:
                def __init__(self, *args, **kwargs):
                    pass
                def full_tick(self, codes):
                    return {code: {"lastPrice": 999, "timetag": "20260907 15:00:00"} for code in codes}
                def details(self, codes):
                    return {"123112.SZ": {"FloatVolume": 20000000}}
            notice = {"notice_date": "20260904", "type": "redeem", "content_complete": True, "facts": {"conversion_price": 6.43, "conversion_effective_from": "20260713", "redeem_date": "20260917"}}
            with ExitStack() as stack:
                stack.enter_context(patch.object(module.MONITOR, "BridgeClient", Bridge, create=True))
                stack.enter_context(patch.object(module, "load_bond_fundamentals", return_value={"123112.SZ": {"正股代码": "300112", "转股价": 9.13, "QMT行情时间": "20260730", "发行规模_亿元": 2.4}}))
                stack.enter_context(patch.object(module, "bond_tag_row", return_value={}))
                stack.enter_context(patch.object(module, "stock_intraday_prices", return_value=[]))
                stack.enter_context(patch.object(module, "stock_daily_closes", side_effect=lambda bridge, code, start, end: [{"date": "20260904", "close": 137.016 if code == "123112.SZ" else 8.79}]))
                stack.enter_context(patch.object(module, "latest_local_redeem_status", return_value={"status_code": "R", "trade_date": "20260904", "price_hit_count": 22}))
                stack.enter_context(patch.object(module, "latest_redeem_announcement", return_value=notice))
                refresh = stack.enter_context(patch.object(module, "refresh_daily_redeem_snapshot_if_due"))
                result = module.bond_metadata_payload("123112", "20260904")
                refresh.assert_not_called()
                self.assertEqual(result["stock_price"], 8.79)
                self.assertEqual(result["stock_trading_date"], "20260904")
                self.assertEqual(result["bond_price"], 137.016)
                self.assertIsNone(result["redeem"]["balance_condition_met"])
                self.assertAlmostEqual(result["premium_rate"], .228996587)
                self.assertTrue(result["conversion_price_reference"]["verified_by_announcement"])
                # Partial text must not relabel an old static price as newly verified.
                module.BOND_METADATA_CACHE.clear()
                notice["content_complete"] = False
                result = module.bond_metadata_payload("123112", "20260904")
                self.assertEqual(result["conversion_price"], 9.13)
                self.assertEqual(result["conversion_price_reference"]["as_of"], "20260730")
                self.assertFalse(result["conversion_price_reference"]["verified_by_announcement"])


if __name__ == "__main__":
    unittest.main()
