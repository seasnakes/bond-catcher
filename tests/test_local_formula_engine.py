import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.convertible_bond_reference import active_reference_rows
from lib.local_formula_engine import (
    ema,
    evaluate_latest,
    evaluate_latest_with_diagnostics,
    single_needle,
    sma,
)


class LocalFormulaEngineTests(unittest.TestCase):
    def test_tdx_sma_and_ema_seed_from_first_value(self):
        self.assertEqual(sma([3.0, 6.0, 9.0], 3, 1), [3.0, 4.0, 5.666666666666667])
        self.assertEqual(ema([3.0, 6.0, 9.0], 3), [3.0, 4.5, 6.75])

    def test_single_needle_uses_3_and_21_bar_ranges(self):
        rows = []
        for index in range(21):
            close = 110.0
            low = 105.0
            if index == 0:
                low = 100.0
            if index == 18:
                close = 130.0
                low = 123.0
            if index == 19:
                close = 128.0
                low = 123.0
            if index == 20:
                close = 124.0
                low = 123.0
            rows.append({"open": close, "high": close + 1, "low": low, "close": close, "volume": 1000 + index, "amount": 1})
        self.assertTrue(single_needle(rows)[-1])

    def test_diagnostics_expose_formula_threshold_inputs(self):
        rows = [
            {"open": 10, "high": 10, "low": 9, "close": 10, "volume": 100, "amount": 1000}
            for _ in range(21)
        ]
        rows[-3]["low"] = 8
        rows[-2]["close"] = 12
        rows[-1]["close"] = 9

        signals, diagnostics = evaluate_latest_with_diagnostics(rows)

        self.assertEqual(signals["单针"], diagnostics["单针"]["selected"])
        self.assertIn("short", diagnostics["单针"])
        self.assertIn("long", diagnostics["单针"])
        self.assertEqual(signals["异动"], diagnostics["异动"]["selected"])
        self.assertIn("high_low_ratio", diagnostics["异动"])

    def test_all_three_formulas_return_a_latest_boolean(self):
        rows = [
            {
                "open": 100 + index * 0.2,
                "high": 102 + index * 0.2,
                "low": 99 + index * 0.2,
                "close": 101 + index * 0.2,
                "volume": 1000 + (index % 11) * 90,
                "amount": 100000,
            }
            for index in range(150)
        ]
        result = evaluate_latest(rows)
        self.assertEqual(set(result), {"单针", "异动", "ZX"})
        self.assertTrue(all(isinstance(value, bool) for value in result.values()))

    def test_point_in_time_universe_includes_listing_day_and_future_delist(self):
        rows = [
            {"code": "123001.SZ", "name": "存续转债", "listing_date": "20260819", "delist_date": ""},
            {"code": "123002.SZ", "name": "即将退市", "listing_date": "20200101", "delist_date": "20260820"},
            {"code": "123003.SZ", "name": "未来转债", "listing_date": "20260821", "delist_date": ""},
            {"code": "123004.SZ", "name": "已退转债", "listing_date": "20200101", "delist_date": "20260818"},
        ]
        active = active_reference_rows(rows, "20260819")
        self.assertEqual([row["code"] for row in active], ["123001.SZ", "123002.SZ"])


if __name__ == "__main__":
    unittest.main()
