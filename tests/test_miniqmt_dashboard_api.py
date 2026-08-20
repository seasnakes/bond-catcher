from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "miniqmt-dashboard-api.py"
if str(SCRIPT_PATH.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT_PATH.parent))
MONITOR_ROOT = Path(
    os.environ.get(
        "MINIQMT_TEST_MONITOR_ROOT",
        ROOT / "tests" / "fixtures" / "miniqmt_monitor",
    )
)


def load_dashboard_module(runtime_root: Path):
    module_name = "miniqmt_dashboard_api_test"
    sys.modules.pop(module_name, None)
    with mock.patch.dict(
        os.environ,
        {
            "MINIQMT_MONITOR_ROOT": str(MONITOR_ROOT),
            "MINIQMT_RUNTIME_ROOT": str(runtime_root),
            "MINIQMT_BACKFILL_STATE_PATH": str(
                runtime_root / "intraday-backfill-jobs.json"
            ),
            "FINANCE_BOARD_STATE_PATH": str(runtime_root / "board-state.json"),
        },
    ):
        spec = importlib.util.spec_from_file_location(module_name, SCRIPT_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("cannot load dashboard module")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module


def create_database(path: Path, trading_date: str) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE minute_observations(
          trading_date TEXT NOT NULL,
          code TEXT NOT NULL,
          minute_ms INTEGER NOT NULL,
          minute_time TEXT NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          amount REAL NOT NULL
        );
        CREATE TABLE meta(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE qmt_events(
          id INTEGER PRIMARY KEY,
          trading_date TEXT NOT NULL,
          event_time_ms INTEGER NOT NULL,
          event_time TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          direction TEXT NOT NULL,
          price REAL NOT NULL,
          tier TEXT NOT NULL,
          speed_1m REAL,
          speed_3m REAL,
          speed_5m REAL,
          amount_1m REAL,
          confidence TEXT NOT NULL,
          score REAL NOT NULL,
          details_json TEXT NOT NULL
        );
        """
    )
    connection.execute(
        "INSERT INTO meta(key,value) VALUES('codes',?)",
        (json.dumps(["123273.SZ", "113647.SH"]),),
    )
    timestamp = int(
        datetime.strptime(
            f"{trading_date}100500", "%Y%m%d%H%M%S"
        ).replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()
        * 1000
    )
    connection.execute(
        "INSERT INTO minute_observations VALUES(?,?,?,?,?,?,?,?,?)",
        (
            trading_date,
            "123273.SZ",
            timestamp,
            f"{trading_date[:4]}-{trading_date[4:6]}-{trading_date[6:]} 10:05:00",
            100,
            101,
            99,
            100,
            1_000_000,
        ),
    )
    for event_id in (1, 2, 3):
        connection.execute(
            "INSERT INTO qmt_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                event_id,
                trading_date,
                timestamp + event_id,
                "10:05:00",
                "123273.SZ",
                "转债",
                "urgent_up",
                "up",
                100,
                "high",
                0.01,
                0.02,
                0.03,
                100_000,
                "high",
                80,
                "{}",
            ),
        )
    connection.commit()
    connection.close()


class MiniQmtDashboardApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name)
        (self.runtime / "data").mkdir()
        self.trading_date = "20260812"
        create_database(
            self.runtime / "data" / f"{self.trading_date}.sqlite3",
            self.trading_date,
        )
        self.module = load_dashboard_module(self.runtime)

    def tearDown(self):
        self.temp.cleanup()

    def write_runtime_status(
        self,
        returned_codes: int,
        updated_at: str = "2026-08-12T10:05:10",
    ) -> None:
        (self.runtime / "service.json").write_text(
            json.dumps({"pid": os.getpid()}), encoding="utf-8"
        )
        (self.runtime / "status.json").write_text(
            json.dumps(
                {
                    "status": "running",
                    "trading_date": self.trading_date,
                    "updated_at": updated_at,
                    "last_returned_codes": returned_codes,
                }
            ),
            encoding="utf-8",
        )

    def test_new_bond_calendar_falls_back_when_qmt_has_not_rolled_forward(self):
        is_trading, previous_date, source, latest_date = (
            self.module.resolve_target_trading_session(
                "20260819",
                False,
                "",
                ["20260817", "20260818", "20260819", "20260820"],
            )
        )

        self.assertTrue(is_trading)
        self.assertEqual(previous_date, "20260818")
        self.assertIn("校正QMT", source)
        self.assertEqual(latest_date, "20260820")

    def test_new_bond_calendar_keeps_exchange_holidays_closed(self):
        is_trading, previous_date, source, latest_date = (
            self.module.resolve_target_trading_session(
                "20260822",
                False,
                "",
                ["20260820", "20260821", "20260824"],
            )
        )

        self.assertFalse(is_trading)
        self.assertEqual(previous_date, "")
        self.assertIn("新浪交易日历", source)
        self.assertEqual(latest_date, "20260824")

    def append_minute_row(self, minute_offset: int = 1) -> None:
        database = self.runtime / "data" / f"{self.trading_date}.sqlite3"
        timestamp = int(
            datetime.strptime(
                f"{self.trading_date}100500", "%Y%m%d%H%M%S"
            ).replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()
            * 1000
        ) + minute_offset * 60_000
        connection = sqlite3.connect(database)
        connection.execute(
            "INSERT INTO minute_observations VALUES(?,?,?,?,?,?,?,?,?)",
            (
                self.trading_date,
                "123273.SZ",
                timestamp,
                f"{self.trading_date[:4]}-{self.trading_date[4:6]}-"
                f"{self.trading_date[6:]} 10:{5 + minute_offset:02d}:00",
                100,
                102,
                99,
                101,
                1_200_000,
            ),
        )
        connection.commit()
        connection.close()

    def test_sparks_falls_back_to_latest_local_date_outside_market(self):
        self.append_minute_row()
        current = datetime(
            2026, 8, 13, 0, 30, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        with mock.patch.object(self.module, "china_now", return_value=current):
            payload = self.module.sparks_payload("123273.SZ")

        self.assertEqual(payload["calendar_date"], "20260813")
        self.assertEqual(payload["trading_date"], self.trading_date)
        self.assertTrue(payload["data_is_stale"])
        self.assertEqual(payload["returned"], 1)
        self.assertEqual(len(payload["sparks"][0]["points"]), 2)
        self.assertEqual(
            payload["sparks"][0]["source"],
            "MiniQMT最近交易日1m缓存",
        )

    def test_sparks_never_falls_back_to_old_date_during_live_session(self):
        current = datetime(
            2026, 8, 13, 10, 5, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        with mock.patch.object(self.module, "china_now", return_value=current):
            payload = self.module.sparks_payload("123273.SZ")

        self.assertEqual(payload["calendar_date"], "20260813")
        self.assertEqual(payload["trading_date"], "20260813")
        self.assertFalse(payload["data_is_stale"])
        self.assertEqual(payload["returned"], 0)

    def test_live_spark_samples_survive_fast_refresh_and_restart(self):
        current = datetime(
            2026, 8, 12, 10, 5, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        first_timestamp = int(current.timestamp() * 1000)
        with mock.patch.object(self.module, "china_now", return_value=current):
            first = self.module.record_live_intraday_sample(
                "301127.SZ",
                {
                    "price": 25.1,
                    "date": self.trading_date,
                    "timestamp": first_timestamp,
                    "previousClose": 24.8,
                    "amount": 100_000,
                    "volume": 400,
                },
            )
            refreshed = self.module.record_live_intraday_sample(
                "301127.SZ",
                {
                    "price": 25.2,
                    "date": self.trading_date,
                    "timestamp": first_timestamp + 2_000,
                    "previousClose": 24.8,
                    "amount": 110_000,
                    "volume": 440,
                },
            )
            second = self.module.record_live_intraday_sample(
                "301127.SZ",
                {
                    "price": 25.4,
                    "date": self.trading_date,
                    "timestamp": first_timestamp + 11_000,
                    "previousClose": 24.8,
                    "amount": 125_000,
                    "volume": 500,
                },
            )

        self.assertEqual(first["time"], refreshed["time"])
        self.assertNotEqual(refreshed["time"], second["time"])
        self.module.persist_live_intraday_samples(
            [
                {"code": "301127.SZ", **refreshed},
                {"code": "301127.SZ", **second},
            ]
        )

        reloaded = load_dashboard_module(self.runtime)
        points = reloaded.load_live_intraday_samples(
            ["301127.SZ"], self.trading_date
        )["301127.SZ"]
        self.assertEqual([point["price"] for point in points], [25.2, 25.4])
        self.assertEqual([point["amount"] for point in points], [110_000, 125_000])
        self.assertEqual([point["volume"] for point in points], [440, 500])
        self.assertEqual(points[-1]["previous_close"], 24.8)

    def test_legacy_live_spark_schema_remains_readable(self):
        database = self.runtime / "legacy-board-spark.sqlite3"
        with sqlite3.connect(database) as connection:
            connection.execute(
                """
                CREATE TABLE board_spark_samples(
                  trading_date TEXT NOT NULL,
                  code TEXT NOT NULL,
                  timestamp INTEGER NOT NULL,
                  price REAL NOT NULL,
                  PRIMARY KEY(trading_date,code,timestamp)
                )
                """
            )
            connection.execute(
                "INSERT INTO board_spark_samples VALUES(?,?,?,?)",
                (self.trading_date, "123279.SZ", 1_786_500_300_000, 178.8),
            )
        self.module.LIVE_INTRADAY_DATABASE_PATH = database

        points = self.module.load_persisted_live_intraday_samples(
            ["123279.SZ"], self.trading_date
        )["123279.SZ"]

        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["price"], 178.8)
        self.assertIsNone(points[0]["amount"])
        self.assertIsNone(points[0]["volume"])

    def test_stock_spark_uses_persisted_postclose_minute_cache(self):
        base_timestamp = int(
            datetime(
                2026, 8, 12, 10, 5, tzinfo=ZoneInfo("Asia/Shanghai")
            ).timestamp()
            * 1000
        )
        rows = [
            {
                "minute_ms": base_timestamp,
                "minute_time": "2026-08-12 10:05:00",
                "open": 25.1,
                "high": 25.2,
                "low": 25.0,
                "close": 25.1,
                "volume": 1_000,
                "amount": 25_100,
            },
            {
                "minute_ms": base_timestamp + 60_000,
                "minute_time": "2026-08-12 10:06:00",
                "open": 25.1,
                "high": 25.5,
                "low": 25.1,
                "close": 25.4,
                "volume": 2_000,
                "amount": 50_800,
            },
        ]
        self.module.merge_intraday_backfill_cache(
            "301127.SZ", self.trading_date, rows, 24.8
        )
        reloaded = load_dashboard_module(self.runtime)
        current = datetime(
            2026, 8, 13, 0, 30, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        with mock.patch.object(reloaded, "china_now", return_value=current):
            payload = reloaded.sparks_payload("301127.SZ")

        self.assertEqual(payload["trading_date"], self.trading_date)
        self.assertEqual(payload["returned"], 1)
        self.assertEqual(payload["sparks"][0]["points"], [25.1, 25.4])
        self.assertEqual(
            payload["sparks"][0]["source"],
            "MiniQMT最近交易日1m缓存",
        )

    def test_board_market_codes_keeps_only_unambiguous_shanghai_shenzhen(self):
        (self.runtime / "board-state.json").write_text(
            json.dumps(
                {
                    "sectors": [
                        {
                            "name": "测试",
                            "stocks": [
                                {"name": "天源", "secid": "0.301127"},
                                {"name": "天准", "secid": "1.688003"},
                                {"name": "北交", "secid": "0.920190"},
                                {"name": "港股", "secid": "116.00992"},
                            ],
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

        self.assertEqual(
            self.module.board_market_codes(),
            {"301127.SZ", "688003.SH"},
        )

    def test_health_degrades_when_live_quotes_drop_to_zero(self):
        self.write_runtime_status(0)
        payload = self.module.api_health(
            datetime(2026, 8, 12, 10, 5, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["degraded"])
        self.assertIn("miniqmt_returned_zero_quotes", payload["reasons"])
        self.assertEqual(payload["market_phase"], "morning")

    def test_health_is_healthy_with_fresh_live_data(self):
        self.write_runtime_status(309)
        payload = self.module.api_health(
            datetime(2026, 8, 12, 10, 5, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["degraded"])
        self.assertEqual(payload["reason"], "healthy")

    def test_health_detects_stale_status_and_quote_during_market(self):
        self.write_runtime_status(309, "2026-08-12T10:10:00")
        payload = self.module.api_health(
            datetime(2026, 8, 12, 10, 10, 5, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertFalse(payload["ok"])
        self.assertIn("quote_data_stale", payload["reasons"])

        self.write_runtime_status(309, "2026-08-12T10:00:00")
        payload = self.module.api_health(
            datetime(2026, 8, 12, 10, 5, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertIn("monitor_status_stale", payload["reasons"])

    def test_health_does_not_require_live_quotes_after_market_close(self):
        self.write_runtime_status(0, "2026-08-12T16:00:00")
        payload = self.module.api_health(
            datetime(2026, 8, 12, 16, 0, 5, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["market_data_expected"])
        self.assertEqual(payload["reason"], "healthy_outside_market_session")

    def test_events_resets_after_id_from_previous_day(self):
        payload = self.module.events_payload(
            scope="all",
            after_id=30_435,
            limit=80,
        )
        self.assertTrue(payload["cursor_reset"])
        self.assertEqual(
            payload["cursor_reset_reason"], "after_id_ahead_of_current_day"
        )
        self.assertEqual(payload["effective_after_id"], 0)
        self.assertEqual([event["id"] for event in payload["events"]], [3, 2, 1])
        self.assertEqual(payload["latest_id"], 3)

    def test_events_resets_explicit_cross_day_cursor(self):
        payload = self.module.events_payload(
            scope="all",
            after_id=2,
            limit=80,
            cursor_trading_date="20260811",
        )
        self.assertTrue(payload["cursor_reset"])
        self.assertEqual(payload["cursor_reset_reason"], "cursor_trading_date_changed")
        self.assertEqual([event["id"] for event in payload["events"]], [3, 2, 1])

    def test_intraday_download_backoff_is_per_symbol_and_exponential(self):
        module = self.module
        module.INTRADAY_DOWNLOAD_BACKOFF.clear()
        first = module.record_intraday_download_failure("123273.SZ:20260812", "x", now=10)
        second = module.record_intraday_download_failure("123273.SZ:20260812", "x", now=50)
        other = module.intraday_download_backoff_state("123157.SZ:20260812", now=50)
        self.assertEqual(first["delay_seconds"], 30)
        self.assertEqual(second["delay_seconds"], 60)
        self.assertTrue(second["active"])
        self.assertFalse(other["active"])
        module.clear_intraday_download_backoff("123273.SZ:20260812")
        self.assertFalse(
            module.intraday_download_backoff_state("123273.SZ:20260812", now=50)[
                "active"
            ]
        )

    def test_historical_cache_read_is_blocked_outside_maintenance_window(self):
        module = self.module
        module.INTRADAY_CACHE.clear()
        module.INTRADAY_DOWNLOAD_BACKOFF.clear()

        with (
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                side_effect=AssertionError("historical view touched Bridge"),
            ),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(False, "waiting_for_market_close"),
            ),
        ):
            with self.assertRaisesRegex(LookupError, "waiting_for_market_close"):
                module.historical_minute_rows("123273.SZ", self.trading_date)

    def test_complete_current_day_refresh_never_downloads_history(self):
        module = self.module
        module.INTRADAY_CACHE.clear()
        module.INTRADAY_DOWNLOAD_BACKOFF.clear()

        class CompleteBridge:
            downloads = 0
            gets = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).downloads += 1

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                return {
                    "data": {
                        "123273.SZ": [
                            {
                                "index": "20260812100500",
                                "time": 1_786_500_300_000,
                                "open": 100,
                                "high": 101,
                                "low": 99,
                                "close": 100,
                                "preClose": 98,
                                "volume": 1_000,
                                "amount": 100_000,
                            }
                        ]
                    }
                }

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", CompleteBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=False),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
        ):
            first = module.historical_minute_rows("123273.SZ", self.trading_date)
            cache_key = "123273.SZ:20260812"
            cached_payload = module.INTRADAY_CACHE[cache_key][1]
            module.INTRADAY_CACHE[cache_key] = (-1e9, cached_payload)
            second = module.historical_minute_rows("123273.SZ", self.trading_date)

        self.assertEqual(len(first[0]), 1)
        self.assertEqual(len(second[0]), 1)
        self.assertEqual(CompleteBridge.gets, 2)
        self.assertEqual(CompleteBridge.downloads, 0)

    def test_current_day_history_cache_covers_repeated_detail_polls(self):
        module = self.module
        module.INTRADAY_CACHE.clear()
        module.INTRADAY_DOWNLOAD_BACKOFF.clear()

        class CompleteBridge:
            gets = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                return {
                    "data": {
                        "123273.SZ": [
                            {
                                "index": "20260812100500",
                                "time": 1_786_500_300_000,
                                "open": 100,
                                "high": 101,
                                "low": 99,
                                "close": 100,
                                "preClose": 98,
                                "volume": 1_000,
                                "amount": 100_000,
                            }
                        ]
                    }
                }

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", CompleteBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=False),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module.time, "monotonic", return_value=100.0),
        ):
            module.historical_minute_rows("123273.SZ", self.trading_date)

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", CompleteBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=False),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module.time, "monotonic", return_value=130.0),
        ):
            module.historical_minute_rows("123273.SZ", self.trading_date)

        self.assertEqual(module.INTRADAY_CURRENT_CACHE_TTL_SECONDS, 60)
        self.assertEqual(CompleteBridge.gets, 1)

    def test_incomplete_historical_read_never_downloads_synchronously(self):
        module = self.module
        module.INTRADAY_CACHE.clear()
        module.INTRADAY_DOWNLOAD_BACKOFF.clear()

        class BackfillBridge:
            calls: list[str] = []

            def __init__(self, *_args, **_kwargs):
                pass

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).calls.append("download")

            def get(self, *_args, **_kwargs):
                type(self).calls.append("get")
                rows = [
                    {
                        "index": "20260812100500",
                        "time": 1_786_500_300_000,
                        "open": 100,
                        "high": 101,
                        "low": 99,
                        "close": 100,
                        "preClose": 98,
                        "volume": 1_000,
                        "amount": 100_000,
                    }
                ]
                return {"data": {"123273.SZ": rows}}

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", BackfillBridge),
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                return_value=True,
            ),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
        ):
            result = module.historical_minute_rows(
                "123273.SZ",
                self.trading_date,
            )

        self.assertEqual(BackfillBridge.calls, ["get"])
        self.assertEqual(len(result[0]), 1)

    def test_current_day_bond_payload_never_waits_for_historical_bridge(self):
        module = self.module
        scheduled: list[tuple[str, str]] = []
        live_timestamp = int(
            datetime(2026, 8, 12, 10, 6, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()
            * 1000
        )
        live_row = {
            "minute_ms": live_timestamp,
            "minute_time": "2026-08-12 10:06:00",
            "open": 101,
            "high": 101,
            "low": 101,
            "close": 101,
            "amount": 20_000,
        }
        live_tick = {
            "timetag": "20260812 10:06:00",
            "lastPrice": 101,
            "lastClose": 99,
            "volume": 1_000,
        }

        def forbidden_history(*_args, **_kwargs):
            time.sleep(0.2)
            raise AssertionError("current-day payload called historical bridge")

        with (
            mock.patch.object(module, "historical_minute_rows", forbidden_history),
            mock.patch.object(
                module,
                "live_tick_minute_rows",
                return_value=([live_row], 99, "转债", 20_000, live_tick),
            ),
            mock.patch.object(
                module,
                "bond_volume_ratio_from_tick",
                return_value=(None, None),
            ),
            mock.patch.object(
                module,
                "schedule_current_intraday_refresh",
                side_effect=lambda code, date: (
                    scheduled.append((code, date))
                    or {"status": "pending", "retry_in_seconds": 0}
                ),
            ),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                },
            ),
        ):
            started = time.perf_counter()
            payload = module.bond_payload("123273")
            elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 0.1)
        self.assertEqual(scheduled, [("123273.SZ", self.trading_date)])
        self.assertEqual(payload["history_backfill"]["status"], "pending")
        self.assertTrue(payload["history_backfill"]["required"])
        self.assertEqual(payload["bar_count"], 2)
        self.assertIn("本地监控", payload["source"])
        self.assertIn("实时快照", payload["source"])

    def test_dashboard_gap_requests_live_monitor_priority(self):
        module = self.module
        module.MONITOR_HISTORY_REPAIR_PRIORITY_PATH = (
            self.runtime / "history-repair-priority.json"
        )
        self.assertTrue(
            module.request_monitor_history_repair_priority(
                "123273.SZ",
                self.trading_date,
            )
        )
        payload = json.loads(
            module.MONITOR_HISTORY_REPAIR_PRIORITY_PATH.read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(payload["code"], "123273.SZ")
        self.assertEqual(payload["trading_date"], self.trading_date)
        self.assertGreater(payload["expires_at_epoch"], payload["requested_at_epoch"])

    def test_live_tick_keeps_cumulative_amount_out_of_minute_row(self):
        module = self.module
        module.ACTIVE_INDEX_TICK_MINUTES.clear()

        class CumulativeTickBridge:
            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, path, *_args, **_kwargs):
                if path != "/api/market/full_tick":
                    raise AssertionError(f"unexpected Bridge path: {path}")
                return {
                    "data": {
                        "123273.SZ": {
                            "timetag": "20260812 10:06:20",
                            "lastPrice": 102,
                            "lastClose": 99,
                            "amount": 987_654_321,
                        }
                    }
                }

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", CumulativeTickBridge),
            mock.patch.object(
                module,
                "update_active_index_tick_minutes",
                side_effect=AssertionError("detail path used sparse tick cache"),
            ),
        ):
            rows, previous_close, name, cumulative_amount, tick = (
                module.live_tick_minute_rows(
                    "123273.SZ",
                    self.trading_date,
                    "转债",
                )
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], 0)
        self.assertEqual(rows[0]["close"], 102)
        self.assertEqual(previous_close, 99)
        self.assertEqual(name, "转债")
        self.assertEqual(cumulative_amount, 987_654_321)
        self.assertEqual(tick["amount"], 987_654_321)

    def test_bond_minute_merge_preserves_trusted_amount_and_ohlc(self):
        module = self.module
        timestamp = int(
            datetime(2026, 8, 12, 10, 6, tzinfo=ZoneInfo("Asia/Shanghai"))
            .timestamp()
            * 1000
        )
        historical = [
            {
                "minute_ms": timestamp,
                "minute_time": "2026-08-12 10:06:00",
                "open": 99,
                "high": 100,
                "low": 98,
                "close": 99,
                "amount": 900_000_000,
                "volume": 900,
            }
        ]
        local = [
            {
                "minute_ms": timestamp,
                "minute_time": "2026-08-12 10:06:00",
                "open": 100,
                "high": 102,
                "low": 99,
                "close": 101,
                "amount": 1_250_000,
                "volume": 12,
            }
        ]
        live = [
            {
                "minute_ms": timestamp,
                "minute_time": "2026-08-12 10:06:00",
                "open": 103,
                "high": 103,
                "low": 103,
                "close": 103,
                "amount": 987_654_321,
            }
        ]

        rows = module.merge_bond_minute_rows(local, historical, live)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["open"], 100)
        self.assertEqual(rows[0]["high"], 103)
        self.assertEqual(rows[0]["low"], 99)
        self.assertEqual(rows[0]["close"], 103)
        self.assertEqual(rows[0]["amount"], 1_250_000)
        self.assertEqual(rows[0]["volume"], 12)

    def test_live_only_new_minute_uses_zero_amount_until_monitor_writes_it(self):
        module = self.module
        timestamp = int(
            datetime(2026, 8, 12, 10, 7, tzinfo=ZoneInfo("Asia/Shanghai"))
            .timestamp()
            * 1000
        )
        live = [
            {
                "minute_ms": timestamp,
                "minute_time": "2026-08-12 10:07:00",
                "open": 103,
                "high": 103,
                "low": 103,
                "close": 103,
                "amount": 987_654_321,
            }
        ]

        rows = module.merge_bond_minute_rows([], [], live)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], 0)
        self.assertEqual(rows[0]["close"], 103)

    def test_async_current_day_refresh_never_touches_bridge_during_session(self):
        module = self.module
        module.INTRADAY_CACHE.clear()
        module.INTRADAY_ASYNC_REFRESH_STATE.clear()
        module.INTRADAY_ASYNC_ACTIVE_KEY = "123273.SZ:20260812"

        class GetOnlyBridge:
            gets = 0
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                return {
                    "data": {
                        "123273.SZ": [
                            {
                                "index": "20260812100500",
                                "time": 1_786_500_300_000,
                                "open": 100,
                                "high": 101,
                                "low": 99,
                                "close": 100,
                                "preClose": 98,
                                "volume": 1_000,
                                "amount": 100_000,
                            }
                        ]
                    }
                }

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).downloads += 1

        with (
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                side_effect=AssertionError("session refresh touched Bridge"),
            ),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(False, "waiting_for_market_close"),
            ),
        ):
            module._refresh_current_intraday_cache("123273.SZ", self.trading_date)

        self.assertEqual(
            module.INTRADAY_ASYNC_REFRESH_STATE["123273.SZ:20260812"]["status"],
            "waiting_for_market_close",
        )

    def test_fast_preview_never_calls_any_bridge_path(self):
        module = self.module

        def forbidden(*_args, **_kwargs):
            raise AssertionError("fast preview touched Bridge")

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", side_effect=forbidden),
            mock.patch.object(module, "historical_minute_rows", side_effect=forbidden),
            mock.patch.object(module, "live_tick_minute_rows", side_effect=forbidden),
            mock.patch.object(
                module,
                "schedule_current_intraday_refresh",
                side_effect=forbidden,
            ),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                },
            ),
        ):
            started = time.perf_counter()
            payload = module.bond_payload("123273", fast=True)
            elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 0.1)
        self.assertTrue(payload["fast_preview"])
        self.assertEqual(payload["history_backfill"]["status"], "deferred")
        self.assertEqual(payload["bar_count"], 1)
        self.assertTrue(payload["realtime"]["live_tick_skipped"])
        self.assertEqual(payload["source"], "本地监控")

    def test_fast_preview_reuses_board_live_sample_for_a_new_bond(self):
        module = self.module
        timestamp = int(
            datetime(
                2026,
                8,
                12,
                10,
                6,
                12,
                tzinfo=ZoneInfo("Asia/Shanghai"),
            ).timestamp()
            * 1000
        )
        module.LIVE_INTRADAY_SAMPLES["123279.SZ"] = [
            {
                "date": self.trading_date,
                "time": timestamp,
                "price": 178.8,
                "previous_close": 157.3,
                "amount": 1_250_000_000,
                "volume": 700_000,
            }
        ]

        def forbidden(*_args, **_kwargs):
            raise AssertionError("fast preview touched Bridge")

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", side_effect=forbidden),
            mock.patch.object(module, "live_tick_minute_rows", side_effect=forbidden),
            mock.patch.object(
                module,
                "china_now",
                return_value=datetime(
                    2026,
                    8,
                    12,
                    10,
                    6,
                    20,
                    tzinfo=ZoneInfo("Asia/Shanghai"),
                ),
            ),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                },
            ),
        ):
            payload = module.bond_payload("123279", fast=True)

        self.assertTrue(payload["fast_preview"])
        self.assertTrue(payload["realtime"]["live_tick_skipped"])
        self.assertTrue(payload["realtime"]["live_sample_used"])
        self.assertEqual(payload["latest_price"], 178.8)
        self.assertEqual(payload["latest_minute"], "10:06")
        self.assertAlmostEqual(payload["daily_return"], 13.6681500317864)
        self.assertEqual(payload["total_amount"], 1_250_000_000)
        self.assertEqual(payload["source"], "主看板实时采样")

    def test_fast_preview_aggregates_full_day_board_samples_for_new_bond(self):
        module = self.module
        zone = ZoneInfo("Asia/Shanghai")

        def sample(clock, price, amount, volume):
            timestamp = int(
                datetime.strptime(
                    f"{self.trading_date}{clock}", "%Y%m%d%H%M%S"
                ).replace(tzinfo=zone).timestamp()
                * 1000
            )
            return {
                "date": self.trading_date,
                "time": timestamp,
                "price": price,
                "previous_close": 99.0,
                "amount": amount,
                "volume": volume,
            }

        module.LIVE_INTRADAY_SAMPLES["123279.SZ"] = [
            sample("100501", 100.0, 1_000, 100),
            sample("100540", 102.0, 1_500, 150),
            sample("100605", 101.0, 1_600, 160),
            sample("100650", 103.0, 2_100, 210),
        ]

        with (
            mock.patch.object(
                module,
                "china_now",
                return_value=datetime(2026, 8, 12, 10, 7, tzinfo=zone),
            ),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                },
            ),
        ):
            payload = module.bond_payload("123279", fast=True)

        self.assertEqual(payload["bar_count"], 2)
        first, second = payload["rows"]
        self.assertEqual(
            (first["open"], first["high"], first["low"], first["close"]),
            (100.0, 102.0, 100.0, 102.0),
        )
        self.assertEqual(first["amount"], 0)
        self.assertEqual(
            (second["open"], second["high"], second["low"], second["close"]),
            (101.0, 103.0, 101.0, 103.0),
        )
        self.assertEqual(second["amount"], 600)
        self.assertNotEqual(second["macd"], 0)
        self.assertNotEqual(second["purple"], first["purple"])
        self.assertEqual(payload["latest_minute"], "10:06")
        self.assertEqual(payload["total_amount"], 2_100)

    def test_fast_preview_stops_retry_for_non_trading_monitor_code(self):
        module = self.module
        module.MONITOR_HISTORY_REPAIR_PRIORITY_PATH = (
            self.runtime / "history-repair-priority.json"
        )
        with (
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                return_value=True,
            ),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                    "status": {
                        "indicator_warmup": {
                            "history_repair_excluded_code_sample": [
                                "123273.SZ"
                            ],
                            "history_repair_exclusion_reasons": {
                                "123273.SZ": "qmt_is_trading_false"
                            },
                            "history_repair": {
                                "cache_refresh_enabled": True,
                                "download_enabled": True,
                            },
                        }
                    },
                },
            ),
        ):
            payload = module.bond_payload("123273", fast=True)

        history = payload["history_backfill"]
        self.assertEqual(history["status"], "not_applicable")
        self.assertFalse(history["required"])
        self.assertTrue(history["source_unavailable"])
        self.assertFalse(
            module.MONITOR_HISTORY_REPAIR_PRIORITY_PATH.exists()
        )

    def test_fast_preview_is_not_blocked_by_large_quotes_bridge_request(self):
        module = self.module
        quote_started = threading.Event()
        release_quote = threading.Event()

        class BlockingQuoteBridge:
            constructions = 0

            def __init__(self, *_args, **_kwargs):
                type(self).constructions += 1

            def full_tick(self, _codes):
                quote_started.set()
                release_quote.wait(timeout=1)
                return {}

        quote_errors: list[Exception] = []

        def load_quotes():
            try:
                codes = ",".join(f"{600000 + index:06d}.SH" for index in range(100))
                module.quotes_payload(codes)
            except Exception as error:  # pragma: no cover - asserted below
                quote_errors.append(error)

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", BlockingQuoteBridge),
            mock.patch.object(
                module,
                "api_health",
                return_value={
                    "monitor_alive": True,
                    "latest_trading_date": self.trading_date,
                    "calendar_date": self.trading_date,
                },
            ),
        ):
            worker = threading.Thread(target=load_quotes)
            worker.start()
            self.assertTrue(quote_started.wait(timeout=1))
            started = time.perf_counter()
            payload = module.bond_payload("123273", fast=True)
            elapsed = time.perf_counter() - started
            release_quote.set()
            worker.join(timeout=1)

        self.assertFalse(worker.is_alive())
        self.assertEqual(quote_errors, [])
        self.assertLess(elapsed, 0.1)
        self.assertTrue(payload["fast_preview"])
        self.assertEqual(BlockingQuoteBridge.constructions, 1)

    def test_interactive_daily_and_metadata_helpers_never_download_history(self):
        module = self.module

        class CacheOnlyBridge:
            posts = 0
            gets = 0

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                return {"data": {"000001.SZ": [], "123273.SZ": []}}

            def post(self, *_args, **_kwargs):
                type(self).posts += 1
                raise AssertionError("interactive helper downloaded history")

            def full_tick(self, *_args, **_kwargs):
                return {}

        bridge = CacheOnlyBridge()
        self.assertEqual(
            module.stock_daily_closes(
                bridge,
                "000001.SZ",
                "20260101",
                self.trading_date,
            ),
            [],
        )
        self.assertEqual(
            module.stock_intraday_prices(
                bridge,
                "000001.SZ",
                self.trading_date,
            ),
            [],
        )
        with mock.patch.object(module.MONITOR, "BridgeClient", return_value=bridge):
            with self.assertRaisesRegex(LookupError, "日K数据"):
                module.daily_payload("123273", 30)
        self.assertGreaterEqual(CacheOnlyBridge.gets, 3)
        self.assertEqual(CacheOnlyBridge.posts, 0)

    def test_local_reference_daily_aggregates_only_matching_code_without_bridge(self):
        module = self.module
        expected = {}
        for trading_date, final_close in (
            ("20260810", 104),
            ("20260811", 108),
        ):
            database = self.runtime / "data" / f"{trading_date}.sqlite3"
            create_database(database, trading_date)
            timestamp = int(
                datetime.strptime(
                    f"{trading_date}145900", "%Y%m%d%H%M%S"
                ).replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()
                * 1000
            )
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "INSERT INTO minute_observations VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        trading_date,
                        "123273.SZ",
                        timestamp,
                        (
                            f"{trading_date[:4]}-{trading_date[4:6]}-"
                            f"{trading_date[6:]} 14:59:00"
                        ),
                        103,
                        final_close + 2,
                        102,
                        final_close,
                        2_000_000,
                    ),
                )
                # This database exists globally but must not become an available
                # reference date for another instrument.
                connection.execute(
                    "INSERT INTO minute_observations VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        trading_date,
                        "118072.SH",
                        timestamp,
                        (
                            f"{trading_date[:4]}-{trading_date[4:6]}-"
                            f"{trading_date[6:]} 14:59:00"
                        ),
                        200,
                        201,
                        199,
                        200,
                        9_000_000,
                    ),
                )
            expected[trading_date] = final_close

        missing_code_database = self.runtime / "data" / "20260809.sqlite3"
        create_database(missing_code_database, "20260809")
        with sqlite3.connect(missing_code_database) as connection:
            connection.execute(
                "DELETE FROM minute_observations WHERE code='123273.SZ'"
            )

        with mock.patch.object(
            module.MONITOR,
            "BridgeClient",
            side_effect=AssertionError("local reference path touched Bridge"),
        ):
            payload = module.local_reference_daily_payload("123273", 11)

        self.assertTrue(payload["reference_only"])
        self.assertTrue(payload["local_only"])
        self.assertEqual(payload["requested_count"], 30)
        self.assertEqual(
            [row["date"] for row in payload["rows"]],
            ["20260810", "20260811", "20260812"],
        )
        self.assertNotIn("20260809", payload["available_dates"])
        first = payload["rows"][0]
        self.assertEqual(first["open"], 100)
        self.assertEqual(first["high"], expected["20260810"] + 2)
        self.assertEqual(first["low"], 99)
        self.assertEqual(first["close"], expected["20260810"])
        self.assertEqual(first["amount"], 3_000_000)
        self.assertEqual(first["bar_count"], 2)
        self.assertEqual(payload["rows"][1]["previous_close"], 104)
        self.assertAlmostEqual(payload["rows"][1]["change"], (108 / 104 - 1) * 100)

    def test_local_reference_daily_does_not_change_regular_daily_path(self):
        module = self.module
        with (
            mock.patch.object(
                module,
                "local_reference_daily_payload",
                side_effect=AssertionError("regular daily used local reference mode"),
            ),
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                side_effect=RuntimeError("regular daily still uses Bridge"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "still uses Bridge"):
                module.daily_payload("123273", 30)

    def bridge_minute_row(self, minute: int, close: float = 100) -> dict:
        moment = datetime(
            2026,
            8,
            12,
            10,
            minute,
            tzinfo=ZoneInfo("Asia/Shanghai"),
        )
        return {
            "index": moment.strftime("%Y%m%d%H%M%S"),
            "time": int(moment.timestamp() * 1000),
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "preClose": 99,
            "volume": 1_000,
            "amount": 100_000,
        }

    def test_intraday_backfill_cache_survives_process_memory_reset(self):
        module = self.module
        row = {
            "minute_ms": int(
                datetime(
                    2026,
                    8,
                    12,
                    10,
                    5,
                    tzinfo=ZoneInfo("Asia/Shanghai"),
                ).timestamp()
                * 1000
            ),
            "minute_time": "2026-08-12 10:05:00",
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 1_000,
            "amount": 100_000,
        }
        module.merge_intraday_backfill_cache(
            "123273.SZ",
            self.trading_date,
            [row],
            99,
        )
        module.INTRADAY_CACHE.clear()

        snapshot = module.intraday_cache_snapshot(
            "123273.SZ",
            self.trading_date,
        )
        self.assertEqual(len(snapshot["rows"]), 1)
        self.assertEqual(snapshot["previous_close"], 99)
        self.assertTrue(
            (
                module.INTRADAY_BACKFILL_CACHE_ROOT
                / self.trading_date
                / "123273.SZ.json"
            ).is_file()
        )

    def test_intraday_backfill_deduplicates_same_key_and_manual_is_priority(self):
        module = self.module
        first = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        duplicate = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        module.enqueue_intraday_backfill(
            "113647.SH",
            self.trading_date,
            requested_by="postclose_automatic",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_AUTOMATIC_PRIORITY,
        )

        self.assertFalse(first["deduplicated"])
        self.assertTrue(duplicate["deduplicated"])
        self.assertEqual(module.INTRADAY_BACKFILL_QUEUE.qsize(), 2)
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        self.assertEqual(cache_key, "123273.SZ:20260812")
        self.assertEqual(generation, first["generation"])
        self.assertEqual(state["requested_by"], "manual")
        module.INTRADAY_BACKFILL_QUEUE.task_done()

    def test_manual_request_upgrades_existing_read_only_job(self):
        module = self.module
        automatic = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="automatic_read",
            download_requested=False,
            priority=module.INTRADAY_BACKFILL_READ_PRIORITY,
        )
        manual = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )

        self.assertGreater(manual["generation"], automatic["generation"])
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        self.assertEqual(cache_key, "123273.SZ:20260812")
        self.assertEqual(generation, manual["generation"])
        self.assertTrue(state["download_requested"])
        self.assertEqual(state["requested_by"], "manual")
        module.INTRADAY_BACKFILL_QUEUE.task_done()

    def test_manual_backfill_downloads_then_waits_for_delayed_cache_visibility(self):
        module = self.module
        rows = [
            self.bridge_minute_row(5),
            self.bridge_minute_row(6, 101),
            self.bridge_minute_row(7, 102),
        ]

        class DelayedBridge:
            gets = 0
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                visible = rows if type(self).gets >= 3 else rows[:1]
                return {"data": {"123273.SZ": visible}}

            def download_minute_bars(self, codes, trading_date, timeout):
                type(self).downloads += 1
                self.asserted = (codes, trading_date, timeout)
                return {"status": "ok", "result": {codes[0]: "ok"}}

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", DelayedBridge),
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                side_effect=lambda values, _date: len(values) < 3,
            ),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "after_market_close"),
            ),
            mock.patch.object(module, "intraday_automatic_window_open", return_value=True),
            mock.patch.object(module, "INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS", 0),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(DelayedBridge.downloads, 1)
        self.assertEqual(DelayedBridge.gets, 3)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["row_count_after"], 3)
        self.assertEqual(
            len(module.INTRADAY_CACHE["123273.SZ:20260812"][1]["rows"]),
            3,
        )

    def test_manual_backfill_reports_partial_after_all_verifications(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class PartialBridge:
            gets = 0
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, *_args, **_kwargs):
                type(self).gets += 1
                return {"data": {"123273.SZ": [row]}}

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).downloads += 1
                return {"status": "ok", "result": {"123273.SZ": "ok"}}

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", PartialBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "after_market_close"),
            ),
            mock.patch.object(module, "intraday_automatic_window_open", return_value=True),
            mock.patch.object(module, "INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS", 0),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(PartialBridge.downloads, 1)
        self.assertEqual(
            PartialBridge.gets,
            1 + module.INTRADAY_BACKFILL_VERIFY_RETRIES,
        )
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["download_succeeded"])

    def test_backfill_status_by_job_id_never_touches_bridge(self):
        module = self.module
        queued = module.request_intraday_backfill(
            {"code": "123273", "date": self.trading_date}
        )
        with mock.patch.object(
            module.MONITOR,
            "BridgeClient",
            side_effect=AssertionError("status endpoint touched Bridge"),
        ):
            payload = module.intraday_backfill_status_payload(
                job_id_input=queued["job_id"]
            )

        self.assertEqual(payload["job_id"], "123273.SZ:20260812")
        self.assertEqual(payload["code"], "123273")
        self.assertEqual(payload["date"], self.trading_date)
        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["job"]["job_id"], payload["job_id"])

    def test_manual_download_waits_for_close_but_remains_queued(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class ReadOnlyBridge:
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, *_args, **_kwargs):
                return {"data": {"123273.SZ": [row]}}

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).downloads += 1

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", ReadOnlyBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(False, "waiting_for_market_close"),
            ),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(ReadOnlyBridge.downloads, 0)
        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["phase"], "waiting_for_market_close")
        self.assertEqual(result["wait_reason"], "waiting_for_market_close")

    def test_running_monitor_blocks_download_after_1512_until_stopped(self):
        module = self.module
        self.write_runtime_status(300, updated_at="2026-08-12T15:12:01")
        before = datetime(
            2026, 8, 12, 15, 11, 59, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        after = datetime(
            2026, 8, 12, 15, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai")
        )

        self.assertTrue(module.intraday_monitor_active(before))
        self.assertTrue(module.intraday_monitor_active(after))
        self.assertEqual(
            module.intraday_download_permission(self.trading_date, after),
            (False, "waiting_for_monitor_to_stop"),
        )

    def test_download_permission_allows_the_evening_maintenance_window(self):
        module = self.module
        before = datetime(2026, 8, 12, 15, 11, 59, tzinfo=ZoneInfo("Asia/Shanghai"))
        inside = datetime(2026, 8, 12, 15, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        after = datetime(2026, 8, 12, 18, 0, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        closed = datetime(2026, 8, 12, 23, 30, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        with mock.patch.object(module, "intraday_monitor_active", return_value=False):
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, before)[1],
                "waiting_for_1512",
            )
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, inside),
                (True, "maintenance_window"),
            )
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, after)[1],
                "maintenance_window",
            )
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, closed)[1],
                "maintenance_window_closed",
            )

    def test_consecutive_download_failures_pause_further_bridge_downloads(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class FailingDownloadBridge:
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, _path, params, **_kwargs):
                return {"data": {params["stocks"]: [row]}}

            def download_minute_bars(self, *_args, **_kwargs):
                type(self).downloads += 1
                raise TimeoutError("Bridge download timeout")

        with (
            mock.patch.object(module.MONITOR, "BridgeClient", FailingDownloadBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "after_market_close"),
            ),
            mock.patch.object(module, "INTRADAY_BACKFILL_FAILURE_PAUSE_AFTER", 2),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            results = []
            for stored_code in ("123273.SZ", "113647.SH", "118072.SH"):
                queued = module.enqueue_intraday_backfill(
                    stored_code,
                    self.trading_date,
                    requested_by="manual",
                    download_requested=True,
                    priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
                )
                cache_key, generation, state = module.next_intraday_backfill_job(
                    timeout=0
                )
                module.execute_intraday_backfill_job(
                    cache_key,
                    generation,
                    state,
                )
                module.INTRADAY_BACKFILL_QUEUE.task_done()
                results.append(
                    module.intraday_backfill_status_for_key(queued["job_id"])
                )

        self.assertEqual(FailingDownloadBridge.downloads, 2)
        self.assertEqual(results[0]["status"], "failed")
        self.assertEqual(results[1]["status"], "failed")
        self.assertEqual(results[2]["status"], "queued")
        self.assertEqual(results[2]["phase"], "waiting_for_bridge_cooldown")

    def test_http_200_with_per_code_download_error_is_a_failed_job(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class ErrorPayloadBridge:
            gets = 0
            downloads = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, _path, params, **_kwargs):
                type(self).gets += 1
                return {"data": {params["stocks"]: [row]}}

            def download_minute_bars(self, codes, *_args, **_kwargs):
                type(self).downloads += 1
                return {
                    "status": "ok",
                    "result": {codes[0]: "error: QMT timeout"},
                }

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", ErrorPayloadBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "after_market_close"),
            ),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(ErrorPayloadBridge.downloads, 1)
        self.assertEqual(ErrorPayloadBridge.gets, 1)
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["download_attempted"])
        self.assertFalse(result["download_succeeded"])
        self.assertIn("QMT timeout", result["error"])

    def test_all_verification_gets_fail_and_trip_breaker(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class VerifyFailureBridge:
            gets = 0

            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, _path, params, **_kwargs):
                type(self).gets += 1
                if type(self).gets > 1:
                    raise TimeoutError("verify timeout")
                return {"data": {params["stocks"]: [row]}}

            def download_minute_bars(self, codes, *_args, **_kwargs):
                return {"status": "ok", "result": {codes[0]: "ok"}}

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", VerifyFailureBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module, "INTRADAY_BACKFILL_FAILURE_PAUSE_AFTER", 1),
            mock.patch.object(module, "INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS", 0),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(result["status"], "partial")
        self.assertIn("verification_all_failed", result["error"])
        self.assertFalse(result["download_succeeded"])
        self.assertEqual(module.INTRADAY_BACKFILL_CONSECUTIVE_FAILURES, 1)
        self.assertGreater(module.INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC, 0)

    def test_no_source_data_does_not_trip_global_breaker(self):
        module = self.module

        class EmptySourceBridge:
            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, _path, params, **_kwargs):
                return {"data": {params["stocks"]: []}}

            def download_minute_bars(self, codes, *_args, **_kwargs):
                return {"status": "ok", "result": {codes[0]: "ok"}}

        queued = module.enqueue_intraday_backfill(
            "124025.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", EmptySourceBridge),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module, "INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS", 0),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        result = module.intraday_backfill_status_for_key(queued["job_id"])
        self.assertEqual(result["status"], "partial")
        self.assertIn("no_source_data", result["error"])
        self.assertTrue(result["download_succeeded"])
        self.assertEqual(module.INTRADAY_BACKFILL_CONSECUTIVE_FAILURES, 0)
        self.assertEqual(module.INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC, 0)

    def test_download_spacing_clock_is_recorded_after_verification(self):
        module = self.module
        row = self.bridge_minute_row(5)

        class CompleteBridge:
            def __init__(self, *_args, **_kwargs):
                pass

            def get(self, _path, params, **_kwargs):
                return {"data": {params["stocks"]: [row]}}

            def download_minute_bars(self, codes, *_args, **_kwargs):
                return {"status": "ok", "result": {codes[0]: "ok"}}

        queued = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        cache_key, generation, state = module.next_intraday_backfill_job(timeout=0)
        monotonic_values = iter([10.0, 10.0, 10.0, 25.0, 25.0])
        with (
            mock.patch.object(module.MONITOR, "BridgeClient", CompleteBridge),
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                side_effect=[True, False, False],
            ),
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module, "INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS", 0),
            mock.patch.object(module, "INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS", 0),
            mock.patch.object(module.time, "monotonic", side_effect=monotonic_values),
        ):
            module.execute_intraday_backfill_job(cache_key, generation, state)
        module.INTRADAY_BACKFILL_QUEUE.task_done()

        self.assertEqual(
            module.intraday_backfill_status_for_key(queued["job_id"])["status"],
            "ready",
        )
        self.assertEqual(module.INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC, 25.0)

    def test_postclose_scan_enqueues_only_gaps_and_only_once_per_day(self):
        module = self.module
        database = self.runtime / "data" / f"{self.trading_date}.sqlite3"
        with sqlite3.connect(database) as connection:
            timestamp = int(
                datetime(
                    2026,
                    8,
                    12,
                    10,
                    6,
                    tzinfo=ZoneInfo("Asia/Shanghai"),
                ).timestamp()
                * 1000
            )
            connection.execute(
                "INSERT INTO minute_observations VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    self.trading_date,
                    "113647.SH",
                    timestamp,
                    "2026-08-12 10:06:00",
                    100,
                    101,
                    99,
                    100,
                    1_000_000,
                ),
            )
        enqueued = []
        now = datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        with (
            mock.patch.object(module, "intraday_monitor_active", return_value=False),
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                side_effect=lambda values, _date: values[0]["code"] == "123273.SZ",
            ),
            mock.patch.object(
                module,
                "enqueue_intraday_backfill",
                side_effect=lambda code, date, **kwargs: (
                    enqueued.append((code, date, kwargs))
                    or {"deduplicated": False}
                ),
            ),
        ):
            first = module.scan_postclose_intraday_gaps(now)
            second = module.scan_postclose_intraday_gaps(now)

        self.assertTrue(first["scheduled"])
        self.assertEqual(first["scanned_codes"], 2)
        self.assertEqual(first["missing_codes"], 1)
        self.assertEqual(second["reason"], "already_scanned")
        self.assertEqual(len(enqueued), 1)
        self.assertEqual(enqueued[0][0], "123273.SZ")
        self.assertEqual(
            enqueued[0][2]["priority"],
            module.INTRADAY_BACKFILL_AUTOMATIC_PRIORITY,
        )

    def test_postclose_scan_includes_board_stock_and_reuses_ready_cache(self):
        module = self.module
        (self.runtime / "board-state.json").write_text(
            json.dumps(
                {
                    "sectors": [
                        {
                            "name": "测试",
                            "stocks": [
                                {"name": "天源", "secid": "0.301127"},
                                {"name": "天准", "secid": "1.688003"},
                            ],
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        ready_rows = []
        start = datetime(
            2026, 8, 12, 9, 30, tzinfo=ZoneInfo("Asia/Shanghai")
        )
        for minute in range(241):
            moment = start.timestamp() * 1000 + minute * 60_000
            ready_rows.append(
                {
                    "minute_ms": int(moment),
                    "minute_time": "2026-08-12 09:30:00",
                    "open": 10,
                    "high": 10,
                    "low": 10,
                    "close": 10,
                    "volume": 1,
                    "amount": 10,
                }
            )
        module.merge_intraday_backfill_cache(
            "301127.SZ", self.trading_date, ready_rows, 9.9
        )
        enqueued = []
        now = datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        with (
            mock.patch.object(module, "intraday_monitor_active", return_value=False),
            mock.patch.object(
                module,
                "minute_rows_need_backfill",
                side_effect=lambda values, _date: len(values) < 240,
            ),
            mock.patch.object(
                module,
                "enqueue_intraday_backfill",
                side_effect=lambda code, date, **kwargs: (
                    enqueued.append((code, date, kwargs))
                    or {"deduplicated": False}
                ),
            ),
        ):
            result = module.scan_postclose_intraday_gaps(now)

        self.assertTrue(result["scheduled"])
        self.assertEqual(
            result["universe_source"], "sqlite_meta_codes+board_state"
        )
        self.assertNotIn("301127.SZ", [row[0] for row in enqueued])
        self.assertIn("688003.SH", [row[0] for row in enqueued])

    def test_postclose_scan_repairs_old_marker_zero_row_code_without_repeating_ready(self):
        module = self.module
        module.INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE = self.trading_date
        ready_key = f"123273.SZ:{self.trading_date}"
        module.INTRADAY_ASYNC_REFRESH_STATE[ready_key] = {
            "key": ready_key,
            "code": "123273.SZ",
            "trading_date": self.trading_date,
            "status": "ready",
            "generation": 1,
            "requested_by": "postclose_automatic",
            "download_requested": True,
        }
        enqueued = []
        now = datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        with (
            mock.patch.object(module, "intraday_monitor_active", return_value=False),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "enqueue_intraday_backfill",
                side_effect=lambda code, date, **kwargs: (
                    enqueued.append((code, date, kwargs))
                    or {"deduplicated": False}
                ),
            ),
        ):
            result = module.scan_postclose_intraday_gaps(now)

        self.assertTrue(result["scheduled"])
        self.assertEqual(result["universe_source"], "sqlite_meta_codes")
        self.assertEqual([row[0] for row in enqueued], ["113647.SH"])
        self.assertEqual(module.INTRADAY_ASYNC_REFRESH_STATE[ready_key]["status"], "ready")

    def test_postclose_scan_upgrades_automatic_read_but_preserves_manual(self):
        module = self.module
        auto_key = f"123273.SZ:{self.trading_date}"
        manual_key = f"113647.SH:{self.trading_date}"
        module.INTRADAY_ASYNC_REFRESH_STATE.update(
            {
                auto_key: {
                    "key": auto_key,
                    "code": "123273.SZ",
                    "trading_date": self.trading_date,
                    "status": "waiting_for_market_close",
                    "generation": 4,
                    "requested_by": "automatic_read",
                    "download_requested": False,
                },
                manual_key: {
                    "key": manual_key,
                    "code": "113647.SH",
                    "trading_date": self.trading_date,
                    "status": "waiting_for_market_close",
                    "generation": 7,
                    "requested_by": "manual",
                    "download_requested": True,
                },
            }
        )
        enqueued = []
        now = datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        with (
            mock.patch.object(module, "intraday_monitor_active", return_value=False),
            mock.patch.object(module, "minute_rows_need_backfill", return_value=True),
            mock.patch.object(
                module,
                "enqueue_intraday_backfill",
                side_effect=lambda code, date, **kwargs: (
                    enqueued.append((code, date, kwargs))
                    or {"deduplicated": False}
                ),
            ),
        ):
            module.scan_postclose_intraday_gaps(now)

        self.assertEqual(len(enqueued), 1)
        code, _date, kwargs = enqueued[0]
        self.assertEqual(code, "123273.SZ")
        self.assertEqual(kwargs["requested_by"], "postclose_automatic")
        self.assertTrue(kwargs["download_requested"])
        self.assertEqual(kwargs["expected_generation"], 4)
        self.assertEqual(kwargs["expected_status"], "waiting_for_market_close")

    def test_requeue_cas_does_not_overwrite_newer_manual_generation(self):
        module = self.module
        key = f"123273.SZ:{self.trading_date}"
        module.INTRADAY_ASYNC_REFRESH_STATE[key] = {
            "key": key,
            "code": "123273.SZ",
            "trading_date": self.trading_date,
            "status": "interrupted",
            "generation": 1,
            "requested_by": "postclose_automatic",
            "download_requested": True,
            "retry_at_epoch": 0,
        }
        original_enqueue = module.enqueue_intraday_backfill
        injected = False

        def racing_enqueue(code, date, **kwargs):
            nonlocal injected
            if not injected:
                injected = True
                original_enqueue(
                    code,
                    date,
                    requested_by="manual",
                    download_requested=True,
                    priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
                )
            return original_enqueue(code, date, **kwargs)

        with (
            mock.patch.object(
                module,
                "intraday_download_permission",
                return_value=(True, "maintenance_window"),
            ),
            mock.patch.object(module, "intraday_automatic_window_open", return_value=True),
            mock.patch.object(module, "enqueue_intraday_backfill", side_effect=racing_enqueue),
        ):
            queued = module.requeue_due_intraday_backfills(
                datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
            )

        state = module.INTRADAY_ASYNC_REFRESH_STATE[key]
        self.assertEqual(queued, 0)
        self.assertEqual(state["requested_by"], "manual")
        self.assertEqual(state["priority"], module.INTRADAY_BACKFILL_MANUAL_PRIORITY)
        self.assertEqual(state["generation"], 2)

    def test_worker_survives_unexpected_job_exception(self):
        module = self.module
        first = module.enqueue_intraday_backfill(
            "123273.SZ",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        second = module.enqueue_intraday_backfill(
            "113647.SH",
            self.trading_date,
            requested_by="manual",
            download_requested=True,
            priority=module.INTRADAY_BACKFILL_MANUAL_PRIORITY,
        )
        calls = 0

        def flaky_execute(cache_key, generation, _state):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError("state disk full")
            module.finish_intraday_backfill_job(cache_key, generation, "ready", [])
            module.INTRADAY_BACKFILL_STOP_EVENT.set()

        module.INTRADAY_BACKFILL_STOP_EVENT.clear()
        with mock.patch.object(
            module,
            "execute_intraday_backfill_job",
            side_effect=flaky_execute,
        ):
            worker = threading.Thread(target=module.intraday_backfill_worker_loop)
            worker.start()
            worker.join(timeout=2)

        self.assertFalse(worker.is_alive())
        self.assertEqual(calls, 2)
        self.assertEqual(
            module.intraday_backfill_status_for_key(first["job_id"])["status"],
            "failed",
        )
        self.assertEqual(
            module.intraday_backfill_status_for_key(second["job_id"])["status"],
            "ready",
        )

    def test_partial_and_failed_jobs_are_retried_within_the_limit(self):
        module = self.module
        for index, status in enumerate(("partial", "failed"), start=1):
            code = f"12327{index}.SZ"
            key = f"{code}:{self.trading_date}"
            module.INTRADAY_ASYNC_REFRESH_STATE[key] = {
                "key": key,
                "code": code,
                "trading_date": self.trading_date,
                "status": status,
                "generation": 1,
                "requested_by": "manual",
                "download_requested": True,
                "retry_at_epoch": 0,
            }
        with mock.patch.object(
            module,
            "intraday_download_permission",
            return_value=(True, "after_market_close"),
        ):
            queued = module.requeue_due_intraday_backfills(
                datetime(2026, 8, 12, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
            )

        self.assertEqual(queued, 2)
        self.assertFalse(module.INTRADAY_BACKFILL_QUEUE.empty())


if __name__ == "__main__":
    unittest.main()
