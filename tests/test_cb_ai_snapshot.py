import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts/cb_ai_snapshot.py"
spec = importlib.util.spec_from_file_location("cb_ai_snapshot_test_module", MODULE_PATH)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotTests(unittest.TestCase):
    def test_redeem_lookup_uses_bare_code_and_does_not_include_a_later_observation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "market.sqlite3"
            with closing(sqlite3.connect(path)) as conn:
                conn.executescript("CREATE TABLE instruments(code TEXT); CREATE TABLE daily_bars(code TEXT, trade_date TEXT, adjustment TEXT); CREATE TABLE redeem_status_observations(code TEXT, trade_date TEXT, status TEXT);")
                conn.execute("INSERT INTO redeem_status_observations VALUES ('123112','20260904','公告强赎')")
                conn.commit()
            with patch.dict('os.environ', {"MINIQMT_REDEEM_STATUS_DATABASE_PATH": str(path)}):
                self.assertEqual(snapshot.load_master("123112.SZ", "20260904")["redeem"]["status"], "公告强赎")
                self.assertEqual(snapshot.load_master("123112.SZ", "20260903")["redeem"], {})

    def test_read_only_connection_cannot_change_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.sqlite3"
            with closing(sqlite3.connect(path)) as conn:
                conn.execute("CREATE TABLE prices (price REAL)")
            conn = snapshot.connect(path)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    conn.execute("INSERT INTO prices VALUES (100)")
            finally:
                conn.close()

    def test_historical_selection_filters_future_rows_and_keeps_missing_amount(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "monitor"
            data = runtime / "data"
            data.mkdir(parents=True)
            now = datetime(2026, 9, 4, 9, 33, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
            for day in ("20260903", "20260904", "20260905"):
                with closing(sqlite3.connect(data / f"{day}.sqlite3")) as conn:
                    conn.execute("CREATE TABLE minute_observations (trading_date TEXT,code TEXT,minute_ms INTEGER,minute_time TEXT,open REAL,high REAL,low REAL,close REAL,amount REAL)")
                    for clock, amount in (("09:31", 1000), ("09:32", None), ("09:33", 5000)):
                        timestamp = datetime.strptime(f"{day} {clock}", "%Y%m%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
                        conn.execute("INSERT INTO minute_observations VALUES (?,?,?,?,?,?,?,?,?)", (day, "123247.SZ", int(timestamp.timestamp() * 1000), timestamp.isoformat(), 100, 101, 99, 100, amount))
                    conn.commit()
            with patch.object(snapshot, "ROOT", root), patch.object(snapshot, "MONITOR_RUNTIME", runtime), patch.object(snapshot, "load_indicator_module", return_value=None), patch.object(snapshot, "load_master", return_value={"instrument": {}, "daily": [], "redeem": {}, "errors": []}):
                result = snapshot.load_snapshot("123247.SZ", "20260904", 3, now)
                self.assertEqual(result["available_dates"], ["20260904", "20260903"])
                current = result["sessions"][-1]
                self.assertEqual([r["time"] for r in current["rows"]], ["09:31", "09:32"])
                self.assertIsNone(current["rows"][-1]["amount_yuan"])
                self.assertIsNone(current["rows"][-1]["average_approx"])
                self.assertIsNone(result["reference_daily"][-1]["amount_yuan"])
                self.assertEqual(result["reference_daily"][-1]["missing_bars"], 0)
                self.assertNotIn("20260905", json.dumps(result))
                with self.assertRaises(ValueError):
                    snapshot.load_snapshot("123247.SZ", "20260905", now=now)


if __name__ == "__main__":
    unittest.main()
