from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

from scripts.trading_execution import TradingError, TradingGuard


class FakeBridge:
    def __init__(self) -> None:
        self.posts = []
        self.cash = 50_000
        self.available = 100

    def get(self, path, params):
        if path.endswith("account_status"):
            return {"connected": True}
        if path.endswith("asset"):
            return {"cash": self.cash}
        if path.endswith("positions"):
            return [{"stock_code": "113707.SH", "can_use_volume": self.available}]
        if path.endswith("full_tick"):
            return {"113707.SH": {"lastPrice": 200, "upStopPrice": 240, "downStopPrice": 160}}
        if path.endswith("batch_stock_name"):
            return {"113707.SH": "科博转债"}
        if path.endswith("orders"):
            return [{
                "order_id": 99,
                "stock_code": "113707.SH",
                "instrument_name": "科博转债",
                "order_type": 23,
                "price": 200,
                "order_volume": 10,
                "traded_volume": 0,
                "order_status": 50,
            }]
        raise AssertionError(path)

    def post(self, path, payload):
        self.posts.append((path, payload))
        return {"order_id": 123, "status": "submitted"}


class TradingGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 1_785_981_600.0  # 2026-08-06 10:00:00 Asia/Shanghai
        counter = iter(f"token-{index}" for index in range(20))
        self.guard = TradingGuard(
            audit_path=Path(self.temp.name) / "audit.jsonl",
            clock=lambda: self.now,
            token_factory=lambda: next(counter),
        )
        self.bridge = FakeBridge()
        self.accounts = [{"label": "普通户", "id": "secret", "type": ""}]
        self.session = self.guard.unlock("开启实盘交易")["session_token"]

    def tearDown(self):
        self.temp.cleanup()

    def test_buy_preview_and_single_use_execute(self):
        preview = self.guard.preview_order(
            {
                "session_token": self.session,
                "account": "普通户",
                "stock_code": "113707",
                "side": "buy",
                "volume": 10,
                "price": 200,
            },
            self.accounts,
            self.bridge.get,
        )
        self.assertNotIn("account_id", preview["order"])
        result = self.guard.execute_order(
            {
                "session_token": self.session,
                "preview_token": preview["preview_token"],
                "confirmation": preview["confirmation"],
            },
            self.accounts,
            self.bridge.get,
            self.bridge.post,
        )
        self.assertEqual(result["order_id"], 123)
        self.assertEqual(len(self.bridge.posts), 1)
        with self.assertRaises(TradingError):
            self.guard.execute_order(
                {
                    "session_token": self.session,
                    "preview_token": preview["preview_token"],
                    "confirmation": preview["confirmation"],
                },
                self.accounts,
                self.bridge.get,
                self.bridge.post,
            )
        self.assertEqual(len(self.bridge.posts), 1)

    def test_rejects_price_deviation_and_sell_over_available(self):
        with self.assertRaisesRegex(TradingError, "偏离现价"):
            self.guard.preview_order(
                {
                    "session_token": self.session,
                    "account": "普通户",
                    "stock_code": "113707.SH",
                    "side": "buy",
                    "volume": 10,
                    "price": 220,
                },
                self.accounts,
                self.bridge.get,
            )
        self.bridge.available = 20
        with self.assertRaisesRegex(TradingError, "可卖数量不足"):
            self.guard.preview_order(
                {
                    "session_token": self.session,
                    "account": "普通户",
                    "stock_code": "113707.SH",
                    "side": "sell",
                    "volume": 30,
                    "price": 200,
                },
                self.accounts,
                self.bridge.get,
            )

    def test_cancel_preview_and_single_use(self):
        preview = self.guard.preview_cancel(
            {"session_token": self.session, "account": "普通户", "order_id": 99},
            self.accounts,
            self.bridge.get,
        )
        result = self.guard.execute_cancel(
            {
                "session_token": self.session,
                "preview_token": preview["preview_token"],
                "confirmation": preview["confirmation"],
            },
            self.accounts,
            self.bridge.get,
            self.bridge.post,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.bridge.posts[0][0], "/api/trading/cancel")
        with self.assertRaises(TradingError):
            self.guard.execute_cancel(
                {
                    "session_token": self.session,
                    "preview_token": preview["preview_token"],
                    "confirmation": preview["confirmation"],
                },
                self.accounts,
                self.bridge.get,
                self.bridge.post,
            )

    def test_execution_window_uses_beijing_time_on_any_host(self):
        previous = os.environ.get("TZ")
        try:
            os.environ["TZ"] = "UTC"
            time.tzset()
            self.guard._require_execution_window()
            self.now += 8 * 3600  # 18:00 Beijing, which is 10:00 in UTC
            with self.assertRaises(TradingError):
                self.guard._require_execution_window()
        finally:
            if previous is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = previous
            time.tzset()

    def test_wrong_unlock_phrase_is_rejected(self):
        with self.assertRaises(TradingError):
            self.guard.unlock("确认")


if __name__ == "__main__":
    unittest.main()
