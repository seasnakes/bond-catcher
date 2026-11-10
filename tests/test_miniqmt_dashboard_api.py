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
from contextlib import closing
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
            "MINIQMT_REDEEM_STATUS_DATABASE_PATH": str(
                runtime_root / "convertible-bond-market.sqlite3"
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

    def test_quote_backend_metadata_reports_actual_gateway_route(self):
        class GatewayBridge:
            def get(self, path, timeout=None):
                self.path = path
                self.timeout = timeout
                return {
                    "market": {
                        "configured": "bigqmt",
                        "active": "bigqmt",
                        "switch_count": 2,
                        "previous_close_validation": {
                            "reference": "miniqmt",
                            "validated_codes": 586,
                            "corrected_codes": 462,
                            "last_error": None,
                        },
                        "previous_close_backfill": {
                            "pending": 100,
                        },
                        "bigqmt_reference_data": {
                            "status": "stale",
                            "checked_codes": 586,
                            "mismatched_codes": 585,
                            "mismatch_ratio": 0.9983,
                            "restart_recommended": True,
                        },
                    }
                }

        bridge = GatewayBridge()
        payload = self.module.quote_backend_metadata(bridge)

        self.assertEqual(bridge.path, "/api/meta/qmt-backends")
        self.assertEqual(payload["active"], "bigqmt")
        self.assertEqual(payload["configured"], "bigqmt")
        self.assertFalse(payload["fallback_active"])
        self.assertEqual(payload["switch_count"], 2)
        self.assertEqual(payload["transport"], "zmq")
        self.assertEqual(payload["previous_close_reference"], "miniqmt")
        self.assertEqual(payload["previous_close_validated_codes"], 586)
        self.assertEqual(payload["previous_close_corrected_codes"], 462)
        self.assertEqual(payload["previous_close_backfill_pending"], 100)
        self.assertEqual(payload["bigqmt_reference_status"], "stale")
        self.assertEqual(payload["bigqmt_reference_checked_codes"], 586)
        self.assertEqual(payload["bigqmt_reference_mismatched_codes"], 585)
        self.assertAlmostEqual(payload["bigqmt_reference_mismatch_ratio"], 0.9983)
        self.assertTrue(payload["bigqmt_restart_recommended"])

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

    def test_active_index_current_table_hides_codes_absent_from_current_bond_list(self):
        filtered, removed = self.module.filter_active_index_current_constituents(
            [
                {"code": "118053.SH", "name": "正帆转债"},
                {"code": "111026.SH", "name": "派克转债"},
            ],
            {"111026.SH"},
        )
        self.assertEqual([row["code"] for row in filtered], ["111026.SH"])
        self.assertEqual(removed, 1)

        fail_safe, fail_safe_removed = (
            self.module.filter_active_index_current_constituents(
                [{"code": "118053.SH"}],
                set(),
            )
        )
        self.assertEqual([row["code"] for row in fail_safe], ["118053.SH"])
        self.assertEqual(fail_safe_removed, 0)
        self.assertTrue(
            self.module.is_directed_convertible_market_code("110815.SH")
        )
        self.assertTrue(
            self.module.is_directed_convertible_market_code("124025.SZ")
        )
        self.assertFalse(
            self.module.is_directed_convertible_market_code("113575.SH")
        )

    def test_jisilu_redeem_row_preserves_progress_and_recount_date(self):
        no_redeem = self.module.normalise_jisilu_redeem_cell(
            {
                "bond_id": "123160",
                "bond_nm": "泰福转债",
                "stock_id": "300992",
                "redeem_icon": "G",
                "redeem_count_days": 15,
                "redeem_real_days": 0,
                "redeem_total_days": 30,
                "redeem_remain_days": -1,
                "recount_dt": "2026-09-01",
                "redeem_price_ratio": "130%",
                "force_redeem_price": "25.610",
            }
        )
        self.assertEqual(no_redeem["status"], "公告不强赎")
        self.assertEqual(no_redeem["progress"], "0/15|30")
        self.assertEqual(no_redeem["next_recount_date"], "20260901")
        self.assertEqual(no_redeem["display_value"], "2026-09-01重计")
        self.assertIsNone(no_redeem["remaining_hit_days"])
        self.assertEqual(no_redeem["trigger_ratio"], 130.0)

        near = self.module.normalise_jisilu_redeem_cell(
            {
                "bond_id": "123261",
                "bond_nm": "普联转债",
                "redeem_icon": "",
                "redeem_count_days": 15,
                "redeem_real_days": 12,
                "redeem_total_days": 30,
                "redeem_remain_days": 3,
            }
        )
        self.assertEqual(near["status"], "临近强赎")
        self.assertEqual(near["progress"], "12/15|30")
        self.assertEqual(near["remaining_hit_days"], 3)

    def test_redeem_status_sqlite_keeps_only_latest_row_per_bond(self):
        row = self.module.normalise_jisilu_redeem_cell(
            {
                "bond_id": "123160",
                "bond_nm": "泰福转债",
                "redeem_icon": "G",
                "redeem_count_days": 15,
                "redeem_real_days": 0,
                "redeem_total_days": 30,
                "recount_dt": "2026-09-01",
            }
        )
        snapshot = {
            "ok": True,
            "source": "集思录 redeem_list",
            "fetched_at": "2026-08-28T15:20:00+08:00",
            "rows": {"123160": row},
        }
        with mock.patch.object(self.module, "REDEEM_DAILY_MIN_EXPECTED_ROWS", 1):
            first = self.module.persist_redeem_snapshot(
                "20260827", snapshot, calendar_source="fixture"
            )
            row["progress"] = "1/15|30"
            second = self.module.persist_redeem_snapshot(
                "20260828", snapshot, calendar_source="fixture"
            )

        self.assertTrue(first["recorded"])
        self.assertTrue(second["recorded"])
        stored = self.module.latest_local_redeem_status(
            "123160.SZ", on_or_before="20260828"
        )
        self.assertEqual(stored["trade_date"], "20260828")
        self.assertEqual(stored["progress"], "1/15|30")
        with closing(sqlite3.connect(self.module.REDEEM_STATUS_DATABASE_PATH)) as connection, connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM redeem_status_observations "
                "WHERE code='123160'"
            ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_redeem_snapshot_uses_latest_completed_exchange_session(self):
        dates = ["20260827", "20260828", "20260831"]
        with mock.patch.object(
            self.module, "latest_exchange_trade_dates", return_value=dates
        ):
            before_close = datetime(
                2026, 8, 28, 14, 0, tzinfo=ZoneInfo("Asia/Shanghai")
            )
            after_close = datetime(
                2026, 8, 28, 16, 45, tzinfo=ZoneInfo("Asia/Shanghai")
            )
            weekend = datetime(
                2026, 8, 30, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")
            )
            self.assertEqual(
                self.module.redeem_snapshot_trade_date(before_close)[0],
                "20260827",
            )
            self.assertEqual(
                self.module.redeem_snapshot_trade_date(after_close)[0],
                "20260828",
            )
            self.assertEqual(
                self.module.redeem_snapshot_trade_date(weekend)[0],
                "20260828",
            )

    def test_partial_redeem_refresh_does_not_replace_latest_complete_state(self):
        row = self.module.normalise_jisilu_redeem_cell(
            {
                "bond_id": "123261",
                "bond_nm": "普联转债",
                "redeem_count_days": 15,
                "redeem_real_days": 12,
                "redeem_total_days": 30,
            }
        )
        with mock.patch.object(self.module, "REDEEM_DAILY_MIN_EXPECTED_ROWS", 1):
            complete = self.module.persist_redeem_snapshot(
                "20260828",
                {
                    "ok": True,
                    "source": "fixture",
                    "fetched_at": "2026-08-28T15:20:00+08:00",
                    "rows": {"123261": row},
                },
                calendar_source="fixture",
            )
            partial = self.module.persist_redeem_snapshot(
                "20260831",
                {
                    "ok": False,
                    "source": "fixture",
                    "fetched_at": "2026-08-31T15:20:00+08:00",
                    "rows": {},
                    "error": "source incomplete",
                },
                calendar_source="fixture",
            )

        self.assertTrue(complete["recorded"])
        self.assertFalse(partial["recorded"])
        stored = self.module.latest_local_redeem_status("123261")
        self.assertEqual(stored["trade_date"], "20260828")
        self.assertEqual(stored["progress"], "12/15|30")

    def test_redeem_daily_refresh_fetches_market_only_once_when_current(self):
        row = self.module.normalise_jisilu_redeem_cell(
            {
                "bond_id": "123261",
                "bond_nm": "普联转债",
                "redeem_count_days": 15,
                "redeem_real_days": 12,
                "redeem_total_days": 30,
                "redeem_remain_days": 3,
            }
        )
        snapshot = {
            "ok": True,
            "source": "集思录 redeem_list",
            "fetched_at": "2026-08-28T15:20:00+08:00",
            "rows": {"123261": row},
        }
        now = datetime(2026, 8, 28, 15, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.module.REDEEM_DAILY_LAST_ATTEMPT_MONOTONIC = float("-inf")
        with (
            mock.patch.object(
                self.module,
                "redeem_snapshot_trade_date",
                return_value=("20260828", "fixture"),
            ),
            mock.patch.object(
                self.module,
                "jisilu_redeem_snapshot",
                return_value=snapshot,
            ) as fetch,
            mock.patch.object(self.module, "REDEEM_DAILY_MIN_EXPECTED_ROWS", 1),
        ):
            first = self.module.refresh_daily_redeem_snapshot_if_due(now)
            second = self.module.refresh_daily_redeem_snapshot_if_due(now)

        self.assertTrue(first["updated"])
        self.assertEqual(second["status"], "current")
        fetch.assert_called_once_with(force=True)

    def test_trading_payload_rejects_empty_asset(self):
        module = self.module

        def bridge_get(path, _params):
            if path.endswith("account_status"):
                return {"connected": True}
            if path.endswith("asset"):
                return None
            raise AssertionError(path)

        with (
            mock.patch.object(
                module,
                "configured_trading_accounts",
                return_value=[{"label": "普通户", "id": "masked", "type": ""}],
            ),
            mock.patch.object(module, "bridge_trading_get", side_effect=bridge_get),
        ):
            with self.assertRaisesRegex(RuntimeError, "账户资产返回为空"):
                module.trading_payload()

    def test_trading_payload_keeps_zero_positions_as_valid_account_data(self):
        module = self.module

        def bridge_get(path, _params):
            if path.endswith("account_status"):
                return {"connected": True}
            if path.endswith("asset"):
                return {
                    "cash": 1000,
                    "frozen_cash": 0,
                    "market_value": 0,
                    "total_asset": 1000,
                }
            if path.endswith(("positions", "orders", "trades")):
                return []
            raise AssertionError(path)

        with (
            mock.patch.object(
                module,
                "configured_trading_accounts",
                return_value=[{"label": "普通户", "id": "masked", "type": ""}],
            ),
            mock.patch.object(module, "bridge_trading_get", side_effect=bridge_get),
        ):
            payload = module.trading_payload()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["summary"]["total_asset"], 1000)
        self.assertEqual(payload["summary"]["current_position_count"], 0)
        self.assertEqual(payload["positions"], [])

    def test_disabled_trading_capabilities_skip_all_windows_requests(self):
        with mock.patch.object(self.module, "bridge_trading_get", return_value={
            "trading": {"configured": "disabled"}
        }) as get:
            payload = self.module.trading_capabilities_payload()
        get.assert_called_once_with("/api/meta/qmt-backends", {})
        self.assertFalse(payload["bridge_enabled"])
        self.assertFalse(payload["bridge_connected"])
        self.assertEqual(payload["accounts"], [])

    def test_trading_capabilities_require_account_connection(self):
        module = self.module

        def bridge_get(path, _params):
            if path.endswith("qmt-backends"):
                return {"trading": {"configured": "bigqmt"}}
            if path.endswith("health"):
                return {"trading": {"enabled": True, "connected": True}}
            if path.endswith("account_status"):
                return {"connected": False}
            raise AssertionError(path)

        with (
            mock.patch.object(
                module,
                "configured_trading_accounts",
                return_value=[{"label": "普通户", "id": "masked", "type": ""}],
            ),
            mock.patch.object(module, "bridge_trading_get", side_effect=bridge_get),
        ):
            payload = module.trading_capabilities_payload()

        self.assertTrue(payload["bridge_enabled"])
        self.assertFalse(payload["bridge_connected"])

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

    def test_new_bond_recent_scope_returns_inventory_for_more_than_second_day(self):
        module = self.module

        class CandidateBridge:
            def get(self, path, _params, timeout=10.0):
                del timeout
                if path.endswith("is_trading_date"):
                    return {"is_trading": True}
                if path.endswith("prev_trading_date"):
                    return {"prev_trading_date": "20260821"}
                raise AssertionError(path)

            def convertible_bonds(self):
                return ["123278.SZ"]

        rows = [
            {
                "code": "123278",
                "market_code": "123278.SZ",
                "secid": "0.123278",
                "name": "合金转债",
                "listing_date": "20260818",
            },
            {
                "code": "123280",
                "market_code": "123280.SZ",
                "secid": "0.123280",
                "name": "三鑫转债",
                "listing_date": "20260819",
            },
            {
                "code": "123001",
                "market_code": "123001.SZ",
                "secid": "0.123001",
                "name": "旧债",
                "listing_date": "20260701",
            },
        ]
        with (
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                lambda *args, **kwargs: CandidateBridge(),
            ),
            mock.patch.object(module, "latest_bond_reference_list", return_value=rows),
        ):
            payload = module.new_bond_candidates_payload(
                "20260824",
                scope="recent",
                lookback_days=10,
            )

        self.assertEqual(payload["scope"], "recent")
        self.assertEqual(
            [row["code"] for row in payload["candidates"]],
            ["123278", "123280"],
        )
        self.assertTrue(payload["candidates"][0]["in_miniqmt_list"])
        self.assertIn("每日新债存量对账", payload["candidates"][0]["discovery"])

    def test_new_bond_performance_aggregates_real_closes_and_aligns_endpoints(self):
        candidate = {
            "code": "123278",
            "market_code": "123278.SZ",
            "name": "合金转债",
            "stock_code": "300697.SZ",
            "stock_name": "电工合金",
            "listing_date": "20260825",
        }
        raw_rows = []
        for day_index, trading_date in enumerate(
            ("20260825", "20260826", "20260827", "20260828")
        ):
            for minute, close in (
                ("093100", 100 + day_index),
                ("094500", 101 + day_index),
                ("100000", 102 + day_index),
                ("130100", 103 + day_index),
            ):
                raw_rows.append(
                    {
                        "index": f"{trading_date}{minute}",
                        "close": close,
                    }
                )

        series, excluded = self.module.align_new_bond_performance_series(
            candidate,
            raw_rows,
            15,
        )

        self.assertIsNone(excluded)
        self.assertEqual(series["session_count"], 4)
        self.assertTrue(series["starts_on_listing_date"])
        self.assertFalse(series["listing_day_complete"])
        self.assertEqual(series["listing_day_raw_bar_count"], 4)
        self.assertEqual(series["points"][0]["progress"], 0)
        self.assertEqual(series["points"][-1]["progress"], 1)
        self.assertEqual(series["base_close"], 101)
        self.assertEqual(series["last_close"], 106)
        self.assertAlmostEqual(series["return_pct"], (106 / 101 - 1) * 100)

    def test_new_bond_performance_excludes_fewer_than_four_observed_sessions(self):
        candidate = {
            "code": "118076",
            "market_code": "118076.SH",
            "name": "先锋转债",
            "listing_date": "20260826",
        }
        rows = [
            {"index": f"{trading_date}094500", "close": 100 + index}
            for index, trading_date in enumerate(("20260826", "20260827", "20260828"))
        ]

        series, excluded = self.module.align_new_bond_performance_series(
            candidate,
            rows,
            30,
        )

        self.assertIsNone(series)
        self.assertEqual(excluded["reason"], "observed_sessions_below_4")
        self.assertEqual(excluded["observed_sessions"], 3)

    def test_new_bond_performance_daily_uses_actual_daily_bar_closes(self):
        candidate = {
            "code": "123278",
            "market_code": "123278.SZ",
            "name": "合金转债",
            "listing_date": "20260825",
        }
        rows = [
            {
                "index": trading_date,
                "open": close - 1,
                "high": close + 2,
                "low": close - 2,
                "close": close,
            }
            for trading_date, close in (
                ("20260825", 101.5),
                ("20260826", 104.2),
                ("20260827", 103.8),
                ("20260828", 106.6),
            )
        ]

        series, excluded = self.module.align_new_bond_performance_series(
            candidate,
            rows,
            1440,
        )

        self.assertIsNone(excluded)
        self.assertEqual(series["granularity"], "daily")
        self.assertEqual(series["close_definition"], "miniqmt_daily_bar_close")
        self.assertEqual(series["point_count"], 4)
        self.assertEqual(
            [point["close"] for point in series["points"]],
            [101.5, 104.2, 103.8, 106.6],
        )
        self.assertEqual(series["points"][0]["datetime"], "2026-08-25")
        self.assertEqual(series["points"][-1]["datetime"], "2026-08-28")
        self.assertTrue(series["listing_day_complete"])

    def test_new_bond_performance_payload_uses_selected_codes_and_read_only_cache(self):
        module = self.module
        candidates = [
            {
                "code": "123278",
                "market_code": "123278.SZ",
                "name": "合金转债",
                "stock_code": "300697.SZ",
                "stock_name": "电工合金",
                "listing_date": "20260818",
                "issue_scale_billion": 5.45,
                "rating": "AA-",
            },
            {
                "code": "123280",
                "market_code": "123280.SZ",
                "name": "三鑫转债",
                "stock_code": "300453.SZ",
                "stock_name": "三鑫医疗",
                "listing_date": "20260819",
                "issue_scale_billion": 5.3,
                "rating": "AA-",
            },
        ]
        rows = [
            {"index": f"{trading_date}094500", "close": 100 + index}
            for index, trading_date in enumerate(
                ("20260818", "20260819", "20260820", "20260821")
            )
        ]

        class PerformanceBridge:
            def get(self, path, params, timeout=10.0):
                del timeout
                self_path = path
                if not self_path.endswith("market_data_ex"):
                    raise AssertionError(path)
                self.assertEqual(params["period"], "1m")
                self.assertEqual(params["stocks"], "123278.SZ")
                return {"data": {"123278.SZ": rows}}

            def assertEqual(self, left, right):
                if left != right:
                    raise AssertionError(f"{left!r} != {right!r}")

        fixed_now = datetime(
            2026,
            8,
            31,
            16,
            0,
            tzinfo=ZoneInfo("Asia/Shanghai"),
        )
        module.NEW_BOND_PERFORMANCE_CACHE.clear()
        with (
            mock.patch.object(module, "china_now", return_value=fixed_now),
            mock.patch.object(module, "latest_bond_reference_list", return_value=candidates),
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                lambda *args, **kwargs: PerformanceBridge(),
            ),
        ):
            payload = module.new_bond_performance_payload(
                1,
                30,
                "123278.SZ",
            )
            cached = module.new_bond_performance_payload(
                1,
                30,
                "123278.SZ",
            )

        self.assertEqual(payload["mode"], "read_only")
        self.assertEqual(payload["selected_codes"], ["123278.SZ"])
        self.assertEqual(len(payload["universe"]), 2)
        self.assertEqual(len(payload["series"]), 1)
        self.assertTrue(cached["cached"])

    def test_new_bond_performance_payload_reads_daily_cache_for_daily_level(self):
        module = self.module
        candidates = [
            {
                "code": "123278",
                "market_code": "123278.SZ",
                "name": "合金转债",
                "stock_code": "300697.SZ",
                "stock_name": "电工合金",
                "listing_date": "20260818",
            }
        ]
        rows = [
            {"index": trading_date, "close": 100 + index}
            for index, trading_date in enumerate(
                ("20260818", "20260819", "20260820", "20260821")
            )
        ]

        class DailyPerformanceBridge:
            def get(self, path, params, timeout=10.0):
                del timeout
                if not path.endswith("market_data_ex"):
                    raise AssertionError(path)
                if params["period"] != "1d":
                    raise AssertionError(params["period"])
                if params["start_time"] != "20260818":
                    raise AssertionError(params["start_time"])
                return {"data": {"123278.SZ": rows}}

        fixed_now = datetime(
            2026,
            8,
            31,
            16,
            0,
            tzinfo=ZoneInfo("Asia/Shanghai"),
        )
        module.NEW_BOND_PERFORMANCE_CACHE.clear()
        with (
            mock.patch.object(module, "china_now", return_value=fixed_now),
            mock.patch.object(module, "latest_bond_reference_list", return_value=candidates),
            mock.patch.object(
                module.MONITOR,
                "BridgeClient",
                lambda *args, **kwargs: DailyPerformanceBridge(),
            ),
        ):
            payload = module.new_bond_performance_payload(
                1,
                1440,
                "123278.SZ",
            )

        self.assertEqual(payload["interval_label"], "日线")
        self.assertEqual(payload["granularity"], "daily")
        self.assertEqual(payload["coverage"]["raw_daily_row_count"], 4)
        self.assertEqual(payload["coverage"]["raw_minute_row_count"], 0)
        self.assertEqual(payload["series"][0]["last_close"], 103)

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
            "QMT最近交易日1m缓存",
        )

    def test_sparks_use_last_live_price_per_minute_and_exclude_preopen(self):
        module = self.module
        now = datetime(2026, 8, 12, 10, 7, tzinfo=ZoneInfo("Asia/Shanghai"))
        ms = int(now.replace(minute=5).timestamp() * 1000)
        midnight = int(now.replace(hour=0, minute=0).timestamp() * 1000)
        rows = [{"time": midnight, "price": 290.64},
                {"time": ms + 10000, "price": 274},
                {"time": ms + 50000, "price": 275},
                {"time": ms + 70000, "price": 276}]
        with (
            mock.patch.object(module, "china_now", return_value=now),
            mock.patch.object(module, "load_local_minute_bars", return_value={"123273.SZ": [{"time": ms, "close": 290.64}]}),
            mock.patch.object(module, "load_backfill_minute_bars", return_value={}),
            mock.patch.object(module, "load_live_intraday_samples", return_value={"123273.SZ": rows}),
        ):
            spark = module.sparks_payload("123273.SZ")["sparks"][0]
        self.assertEqual(spark["points"], [275, 276])
        self.assertEqual(spark["times"], ["1005", "1006"])

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
        corrected = {
            "code": "301127.SZ",
            **second,
            "time": first_timestamp + 22_000,
            "previous_close": 25.0,
        }
        self.module.persist_live_intraday_samples([corrected])

        reloaded = load_dashboard_module(self.runtime)
        points = reloaded.load_live_intraday_samples(
            ["301127.SZ"], self.trading_date
        )["301127.SZ"]
        self.assertEqual(
            [point["price"] for point in points], [25.2, 25.4, 25.4]
        )
        self.assertEqual(
            [point["amount"] for point in points], [110_000, 125_000, 125_000]
        )
        self.assertEqual([point["volume"] for point in points], [440, 500, 500])
        self.assertEqual(
            [point["previous_close"] for point in points], [25.0, 25.0, 25.0]
        )

    def test_legacy_live_spark_schema_remains_readable(self):
        database = self.runtime / "legacy-board-spark.sqlite3"
        with closing(sqlite3.connect(database)) as connection, connection:
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
            "QMT最近交易日1m缓存",
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

    def test_health_waits_for_continuous_session_but_checks_quotes_at_open(self):
        self.write_runtime_status(0, "2026-08-12T09:29:59")
        with closing(sqlite3.connect(self.runtime / "data" / f"{self.trading_date}.sqlite3")) as connection, connection:
            connection.execute("DELETE FROM minute_observations")
        auction = self.module.api_health(
            datetime(2026, 8, 12, 9, 29, 59, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertTrue(auction["ok"])
        self.assertFalse(auction["market_data_expected"])
        self.assertEqual(auction["reason"], "healthy_waiting_for_open")
        self.assertIsNone(auction["quote_updated_at"])
        opened = self.module.api_health(
            datetime(2026, 8, 12, 9, 30, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        )
        self.assertFalse(opened["ok"])
        self.assertIn("miniqmt_returned_zero_quotes", opened["reasons"])
        self.assertIn("quote_timestamp_missing", opened["reasons"])

    def test_health_does_not_hide_a_stopped_or_wrong_day_monitor_in_auction(self):
        self.write_runtime_status(0, "2026-08-12T09:25:00")
        current = datetime(2026, 8, 12, 9, 25, 5, tzinfo=ZoneInfo("Asia/Shanghai"))
        with mock.patch.object(self.module, "process_alive", return_value=False):
            self.assertIn("monitor_process_not_running", self.module.api_health(current)["reasons"])
        path = self.runtime / "status.json"
        status = json.loads(path.read_text())
        status["trading_date"] = "20260811"
        path.write_text(json.dumps(status))
        self.assertIn("monitor_trading_date_mismatch", self.module.api_health(current)["reasons"])

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

    def test_events_invalidates_browser_cursor_after_minute_history_repair(self):
        with closing(sqlite3.connect(self.runtime / "data" / f"{self.trading_date}.sqlite3")) as connection, connection:
            connection.execute("INSERT INTO meta(key,value) VALUES('event_history_reset_id','2')")
        reset = self.module.events_payload(scope="all", after_id=2)
        self.assertTrue(reset["cursor_reset"])
        self.assertEqual(reset["cursor_reset_reason"], "minute_history_repaired")
        self.assertEqual([event["id"] for event in reset["events"]], [3, 2, 1])
        self.assertFalse(self.module.events_payload(scope="all", after_id=reset["latest_id"])["cursor_reset"])

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
            with closing(sqlite3.connect(database)) as connection, connection:
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
        with closing(sqlite3.connect(missing_code_database)) as connection, connection:
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

        (self.runtime / "status.json").write_text(
            json.dumps({"status": "stopped", "trading_date": self.trading_date}),
            encoding="utf-8",
        )
        self.assertTrue(module.intraday_monitor_active(after))

    def test_download_permission_allows_the_evening_maintenance_window(self):
        module = self.module
        before = datetime(2026, 8, 12, 15, 11, 59, tzinfo=ZoneInfo("Asia/Shanghai"))
        inside = datetime(2026, 8, 12, 15, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        after = datetime(2026, 8, 12, 18, 0, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        closed = datetime(2026, 8, 12, 23, 30, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
        weekend = datetime(2026, 8, 15, 15, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
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
                "maintenance_window_closed",
            )
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, closed)[1],
                "maintenance_window_closed",
            )
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, weekend),
                (True, "weekend_manual_maintenance_window"),
            )

    def test_download_permission_allows_lunch_only_when_monitor_is_stopped(self):
        module = self.module
        lunch = datetime(2026, 8, 12, 12, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        afternoon = datetime(2026, 8, 12, 13, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        with mock.patch.object(module, "intraday_monitor_active", return_value=False):
            self.assertEqual(module.market_phase(lunch), ("lunch_break", False))
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, lunch),
                (True, "lunch_maintenance_window"),
            )
            self.assertTrue(module.intraday_automatic_window_open(lunch))
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, afternoon)[1],
                "waiting_for_market_close",
            )

        with mock.patch.object(module, "intraday_monitor_active", return_value=True):
            self.assertEqual(
                module.intraday_download_permission(self.trading_date, lunch),
                (False, "waiting_for_monitor_to_stop"),
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
        with closing(sqlite3.connect(database)) as connection, connection:
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

    def test_postclose_scan_accepts_lunch_maintenance_window(self):
        module = self.module
        enqueued = []
        now = datetime(2026, 8, 12, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        with (
            mock.patch.object(module, "intraday_monitor_active", return_value=False),
            mock.patch.object(
                module,
                "postclose_intraday_universe",
                return_value=({"123273.SZ"}, "fixture"),
            ),
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
        self.assertEqual(result["universe_source"], "fixture")
        self.assertEqual(len(enqueued), 1)

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
