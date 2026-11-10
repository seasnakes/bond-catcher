import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "sync_convertible_bond_lifecycle",
    SCRIPTS / "sync-convertible-bond-lifecycle.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ConvertibleBondLifecycleTest(unittest.TestCase):
    def complete_reference_rows(self):
        rows = [
            {
                "code": f"{110000 + index:06d}.SH",
                "delist_date": "",
            }
            for index in range(MODULE.MIN_REFERENCE_BONDS)
        ]
        rows[0] = {"code": "113697.SH", "delist_date": "20260828"}
        rows[1] = {"code": "113667.SH", "delist_date": "20260831"}
        rows[2] = {"code": "123065.SZ", "delist_date": "20260904"}
        return rows

    def test_effective_delist_date_hides_redeemed_bond(self):
        reasons = MODULE.reference_inactive_reasons(
            self.complete_reference_rows(),
            date(2026, 9, 1),
        )

        self.assertEqual(reasons["113697.SH"], "eastmoney_delisted_20260828")
        self.assertEqual(reasons["113667.SH"], "eastmoney_delisted_20260831")
        self.assertNotIn("123065.SZ", reasons)

    def test_partial_reference_response_cannot_prune_the_market(self):
        with self.assertRaisesRegex(RuntimeError, "quality gate failed"):
            MODULE.reference_inactive_reasons(
                [{"code": "113697.SH", "delist_date": "20260828"}],
                date(2026, 9, 1),
            )

    def test_confirmed_delisting_stays_hidden_during_source_failure(self):
        previous = {
            "bonds": {
                "113697.SH": {
                    "isActive": False,
                    "reason": "eastmoney_delisted_20260828",
                },
                "113667.SH": {
                    "isActive": True,
                    "reason": "present_in_qmt_current_list",
                },
            }
        }

        self.assertEqual(
            MODULE.previous_reference_inactive_reasons(previous, date(2026, 9, 1)),
            {"113697.SH": "eastmoney_delisted_20260828"},
        )


if __name__ == "__main__":
    unittest.main()
