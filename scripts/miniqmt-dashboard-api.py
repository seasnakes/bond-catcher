#!/usr/bin/env python3
"""Read-only HTTP API for the local MiniQMT intraday indicator dashboard."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import queue
import re
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from contextlib import closing
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from trading_execution import TradingError, TradingGuard


DEFAULT_MONITOR_ROOT = Path(
    "/Users/seasnake/Documents/Codex/2026-07-27/miniqmt/"
    "outputs/miniqmt_cb_shortline_monitor"
)
MONITOR_ROOT = Path(
    os.environ.get("MINIQMT_MONITOR_ROOT", DEFAULT_MONITOR_ROOT)
).expanduser()
RUNTIME_ROOT = Path(
    os.environ.get("MINIQMT_RUNTIME_ROOT", MONITOR_ROOT / "runtime")
).expanduser()
DATA_ROOT = RUNTIME_ROOT / "data"
STATUS_PATH = RUNTIME_ROOT / "status.json"
SERVICE_PATH = RUNTIME_ROOT / "service.json"
MONITOR_HISTORY_REPAIR_PRIORITY_PATH = (
    RUNTIME_ROOT / "history-repair-priority.json"
)
CODE_PATTERN = re.compile(r"^(110|111|113|118|123|127|128)\d{3}$")
MARKET_CODE_PATTERN = re.compile(r"^\d{6}\.(SH|SZ)$")
QMT_BRIDGE_HOST = os.environ.get("QMT_BRIDGE_HOST", "10.211.55.3")
QMT_BRIDGE_PORT = int(os.environ.get("QMT_BRIDGE_PORT", "18888"))
FOCUS_EVENT_TYPES = {
    "accelerate_up",
    "accelerate_down",
    "urgent_up",
    "urgent_down",
    "sudden_rise",
    "sudden_fall",
    "suspected_large_buy",
    "suspected_large_sell",
    "visible_bid_large_order",
    "visible_ask_large_order",
    "macd_underwater_golden_cross",
    "macd_above_water_golden_cross",
    "underwater_golden_cross_purple_confirmed",
    "purple_line_pullback_reclaim",
    "intraday_average_pullback_reclaim",
    "dark_funds_inflow_start",
    "dark_funds_outflow_start",
    "visible_funds_inflow_start",
    "visible_funds_strong_inflow",
    "visible_funds_strong_exit",
    "strong_interval_volume",
    "new_high_acceleration",
    "new_low_acceleration",
    "platform_dive",
    "pole_jump",
    "near_up_limit",
    "at_up_limit",
    "high_pullback",
    "low_rebound",
}
DAILY_CACHE_TTL_SECONDS = 300
DAILY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
INTRADAY_CACHE_TTL_SECONDS = 300
# The local monitor and live tick path supply the growing current session. The
# Bridge minute cache is only needed to fill earlier gaps, so refreshing it on
# every fifth 2-second detail poll adds latency without improving the chart.
INTRADAY_CURRENT_CACHE_TTL_SECONDS = 60
INTRADAY_BACKFILL_RETRIES = 3
INTRADAY_BACKFILL_WAIT_SECONDS = 0.4
INTRADAY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
# Board sparklines reuse the same full_tick requests as the quote refresh.  The
# dashboard API keeps a small in-memory sample buffer instead of starting a
# second Bridge poller or asking an external data vendor for another series.
LIVE_INTRADAY_MAX_POINTS = 480
LIVE_INTRADAY_SAMPLE_MIN_GAP_MS = 10_000
LIVE_INTRADAY_SAMPLES: dict[str, list[dict[str, Any]]] = {}
LIVE_INTRADAY_LOCK = threading.RLock()
LIVE_INTRADAY_DATABASE_PATH = Path(
    os.environ.get(
        "MINIQMT_BOARD_SPARK_DATABASE_PATH",
        RUNTIME_ROOT / "board-spark-samples.sqlite3",
    )
).expanduser()
LIVE_INTRADAY_PERSIST_LOCK = threading.Lock()
INTRADAY_DOWNLOAD_BACKOFF_INITIAL_SECONDS = 30
INTRADAY_DOWNLOAD_BACKOFF_MAX_SECONDS = 300
INTRADAY_DOWNLOAD_BACKOFF: dict[str, dict[str, Any]] = {}
INTRADAY_ASYNC_REFRESH_TIMEOUT_SECONDS = 5.0
INTRADAY_ASYNC_REFRESH_RETRY_SECONDS = 30.0
INTRADAY_ASYNC_REFRESH_LOCK = threading.RLock()
INTRADAY_ASYNC_REFRESH_STATE: dict[str, dict[str, Any]] = {}
INTRADAY_ASYNC_ACTIVE_KEY: str | None = None
INTRADAY_BACKFILL_MANUAL_PRIORITY = 0
INTRADAY_BACKFILL_READ_PRIORITY = 20
INTRADAY_BACKFILL_AUTOMATIC_PRIORITY = 100
INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS = 1.0
INTRADAY_BACKFILL_VERIFY_RETRIES = 3
INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS = 1.0
INTRADAY_BACKFILL_MAX_RETRIES = int(
    os.environ.get("MINIQMT_BACKFILL_MAX_RETRIES", "3")
)
INTRADAY_BACKFILL_FAILURE_PAUSE_AFTER = 3
INTRADAY_BACKFILL_FAILURE_PAUSE_SECONDS = 300.0
INTRADAY_BACKFILL_AUTOMATIC_START = os.environ.get(
    "MINIQMT_BACKFILL_AUTOMATIC_START", "15:12:00"
)
INTRADAY_BACKFILL_AUTOMATIC_END = os.environ.get(
    "MINIQMT_BACKFILL_AUTOMATIC_END", "23:30:00"
)
INTRADAY_BACKFILL_QUEUE: queue.PriorityQueue[tuple[int, int, str, int]] = (
    queue.PriorityQueue()
)
INTRADAY_BACKFILL_SEQUENCE = 0
INTRADAY_BACKFILL_WORKER_THREAD: threading.Thread | None = None
INTRADAY_BACKFILL_SCHEDULER_THREAD: threading.Thread | None = None
INTRADAY_BACKFILL_STOP_EVENT = threading.Event()
INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC = -math.inf
INTRADAY_BACKFILL_CONSECUTIVE_FAILURES = 0
INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC = 0.0
INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE = ""
INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE = ""
INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES: set[str] = set()
INTRADAY_BACKFILL_STATE_LOADED = False
INTRADAY_BACKFILL_PERSIST_LOCK = threading.Lock()
INTRADAY_BACKFILL_CACHE_PERSIST_LOCK = threading.Lock()
MONITOR_HISTORY_REPAIR_PRIORITY_LOCK = threading.Lock()
DETAIL_TICK_TIMEOUT_SECONDS = float(
    os.environ.get("MINIQMT_DETAIL_TICK_TIMEOUT_SECONDS", "0.75")
)
HEALTH_STATUS_MAX_AGE_SECONDS = float(
    os.environ.get("MINIQMT_HEALTH_STATUS_MAX_AGE_SECONDS", "30")
)
HEALTH_QUOTE_MAX_AGE_SECONDS = float(
    os.environ.get("MINIQMT_HEALTH_QUOTE_MAX_AGE_SECONDS", "180")
)
CHINA_TIME_ZONE = ZoneInfo("Asia/Shanghai")
HISTORICAL_VOLUME_CACHE: dict[
    str,
    tuple[float, tuple[float | None, float | None]],
] = {}
FINANCE_ROOT = Path(__file__).resolve().parents[1]
BOARD_STATE_PATH = Path(
    os.environ.get(
        "FINANCE_BOARD_STATE_PATH",
        FINANCE_ROOT / "data" / "board-state.json",
    )
).expanduser()
INTRADAY_BACKFILL_STATE_PATH = Path(
    os.environ.get(
        "MINIQMT_BACKFILL_STATE_PATH",
        FINANCE_ROOT / "runtime" / "intraday-backfill-jobs.json",
    )
).expanduser()
INTRADAY_BACKFILL_CACHE_ROOT = Path(
    os.environ.get(
        "MINIQMT_BACKFILL_CACHE_ROOT",
        INTRADAY_BACKFILL_STATE_PATH.parent / "intraday-backfill-cache",
    )
).expanduser()
TRADING_GUARD = TradingGuard(
    audit_path=FINANCE_ROOT / "runtime" / "trading-audit.jsonl",
)
ACTIVE_INDEX_DATA_PATH = FINANCE_ROOT / "data" / "active-convertible-bond-index.json"
BOND_TAGS_DATA_PATH = FINANCE_ROOT / "data" / "convertible-bond-tags.json"
BOND_TAG_SOURCE_DATA_PATH = FINANCE_ROOT / "data" / "convertible-bond-tag-source.json"
ACTIVE_INDEX_UNIVERSE_PATH = FINANCE_ROOT / "runtime" / "active-index-universes.json"
ACTIVE_INDEX_CACHE_TTL_SECONDS = 6
ACTIVE_INDEX_CACHE: tuple[float, dict[str, Any]] | None = None
ACTIVE_INDEX_NAME_CACHE: dict[str, str] = {}
EVENT_MARKET_CACHE_TTL_SECONDS = 5
EVENT_MARKET_CACHE: dict[str, tuple[float, dict[str, float | None]]] = {}
ACTIVE_INDEX_TICK_MINUTES: dict[
    str,
    dict[str, dict[int, dict[str, Any]]],
] = {}
ACTIVE_INDEX_THRESHOLD = 200_000_000
BOND_TAGS_CACHE: tuple[float, dict[str, Any], dict[str, dict[str, Any]]] | None = None
BOND_FUNDAMENTALS_CACHE: tuple[float, dict[str, dict[str, Any]]] | None = None
BOND_METADATA_CACHE_TTL_SECONDS = 300
BOND_METADATA_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
REDEEM_NOTICE_CACHE_TTL_SECONDS = 21_600
REDEEM_NOTICE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
BOND_REFERENCE_CACHE_TTL_SECONDS = 21_600
BOND_REFERENCE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
NEW_BOND_REFERENCE_CACHE_TTL_SECONDS = 300
NEW_BOND_REFERENCE_LIST_CACHE: tuple[float, list[dict[str, Any]]] | None = None
EXCHANGE_TRADE_DATE_CACHE_TTL_SECONDS = 21_600
EXCHANGE_TRADE_DATE_CACHE: tuple[float, list[str]] | None = None
PURPLE_BREAK_TOLERANCE = 0.001
PURPLE_BREAK_CONFIRM_BARS = 2
BRIDGE_CONFIG_CACHE: dict[str, str] = {}


def bridge_config_value(name: str, default: str = "") -> str:
    direct = os.environ.get(name, "").strip()
    if direct:
        return direct
    if name in BRIDGE_CONFIG_CACHE:
        return BRIDGE_CONFIG_CACHE[name] or default
    configured_path = os.environ.get("QMT_BRIDGE_ENV_FILE", "").strip()
    candidates = [
        Path(configured_path).expanduser() if configured_path else None,
        FINANCE_ROOT / ".env",
        Path.home() / ".codex" / ".env",
    ]
    values: dict[str, str] = {}
    for candidate in candidates:
        if candidate is None or not candidate.is_file():
            continue
        try:
            for raw_line in candidate.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if not key.startswith("QMT_BRIDGE_") or key in values:
                    continue
                values[key] = value.strip().strip('"').strip("'")
        except OSError:
            continue
    BRIDGE_CONFIG_CACHE.update(values)
    return BRIDGE_CONFIG_CACHE.get(name, default)


def load_monitor_module() -> Any:
    source = MONITOR_ROOT / "shortline_monitor.py"
    if not source.exists():
        raise FileNotFoundError(f"MiniQMT monitor source not found: {source}")
    spec = importlib.util.spec_from_file_location("miniqmt_shortline_monitor", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load MiniQMT monitor source: {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


MONITOR = load_monitor_module()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def request_monitor_history_repair_priority(
    stored_code: str,
    trading_date: str,
    *,
    reason: str = "dashboard_visible_gap",
) -> bool:
    """Give the live monitor the currently viewed code's next repair slot."""
    now = time.time()
    payload = {
        "version": 1,
        "code": str(stored_code).upper(),
        "trading_date": str(trading_date),
        "reason": str(reason),
        "requested_at_epoch": now,
        "expires_at_epoch": now + 45.0,
    }
    try:
        with MONITOR_HISTORY_REPAIR_PRIORITY_LOCK:
            MONITOR_HISTORY_REPAIR_PRIORITY_PATH.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            temporary = MONITOR_HISTORY_REPAIR_PRIORITY_PATH.with_name(
                f"{MONITOR_HISTORY_REPAIR_PRIORITY_PATH.name}.{os.getpid()}"
                f".{threading.get_ident()}.{time.time_ns()}.tmp"
            )
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            temporary.replace(MONITOR_HISTORY_REPAIR_PRIORITY_PATH)
        return True
    except (OSError, TypeError, ValueError):
        return False


def load_bond_tags() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    global BOND_TAGS_CACHE
    modified_at = BOND_TAGS_DATA_PATH.stat().st_mtime
    if BOND_TAGS_CACHE and BOND_TAGS_CACHE[0] == modified_at:
        return BOND_TAGS_CACHE[1], BOND_TAGS_CACHE[2]
    payload = read_json(BOND_TAGS_DATA_PATH)
    rows = list(payload.get("rows") or [])
    by_code: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.get("code") or "").upper()
        if not MARKET_CODE_PATTERN.fullmatch(code):
            continue
        by_code[code] = row
        by_code[code.split(".")[0]] = row
    BOND_TAGS_CACHE = (modified_at, payload, by_code)
    return payload, by_code


def bond_tag_row(code: str) -> dict[str, Any]:
    try:
        _, by_code = load_bond_tags()
    except OSError:
        return {}
    return by_code.get(str(code or "").upper()) or {}


def bond_tags(code: str) -> list[str]:
    return [
        str(value)
        for value in bond_tag_row(code).get("tags") or []
        if str(value)
    ]


def load_bond_fundamentals() -> dict[str, dict[str, Any]]:
    global BOND_FUNDAMENTALS_CACHE
    modified_at = BOND_TAG_SOURCE_DATA_PATH.stat().st_mtime
    if BOND_FUNDAMENTALS_CACHE and BOND_FUNDAMENTALS_CACHE[0] == modified_at:
        return BOND_FUNDAMENTALS_CACHE[1]
    payload = read_json(BOND_TAG_SOURCE_DATA_PATH)
    values = list(payload.get("values") or [])
    if not values:
        return {}
    headers = [str(value) for value in values[0]]
    by_code: dict[str, dict[str, Any]] = {}
    for values_row in values[1:]:
        row = {
            header: values_row[index] if index < len(values_row) else None
            for index, header in enumerate(headers)
        }
        code = str(row.get("转债代码") or "").upper()
        if not MARKET_CODE_PATTERN.fullmatch(code):
            continue
        by_code[code] = row
        by_code[code.split(".")[0]] = row
    BOND_FUNDAMENTALS_CACHE = (modified_at, by_code)
    return by_code


def stock_market_code(value: Any) -> str:
    code = re.sub(r"\D", "", str(value or ""))[:6]
    if len(code) != 6:
        return ""
    return f"{code}.{'SH' if code.startswith(('5', '6', '9')) else 'SZ'}"


def tags_payload(code_input: str = "", tag_input: str = "") -> dict[str, Any]:
    payload, _ = load_bond_tags()
    rows = list(payload.get("rows") or [])
    if code_input:
        lookup = bond_tag_row(code_input)
        rows = [lookup] if lookup else []
    if tag_input:
        rows = [
            row
            for row in rows
            if tag_input in (row.get("tags") or [])
        ]
    return clean_json(
        {
            "ok": True,
            "asOf": payload.get("asOf"),
            "source": payload.get("source"),
            "definitions": payload.get("definitions") or {},
            "tagOrder": payload.get("tagOrder") or [],
            "tagCounts": payload.get("tagCounts") or {},
            "count": len(rows),
            "rows": rows,
        }
    )


def available_databases() -> list[Path]:
    if not DATA_ROOT.exists():
        return []
    return sorted(
        (
            path
            for path in DATA_ROOT.glob("*.sqlite3")
            if re.fullmatch(r"\d{8}", path.stem)
        ),
        key=lambda path: path.stem,
        reverse=True,
    )


def database_for_date(trading_date: str = "") -> Path:
    databases = available_databases()
    if not databases:
        raise FileNotFoundError(f"No MiniQMT database found in {DATA_ROOT}")
    if trading_date:
        candidate = DATA_ROOT / f"{trading_date}.sqlite3"
        if candidate in databases:
            return candidate
        raise FileNotFoundError(f"MiniQMT database not found for {trading_date}")
    return databases[0]


def connect_read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(
        f"file:{path.resolve()}?mode=ro",
        uri=True,
        timeout=2.0,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA busy_timeout=2000")
    return connection


def normalize_code(value: str) -> str:
    code = str(value or "").strip().upper()
    code = code.split(".")[0] if "." in code else code
    code = re.sub(r"\D", "", code)
    if not CODE_PATTERN.fullmatch(code):
        raise ValueError("仅支持六位沪深可转债代码")
    return code


def monitor_code(code: str) -> str:
    market = "SH" if code.startswith(("110", "111", "113", "118")) else "SZ"
    return f"{code}.{market}"


def normalize_market_code(value: str) -> str:
    code = str(value or "").strip().upper()
    if not MARKET_CODE_PATTERN.fullmatch(code):
        raise ValueError("行情代码必须为六位代码加.SH或.SZ")
    return code


def market_code_to_secid(code: str) -> str:
    return f"{'1' if code.endswith('.SH') else '0'}.{code[:6]}"


def finite_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clean_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def live_quote_timestamp(quote: dict[str, Any]) -> int:
    timestamp = int(quote.get("timestamp") or 0)
    if timestamp > 0:
        return timestamp
    digits = re.sub(r"\D", "", str(quote.get("timetag") or ""))
    if len(digits) < 14:
        return 0
    try:
        moment = datetime.strptime(digits[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return 0
    return int(china_now(moment).timestamp() * 1000)


def record_live_intraday_sample(
    market_code: str,
    quote: dict[str, Any],
) -> dict[str, Any] | None:
    price = finite_or_none(quote.get("price"))
    timestamp = live_quote_timestamp(quote)
    trading_date = compact_date(quote.get("date") or quote.get("timetag"))
    if (
        not MARKET_CODE_PATTERN.fullmatch(market_code)
        or price is None
        or price <= 0
        or timestamp <= 0
        or len(trading_date) != 8
        or trading_date != china_now().strftime("%Y%m%d")
    ):
        return None

    sample = {
        "time": timestamp,
        "price": price,
        "date": trading_date,
    }
    should_persist = True
    with LIVE_INTRADAY_LOCK:
        points = LIVE_INTRADAY_SAMPLES.setdefault(market_code, [])
        if points and points[-1].get("date") != trading_date:
            points.clear()
        if (
            points
            and timestamp - int(points[-1].get("time") or 0)
            < LIVE_INTRADAY_SAMPLE_MIN_GAP_MS
        ):
            # Keep the bucket's original timestamp. Moving it on every fast
            # refresh would prevent a new bucket from ever opening.
            sample["time"] = int(points[-1].get("time") or timestamp)
            points[-1] = sample
            should_persist = False
        else:
            points.append(sample)
        if len(points) > LIVE_INTRADAY_MAX_POINTS:
            del points[:-LIVE_INTRADAY_MAX_POINTS]
    return {**sample, "should_persist": should_persist}


def persist_live_intraday_samples(samples: list[dict[str, Any]]) -> None:
    rows: list[tuple[str, str, int, float]] = []
    for sample in samples:
        code = str(sample.get("code") or "")
        trading_date = compact_date(sample.get("date"))
        timestamp = int(sample.get("time") or 0)
        price = finite_or_none(sample.get("price"))
        if (
            MARKET_CODE_PATTERN.fullmatch(code)
            and len(trading_date) == 8
            and timestamp > 0
            and price is not None
            and price > 0
        ):
            rows.append((trading_date, code, timestamp, price))
    if not rows:
        return

    try:
        with LIVE_INTRADAY_PERSIST_LOCK:
            LIVE_INTRADAY_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(LIVE_INTRADAY_DATABASE_PATH)) as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS board_spark_samples(
                      trading_date TEXT NOT NULL,
                      code TEXT NOT NULL,
                      timestamp INTEGER NOT NULL,
                      price REAL NOT NULL,
                      PRIMARY KEY(trading_date,code,timestamp)
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_board_spark_samples_date_code
                    ON board_spark_samples(trading_date,code,timestamp)
                    """
                )
                connection.executemany(
                    """
                    INSERT OR REPLACE INTO board_spark_samples(
                      trading_date,code,timestamp,price
                    ) VALUES(?,?,?,?)
                    """,
                    rows,
                )
                connection.execute(
                    """
                    DELETE FROM board_spark_samples
                    WHERE trading_date NOT IN (
                      SELECT trading_date
                      FROM board_spark_samples
                      GROUP BY trading_date
                      ORDER BY trading_date DESC
                      LIMIT 5
                    )
                    """
                )
                connection.commit()
    except (OSError, sqlite3.Error):
        # Persistence must never break the primary full_tick quote path.
        return


def load_persisted_live_intraday_samples(
    codes: list[str],
    trading_date: str,
) -> dict[str, list[dict[str, Any]]]:
    result = {code: [] for code in codes}
    if not codes or not LIVE_INTRADAY_DATABASE_PATH.exists():
        return result
    try:
        with closing(sqlite3.connect(LIVE_INTRADAY_DATABASE_PATH)) as connection:
            connection.row_factory = sqlite3.Row
            for index in range(0, len(codes), 400):
                batch = codes[index : index + 400]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT code,timestamp,price
                    FROM board_spark_samples
                    WHERE trading_date=? AND code IN ({placeholders})
                    ORDER BY code,timestamp
                    """,
                    (trading_date, *batch),
                ).fetchall()
                for row in rows:
                    code = str(row["code"])
                    result.setdefault(code, []).append(
                        {
                            "time": int(row["timestamp"]),
                            "price": float(row["price"]),
                            "date": trading_date,
                        }
                    )
    except (OSError, sqlite3.Error):
        return {code: [] for code in codes}
    return result


def available_live_intraday_dates() -> list[str]:
    if not LIVE_INTRADAY_DATABASE_PATH.exists():
        return []
    try:
        with closing(sqlite3.connect(LIVE_INTRADAY_DATABASE_PATH)) as connection:
            return [
                str(row[0])
                for row in connection.execute(
                    """
                    SELECT trading_date
                    FROM board_spark_samples
                    GROUP BY trading_date
                    ORDER BY trading_date DESC
                    LIMIT 10
                    """
                ).fetchall()
            ]
    except (OSError, sqlite3.Error):
        return []


def load_live_intraday_samples(
    codes: list[str],
    trading_date: str,
) -> dict[str, list[dict[str, Any]]]:
    persisted = load_persisted_live_intraday_samples(codes, trading_date)
    with LIVE_INTRADAY_LOCK:
        memory = {
            code: [
                dict(point)
                for point in LIVE_INTRADAY_SAMPLES.get(code, [])
                if point.get("date") == trading_date
            ]
            for code in codes
        }
    output: dict[str, list[dict[str, Any]]] = {}
    for code in codes:
        by_time = {
            int(point.get("time") or 0): point
            for point in persisted.get(code, [])
            if int(point.get("time") or 0) > 0
        }
        for point in memory.get(code, []):
            timestamp = int(point.get("time") or 0)
            if timestamp > 0:
                by_time[timestamp] = point
        output[code] = [by_time[timestamp] for timestamp in sorted(by_time)]
    return output


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def china_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(CHINA_TIME_ZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=CHINA_TIME_ZONE)
    return value.astimezone(CHINA_TIME_ZONE)


def market_phase(now: datetime | None = None) -> tuple[str, bool]:
    current = china_now(now)
    if current.weekday() >= 5:
        return "closed", False
    clock = current.strftime("%H:%M:%S")
    if "09:15:00" <= clock < "09:30:00":
        return "auction", True
    if "09:30:00" <= clock <= "11:30:30":
        return "morning", True
    if "11:30:30" < clock < "13:00:00":
        return "lunch_break", False
    if "13:00:00" <= clock <= "15:00:30":
        return "afternoon", True
    return "closed", False


def parse_china_datetime(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or ""))
    except ValueError:
        return None
    return china_now(parsed)


def latest_quote_timestamp(database: Path | None) -> datetime | None:
    if database is None:
        return None
    try:
        with closing(connect_read_only(database)) as connection:
            row = connection.execute(
                "SELECT MAX(minute_ms) AS minute_ms FROM minute_observations"
            ).fetchone()
    except (OSError, sqlite3.Error):
        return None
    minute_ms = int(row["minute_ms"] or 0) if row else 0
    if minute_ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(minute_ms / 1000, CHINA_TIME_ZONE)
    except (OSError, OverflowError, ValueError):
        return None


def api_health(now: datetime | None = None) -> dict[str, Any]:
    current = china_now(now)
    databases = available_databases()
    status = read_json(STATUS_PATH)
    service = read_json(SERVICE_PATH)
    pid = int(service.get("pid") or 0)
    latest = databases[0] if databases else None
    calendar_date = current.strftime("%Y%m%d")
    monitor_alive = process_alive(pid)
    phase, market_data_expected = market_phase(current)
    status_updated_at = parse_china_datetime(status.get("updated_at"))
    status_age_seconds = (
        max(0.0, (current - status_updated_at).total_seconds())
        if status_updated_at
        else None
    )
    quote_updated_at = latest_quote_timestamp(latest)
    quote_age_seconds = (
        max(0.0, (current - quote_updated_at).total_seconds())
        if quote_updated_at
        else None
    )
    last_returned_codes = max(0, int(status.get("last_returned_codes") or 0))
    reasons: list[str] = []
    if latest is None:
        reasons.append("database_missing")
    if not monitor_alive:
        reasons.append("monitor_process_not_running")
    if not status:
        reasons.append("monitor_status_missing")
    elif status.get("status") != "running":
        reasons.append(f"monitor_status_{status.get('status') or 'unknown'}")
    if status_age_seconds is None:
        reasons.append("monitor_status_timestamp_missing")
    elif status_age_seconds > HEALTH_STATUS_MAX_AGE_SECONDS:
        reasons.append("monitor_status_stale")
    if market_data_expected:
        if latest is None or latest.stem != calendar_date:
            reasons.append("today_database_missing")
        if str(status.get("trading_date") or "") != calendar_date:
            reasons.append("monitor_trading_date_mismatch")
        if last_returned_codes <= 0:
            reasons.append("miniqmt_returned_zero_quotes")
        if phase in {"morning", "afternoon"}:
            if quote_age_seconds is None:
                reasons.append("quote_timestamp_missing")
            elif quote_age_seconds > HEALTH_QUOTE_MAX_AGE_SECONDS:
                reasons.append("quote_data_stale")
    ok = not reasons
    return {
        "ok": ok,
        "degraded": not ok,
        "reason": reasons[0] if reasons else (
            "healthy" if market_data_expected else "healthy_outside_market_session"
        ),
        "reasons": reasons,
        "mode": "read_only",
        "monitor_alive": monitor_alive,
        "monitor_pid": pid or None,
        "calendar_date": calendar_date,
        "market_phase": phase,
        "market_data_expected": market_data_expected,
        "last_returned_codes": last_returned_codes,
        "status_updated_at": (
            status_updated_at.isoformat(timespec="seconds")
            if status_updated_at
            else None
        ),
        "status_age_seconds": status_age_seconds,
        "status_max_age_seconds": HEALTH_STATUS_MAX_AGE_SECONDS,
        "quote_updated_at": (
            quote_updated_at.isoformat(timespec="seconds")
            if quote_updated_at
            else None
        ),
        "quote_age_seconds": quote_age_seconds,
        "quote_max_age_seconds": HEALTH_QUOTE_MAX_AGE_SECONDS,
        "latest_trading_date": latest.stem if latest else None,
        "latest_database_is_today": bool(
            latest and latest.stem == calendar_date
        ),
        "available_dates": [path.stem for path in databases],
        "database_updated_at": (
            datetime.fromtimestamp(latest.stat().st_mtime).isoformat(timespec="seconds")
            if latest
            else None
        ),
        "status": status,
    }


def quotes_payload(codes_input: str) -> dict[str, Any]:
    codes: list[str] = []
    for value in str(codes_input or "").split(","):
        if not value.strip():
            continue
        try:
            code = normalize_market_code(value)
        except ValueError:
            continue
        if code not in codes:
            codes.append(code)
    if not codes:
        raise ValueError("缺少有效的MiniQMT行情代码")
    if len(codes) > 500:
        raise ValueError("单次最多查询500个行情代码")

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=8.0,
    )
    ticks: dict[str, dict[str, Any]] = {}
    for index in range(0, len(codes), 100):
        ticks.update(bridge.full_tick(codes[index : index + 100]))

    quotes: list[dict[str, Any]] = []
    persisted_samples: list[dict[str, Any]] = []
    for code in codes:
        tick = ticks.get(code)
        if not isinstance(tick, dict):
            continue
        price = finite_or_none(tick.get("lastPrice"))
        previous_close = finite_or_none(tick.get("lastClose"))
        if price is None or price <= 0:
            continue
        change = (
            (price / previous_close - 1) * 100
            if previous_close is not None and previous_close > 0
            else None
        )
        timetag = str(tick.get("timetag") or "")
        quotes.append(
            {
                "secid": f"{'1' if code.endswith('.SH') else '0'}.{code[:6]}",
                "code": code[:6],
                "monitor_code": code,
                "price": price,
                "change": change,
                "amount": finite_or_none(tick.get("amount")) or 0,
                "volume": finite_or_none(tick.get("volume")) or 0,
                "open": finite_or_none(tick.get("open")),
                "high": finite_or_none(tick.get("high")),
                "low": finite_or_none(tick.get("low")),
                "previousClose": previous_close,
                "date": timetag[:8],
                "time": timetag[9:17],
                "timetag": timetag,
                "timestamp": int(tick.get("time") or 0),
                "source": "MiniQMT full_tick",
            }
        )
        sample = record_live_intraday_sample(code, quotes[-1])
        if sample and sample.pop("should_persist", False):
            persisted_samples.append({"code": code, **sample})

    persist_live_intraday_samples(persisted_samples)

    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": "MiniQMT full_tick",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "bridge": f"{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
            "requested": len(codes),
            "returned": len(quotes),
            "failed": [code for code in codes if code not in ticks],
            "quotes": quotes,
        }
    )


def order_book_payload(code_input: str) -> dict[str, Any]:
    stored_code = normalize_market_code(code_input)
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=8.0,
    )
    tick = bridge.full_tick([stored_code]).get(stored_code)
    if not isinstance(tick, dict):
        raise LookupError(f"{stored_code} 暂无实时盘口")

    def levels(price_key: str, volume_key: str) -> list[dict[str, Any]]:
        prices = list(tick.get(price_key) or [])[:5]
        volumes = list(tick.get(volume_key) or [])[:5]
        output: list[dict[str, Any]] = []
        for index in range(5):
            price = finite_or_none(prices[index]) if index < len(prices) else None
            volume = finite_or_none(volumes[index]) if index < len(volumes) else None
            output.append(
                {
                    "level": index + 1,
                    "price": price if price is not None and price > 0 else None,
                    "volume_hands": volume if volume is not None and volume >= 0 else None,
                    "volume_bonds": volume * 10 if volume is not None and volume >= 0 else None,
                }
            )
        return output

    asks = levels("askPrice", "askVol")
    bids = levels("bidPrice", "bidVol")
    last_price = finite_or_none(tick.get("lastPrice"))
    previous_close = finite_or_none(tick.get("lastClose"))
    timetag = str(tick.get("timetag") or "")
    tag_row = bond_tag_row(stored_code)
    ask_one = asks[0]["price"] if asks else None
    bid_one = bids[0]["price"] if bids else None
    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": "MiniQMT full_tick",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "code": stored_code,
            "name": tag_row.get("name") or stored_code,
            "date": timetag[:8],
            "time": timetag[9:17],
            "timestamp": int(tick.get("time") or 0),
            "last_price": last_price,
            "previous_close": previous_close,
            "change": (
                (last_price / previous_close - 1) * 100
                if last_price is not None
                and last_price > 0
                and previous_close is not None
                and previous_close > 0
                else None
            ),
            "open": finite_or_none(tick.get("open")),
            "high": finite_or_none(tick.get("high")),
            "low": finite_or_none(tick.get("low")),
            "amount": finite_or_none(tick.get("amount")) or 0,
            "volume": finite_or_none(tick.get("volume")) or 0,
            "up_limit": finite_or_none(tick.get("upStopPrice")),
            "down_limit": finite_or_none(tick.get("downStopPrice")),
            "spread": (
                ask_one - bid_one
                if ask_one is not None and bid_one is not None
                else None
            ),
            "asks": asks,
            "bids": bids,
            "volume_unit": "手（1手=10张）",
        }
    )


def unwrap_bridge_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def bridge_trading_get(path: str, params: dict[str, Any]) -> Any:
    query = urllib.parse.urlencode(
        {key: value for key, value in params.items() if value not in (None, "")}
    )
    url = f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}{path}"
    if query:
        url += "?" + query
    headers = {"Accept": "application/json"}
    api_key = bridge_config_value("QMT_BRIDGE_API_KEY")
    if api_key:
        headers["X-API-Key"] = api_key
    request = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=12.0) as response:
        return unwrap_bridge_data(json.load(response))


def bridge_trading_post(path: str, payload: dict[str, Any]) -> Any:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    api_key = bridge_config_value("QMT_BRIDGE_API_KEY")
    if api_key:
        headers["X-API-Key"] = api_key
    request = urllib.request.Request(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=12.0) as response:
        return unwrap_bridge_data(json.load(response))


def configured_trading_accounts() -> list[dict[str, str]]:
    accounts: list[dict[str, str]] = []
    stock_account = bridge_config_value("QMT_BRIDGE_STOCK_ACCOUNT_ID")
    credit_account = bridge_config_value("QMT_BRIDGE_CREDIT_ACCOUNT_ID")
    if stock_account:
        accounts.append({"label": "普通户", "id": stock_account, "type": ""})
    if credit_account:
        accounts.append({"label": "信用户", "id": credit_account, "type": "CREDIT"})
    return accounts


def row_value(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in row and row.get(key) is not None:
            return row.get(key)
    return default


def number_value(value: Any) -> float:
    try:
        number = float(value or 0)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def integer_value(value: Any) -> int:
    return int(number_value(value))


def trading_side(row: dict[str, Any]) -> str:
    offset = integer_value(row_value(row, "offset_flag", "m_nOffsetFlag"))
    order_type = integer_value(row_value(row, "order_type", "m_nOrderType"))
    if offset == 48 or order_type == 23:
        return "买入"
    if offset == 49 or order_type == 24:
        return "卖出"
    return "其他"


def trading_clock(value: Any) -> str:
    timestamp = number_value(value)
    if timestamp <= 0:
        return ""
    if timestamp > 10_000_000_000:
        timestamp /= 1000
    try:
        return datetime.fromtimestamp(timestamp).strftime("%H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return ""


def order_status_text(row: dict[str, Any]) -> str:
    message = str(row_value(row, "status_msg", "m_strStatusMsg", default="") or "").strip()
    if message:
        return message
    status = integer_value(row_value(row, "order_status", "m_nOrderStatus"))
    return {
        48: "未报",
        49: "待报",
        50: "已报",
        51: "待撤",
        52: "部成待撤",
        53: "部成",
        54: "已撤",
        55: "部撤",
        56: "已成",
        57: "废单",
    }.get(status, f"状态{status}" if status else "未知")


def sanitize_position(row: dict[str, Any], account_label: str) -> dict[str, Any]:
    profit_rate = number_value(row_value(row, "profit_rate", "m_dProfitRate"))
    return {
        "account": account_label,
        "code": str(row_value(row, "stock_code", "m_strStockCode", default="") or ""),
        "name": str(row_value(row, "instrument_name", "m_strInstrumentName", default="") or ""),
        "volume": integer_value(row_value(row, "volume", "m_nVolume")),
        "available": integer_value(row_value(row, "can_use_volume", "m_nCanUseVolume")),
        "frozen": integer_value(row_value(row, "frozen_volume", "m_nFrozenVolume")),
        "average_price": number_value(row_value(row, "avg_price", "m_dAvgPrice")),
        "last_price": number_value(row_value(row, "last_price", "m_dLastPrice")),
        "market_value": number_value(row_value(row, "market_value", "m_dMarketValue")),
        "floating_profit": number_value(row_value(row, "float_profit", "m_dFloatProfit")),
        "position_profit": number_value(row_value(row, "position_profit", "m_dPositionProfit")),
        "profit_rate": profit_rate * 100,
    }


def sanitize_order(row: dict[str, Any], account_label: str) -> dict[str, Any]:
    status_code = integer_value(row_value(row, "order_status", "m_nOrderStatus"))
    return {
        "account": account_label,
        "time": trading_clock(row_value(row, "order_time", "m_nOrderTime")),
        "code": str(row_value(row, "stock_code", "m_strStockCode", default="") or ""),
        "name": str(row_value(row, "instrument_name", "m_strInstrumentName", default="") or ""),
        "side": trading_side(row),
        "price": number_value(row_value(row, "price", "m_dPrice")),
        "volume": integer_value(row_value(row, "order_volume", "m_nOrderVolume")),
        "traded_price": number_value(row_value(row, "traded_price", "m_dTradedPrice")),
        "traded_volume": integer_value(row_value(row, "traded_volume", "m_nTradedVolume")),
        "status": order_status_text(row),
        "status_code": status_code,
        "order_id": integer_value(row_value(row, "order_id", "m_nOrderID")),
        "cancelable": status_code in {48, 49, 50, 51, 52, 53, 55},
        "strategy": str(row_value(row, "strategy_name", "m_strStrategyName", default="") or ""),
        "remark": str(row_value(row, "order_remark", "m_strOrderRemark", default="") or ""),
    }


def sanitize_trade(row: dict[str, Any], account_label: str) -> dict[str, Any]:
    price = number_value(row_value(row, "traded_price", "m_dTradedPrice"))
    volume = integer_value(row_value(row, "traded_volume", "m_nTradedVolume"))
    amount = number_value(row_value(row, "traded_amount", "m_dTradedAmount"))
    return {
        "account": account_label,
        "time": trading_clock(row_value(row, "traded_time", "m_nTradedTime")),
        "code": str(row_value(row, "stock_code", "m_strStockCode", default="") or ""),
        "name": str(row_value(row, "instrument_name", "m_strInstrumentName", default="") or ""),
        "side": trading_side(row),
        "price": price,
        "volume": volume,
        "amount": amount if amount else price * volume,
        "commission": number_value(row_value(row, "commission", "m_dCommission")),
        "strategy": str(row_value(row, "strategy_name", "m_strStrategyName", default="") or ""),
        "remark": str(row_value(row, "order_remark", "m_strOrderRemark", default="") or ""),
    }


def trading_payload() -> dict[str, Any]:
    accounts = configured_trading_accounts()
    if not accounts:
        raise ValueError("尚未配置 QMT 实盘账户")

    assets: list[dict[str, Any]] = []
    positions: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    account_states: list[dict[str, Any]] = []

    for account in accounts:
        common_params = {"account_id": account["id"]}
        typed_params = dict(common_params)
        if account["type"]:
            typed_params["account_type"] = account["type"]
        status = bridge_trading_get("/api/trading/account_status", common_params)
        asset = bridge_trading_get("/api/trading/asset", typed_params)
        raw_positions = bridge_trading_get("/api/trading/positions", typed_params)
        raw_orders = bridge_trading_get("/api/trading/orders", typed_params)
        raw_trades = bridge_trading_get("/api/trading/trades", typed_params)

        asset = asset if isinstance(asset, dict) else {}
        assets.append(
            {
                "account": account["label"],
                "cash": number_value(row_value(asset, "cash", "m_dCash")),
                "frozen_cash": number_value(row_value(asset, "frozen_cash", "m_dFrozenCash")),
                "market_value": number_value(row_value(asset, "market_value", "m_dMarketValue")),
                "total_asset": number_value(row_value(asset, "total_asset", "m_dTotalAsset")),
            }
        )
        account_states.append(
            {
                "label": account["label"],
                "connected": bool(status.get("connected")) if isinstance(status, dict) else False,
            }
        )
        positions.extend(
            sanitize_position(row, account["label"])
            for row in (raw_positions if isinstance(raw_positions, list) else [])
            if isinstance(row, dict)
        )
        orders.extend(
            sanitize_order(row, account["label"])
            for row in (raw_orders if isinstance(raw_orders, list) else [])
            if isinstance(row, dict)
        )
        trades.extend(
            sanitize_trade(row, account["label"])
            for row in (raw_trades if isinstance(raw_trades, list) else [])
            if isinstance(row, dict)
        )

    grouped: dict[str, dict[str, Any]] = {}
    for trade in trades:
        code = str(trade.get("code") or "")
        item = grouped.setdefault(
            code,
            {
                "code": code,
                "name": trade.get("name") or code,
                "buy_fills": 0,
                "buy_volume": 0,
                "buy_amount": 0.0,
                "buy_price_volume": 0.0,
                "sell_fills": 0,
                "sell_volume": 0,
                "sell_amount": 0.0,
                "sell_price_volume": 0.0,
            },
        )
        prefix = "buy" if trade.get("side") == "买入" else "sell" if trade.get("side") == "卖出" else ""
        if not prefix:
            continue
        item[f"{prefix}_fills"] += 1
        item[f"{prefix}_volume"] += int(trade.get("volume") or 0)
        item[f"{prefix}_amount"] += float(trade.get("amount") or 0)
        item[f"{prefix}_price_volume"] += float(trade.get("price") or 0) * int(trade.get("volume") or 0)

    symbol_summary: list[dict[str, Any]] = []
    for item in grouped.values():
        buy_volume = int(item.pop("buy_volume"))
        sell_volume = int(item.pop("sell_volume"))
        buy_price_volume = float(item.pop("buy_price_volume"))
        sell_price_volume = float(item.pop("sell_price_volume"))
        item["buy_volume"] = buy_volume
        item["sell_volume"] = sell_volume
        item["buy_average"] = buy_price_volume / buy_volume if buy_volume else 0
        item["sell_average"] = sell_price_volume / sell_volume if sell_volume else 0
        item["total_amount"] = float(item["buy_amount"]) + float(item["sell_amount"])
        item["net_volume"] = buy_volume - sell_volume
        symbol_summary.append(item)
    symbol_summary.sort(key=lambda item: float(item.get("total_amount") or 0), reverse=True)

    current_positions = [row for row in positions if int(row.get("volume") or 0) > 0]
    total_buy = sum(float(row.get("amount") or 0) for row in trades if row.get("side") == "买入")
    total_sell = sum(float(row.get("amount") or 0) for row in trades if row.get("side") == "卖出")
    trade_times = sorted(str(row.get("time") or "") for row in trades if row.get("time"))
    summary = {
        "account_count": len(accounts),
        "connected": all(row["connected"] for row in account_states),
        "total_asset": sum(float(row["total_asset"]) for row in assets),
        "cash": sum(float(row["cash"]) for row in assets),
        "market_value": sum(float(row["market_value"]) for row in assets),
        "current_position_count": len(current_positions),
        "order_count": len(orders),
        "filled_order_count": sum(1 for row in orders if int(row.get("traded_volume") or 0) > 0),
        "cancelled_order_count": sum(1 for row in orders if int(row.get("status_code") or 0) == 54),
        "trade_count": len(trades),
        "trade_symbol_count": len(symbol_summary),
        "buy_amount": total_buy,
        "sell_amount": total_sell,
        "net_buy_amount": total_buy - total_sell,
        "first_trade_time": trade_times[0] if trade_times else "",
        "last_trade_time": trade_times[-1] if trade_times else "",
    }
    orders.sort(key=lambda row: str(row.get("time") or ""), reverse=True)
    trades.sort(key=lambda row: str(row.get("time") or ""), reverse=True)
    current_positions.sort(key=lambda row: float(row.get("market_value") or 0), reverse=True)

    return clean_json(
        {
            "ok": True,
            "mode": "guarded_live",
            "source": "QMT Bridge 真实账户",
            "trading_date": datetime.now().strftime("%Y-%m-%d"),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "accounts": account_states,
            "assets": assets,
            "summary": summary,
            "symbol_summary": symbol_summary,
            "trades": trades,
            "orders": orders,
            "positions": current_positions,
        }
    )


def trading_capabilities_payload() -> dict[str, Any]:
    health = bridge_trading_get("/api/meta/health", {})
    trading = health.get("trading") if isinstance(health, dict) else {}
    trading = trading if isinstance(trading, dict) else {}
    accounts = configured_trading_accounts()
    statuses: list[dict[str, Any]] = []
    for account in accounts:
        try:
            status = bridge_trading_get(
                "/api/trading/account_status",
                {"account_id": account["id"]},
            )
            connected = bool(status.get("connected")) if isinstance(status, dict) else False
        except Exception:
            connected = False
        statuses.append({"label": account["label"], "connected": connected})
    return clean_json(
        {
            **TRADING_GUARD.capabilities(),
            "bridge_enabled": bool(trading.get("enabled")),
            "bridge_connected": bool(trading.get("connected")),
            "accounts": statuses,
        }
    )


def trading_unlock_payload(body: dict[str, Any]) -> dict[str, Any]:
    return clean_json(TRADING_GUARD.unlock(body.get("phrase")))


def trading_order_preview_payload(body: dict[str, Any]) -> dict[str, Any]:
    return clean_json(
        TRADING_GUARD.preview_order(body, configured_trading_accounts(), bridge_trading_get)
    )


def trading_order_execute_payload(body: dict[str, Any]) -> dict[str, Any]:
    return clean_json(
        TRADING_GUARD.execute_order(
            body,
            configured_trading_accounts(),
            bridge_trading_get,
            bridge_trading_post,
        )
    )


def trading_cancel_preview_payload(body: dict[str, Any]) -> dict[str, Any]:
    return clean_json(
        TRADING_GUARD.preview_cancel(body, configured_trading_accounts(), bridge_trading_get)
    )


def trading_cancel_execute_payload(body: dict[str, Any]) -> dict[str, Any]:
    return clean_json(
        TRADING_GUARD.execute_cancel(
            body,
            configured_trading_accounts(),
            bridge_trading_get,
            bridge_trading_post,
        )
    )


def compact_date(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))[:8]


def dashed_date(value: str) -> str:
    text = compact_date(value)
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 else ""


def next_weekday(value: str) -> str:
    moment = datetime.strptime(compact_date(value), "%Y%m%d")
    moment += timedelta(days=1)
    while moment.weekday() >= 5:
        moment += timedelta(days=1)
    return moment.strftime("%Y%m%d")


def load_active_index_source() -> dict[str, Any]:
    payload = json.loads(ACTIVE_INDEX_DATA_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise LookupError("活跃转债指数研究快照格式错误")
    return payload


def load_active_index_universes(source: dict[str, Any]) -> dict[str, Any]:
    cache = read_json(ACTIVE_INDEX_UNIVERSE_PATH)
    universes = cache.get("universes")
    if not isinstance(universes, dict):
        universes = {}
    seed = source.get("seedUniverse") or {}
    effective_date = compact_date(seed.get("effectiveDate"))
    if effective_date and effective_date not in universes:
        universes[effective_date] = {
            "effective_date": effective_date,
            "selected_from_date": compact_date(seed.get("selectedFromDate")),
            "threshold": float(seed.get("threshold") or ACTIVE_INDEX_THRESHOLD),
            "constituents": list(seed.get("constituents") or []),
            "source": "通达信本地日线",
        }
    return {"universes": universes}


def persist_active_index_universes(cache: dict[str, Any]) -> None:
    ACTIVE_INDEX_UNIVERSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = ACTIVE_INDEX_UNIVERSE_PATH.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(ACTIVE_INDEX_UNIVERSE_PATH)


def quote_date_from_ticks(ticks: dict[str, dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for tick in ticks.values():
        timetag = compact_date(tick.get("timetag"))
        if len(timetag) == 8:
            counts[timetag] = counts.get(timetag, 0) + 1
    return max(counts, key=lambda value: (counts[value], value)) if counts else ""


def build_universe_from_ticks(
    ticks: dict[str, dict[str, Any]],
    names: dict[str, str],
    selected_from_date: str,
    effective_date: str,
) -> dict[str, Any]:
    constituents: list[dict[str, Any]] = []
    for code, tick in ticks.items():
        if compact_date(tick.get("timetag")) != selected_from_date:
            continue
        amount = finite_or_none(tick.get("amount")) or 0
        price = finite_or_none(tick.get("lastPrice")) or 0
        if amount <= ACTIVE_INDEX_THRESHOLD or price <= 0:
            continue
        constituents.append(
            {
                "code": code,
                "name": names.get(code, code),
                "previousAmount": amount,
                "previousVolume": finite_or_none(tick.get("volume")) or 0,
            }
        )
    constituents.sort(
        key=lambda item: float(item.get("previousAmount") or 0),
        reverse=True,
    )
    return {
        "effective_date": effective_date,
        "selected_from_date": selected_from_date,
        "threshold": ACTIVE_INDEX_THRESHOLD,
        "constituents": constituents,
        "source": "MiniQMT 前一交易日收盘快照",
    }


def resolve_active_index_names(
    bridge: Any,
    codes: list[str],
    source_names: dict[str, str],
) -> dict[str, str]:
    names = dict(source_names)
    unresolved = [
        code
        for code in codes
        if not names.get(code)
        or names[code] == code
        or names[code] == code[:6]
        or MARKET_CODE_PATTERN.fullmatch(names[code])
    ]
    for code in unresolved:
        cached_name = ACTIVE_INDEX_NAME_CACHE.get(code)
        if cached_name:
            names[code] = cached_name
    unresolved = [code for code in unresolved if code not in ACTIVE_INDEX_NAME_CACHE]
    for index in range(0, len(unresolved), 100):
        batch = unresolved[index : index + 100]
        try:
            payload = bridge.get(
                "/api/utility/batch_stock_name",
                {"stocks": ",".join(batch)},
            )
            resolved = payload.get("data") if isinstance(payload, dict) else {}
            if not isinstance(resolved, dict):
                continue
            for code in batch:
                name = str(resolved.get(code) or "").strip()
                if not name or name == code or name == code[:6]:
                    continue
                ACTIVE_INDEX_NAME_CACHE[code] = name
                names[code] = name
        except Exception:
            continue
    return names


def load_local_minute_bars(
    codes: list[str],
    trading_date: str,
) -> dict[str, list[dict[str, Any]]]:
    result = {code: [] for code in codes}
    if not codes:
        return result
    try:
        database = database_for_date(trading_date)
    except FileNotFoundError:
        return result

    try:
        with connect_read_only(database) as connection:
            for index in range(0, len(codes), 500):
                batch = codes[index : index + 500]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT code,minute_ms,open,high,low,close,amount
                    FROM minute_observations
                    WHERE trading_date=? AND code IN ({placeholders})
                    ORDER BY code,minute_ms
                    """,
                    (trading_date, *batch),
                ).fetchall()
                for row in rows:
                    code = str(row["code"])
                    result.setdefault(code, []).append(
                        {
                            "time": int(row["minute_ms"]),
                            "open": finite_or_none(row["open"]),
                            "high": finite_or_none(row["high"]),
                            "low": finite_or_none(row["low"]),
                            "close": finite_or_none(row["close"]),
                            "amount": finite_or_none(row["amount"]) or 0,
                            "volume": 0,
                        }
                    )
    except (OSError, sqlite3.Error):
        return {code: [] for code in codes}
    return result


def downsample_spark_points(
    points: list[dict[str, Any]],
    limit: int = 120,
) -> list[dict[str, Any]]:
    if len(points) <= limit:
        return points
    if limit <= 1:
        return points[-1:]
    indexes = [
        round(index * (len(points) - 1) / (limit - 1))
        for index in range(limit)
    ]
    return [points[index] for index in dict.fromkeys(indexes)]


def available_intraday_cache_dates() -> list[str]:
    if not INTRADAY_BACKFILL_CACHE_ROOT.exists():
        return []
    try:
        return sorted(
            {
                path.name
                for path in INTRADAY_BACKFILL_CACHE_ROOT.iterdir()
                if path.is_dir() and re.fullmatch(r"\d{8}", path.name)
            },
            reverse=True,
        )[:10]
    except OSError:
        return []


def load_backfill_minute_bars(
    codes: list[str],
    trading_date: str,
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {code: [] for code in codes}
    if not (INTRADAY_BACKFILL_CACHE_ROOT / trading_date).is_dir():
        return result
    for code in codes:
        snapshot = intraday_cache_snapshot(code, trading_date)
        points: list[dict[str, Any]] = []
        for row in snapshot.get("rows") or []:
            timestamp = int(row.get("minute_ms") or row.get("time") or 0)
            price = finite_or_none(row.get("close"))
            if timestamp > 0 and price is not None and price > 0:
                points.append({"time": timestamp, "close": price})
        result[code] = points
    return result


def latest_available_spark_points(
    codes: list[str],
    calendar_date: str,
) -> tuple[
    str,
    dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
]:
    """Find the newest local minute snapshot without crossing into the future."""
    database_dates = [database.stem for database in available_databases()[:10]]
    with LIVE_INTRADAY_LOCK:
        memory_dates = {
            str(point.get("date") or "")
            for points in LIVE_INTRADAY_SAMPLES.values()
            for point in points
        }
    candidate_dates = sorted(
        set(database_dates)
        | set(available_intraday_cache_dates())
        | set(available_live_intraday_dates())
        | memory_dates,
        reverse=True,
    )
    for trading_date in candidate_dates:
        if len(trading_date) != 8:
            continue
        if trading_date > calendar_date:
            continue
        local_points = load_local_minute_bars(codes, trading_date)
        backfill_points = load_backfill_minute_bars(codes, trading_date)
        live_points = load_live_intraday_samples(codes, trading_date)
        if any(
            local_points.get(code)
            or backfill_points.get(code)
            or live_points.get(code)
            for code in codes
        ):
            return trading_date, local_points, backfill_points, live_points
    empty = {code: [] for code in codes}
    return (
        calendar_date,
        empty,
        {code: [] for code in codes},
        {code: [] for code in codes},
    )


def sparks_payload(codes_input: str) -> dict[str, Any]:
    codes: list[str] = []
    for value in str(codes_input or "").split(","):
        if not value.strip():
            continue
        try:
            code = normalize_market_code(value)
        except ValueError:
            continue
        if code not in codes:
            codes.append(code)
    if not codes:
        raise ValueError("缺少有效的MiniQMT分时代码")
    if len(codes) > 500:
        raise ValueError("单次最多查询500个分时代码")

    current = china_now()
    calendar_date = current.strftime("%Y%m%d")
    trading_date = calendar_date
    local_points = load_local_minute_bars(codes, trading_date)
    backfill_points = load_backfill_minute_bars(codes, trading_date)
    live_points = load_live_intraday_samples(codes, trading_date)
    phase, _market_data_expected = market_phase(current)
    if (
        phase == "closed"
        and not any(
            local_points.get(code)
            or backfill_points.get(code)
            or live_points.get(code)
            for code in codes
        )
    ):
        (
            trading_date,
            local_points,
            backfill_points,
            live_points,
        ) = latest_available_spark_points(
            codes,
            calendar_date,
        )
    data_is_stale = trading_date != calendar_date
    sparks: list[dict[str, Any]] = []

    for code in codes:
        by_time: dict[int, dict[str, Any]] = {}
        for row in backfill_points.get(code, []):
            timestamp = int(row.get("time") or 0)
            price = finite_or_none(row.get("close"))
            if timestamp > 0 and price is not None and price > 0:
                by_time[timestamp] = {"time": timestamp, "price": price}
        # The monitor SQLite remains authoritative for convertible bonds and
        # therefore wins over the downloaded maintenance cache.
        for row in local_points.get(code, []):
            timestamp = int(row.get("time") or 0)
            price = finite_or_none(row.get("close"))
            if timestamp > 0 and price is not None and price > 0:
                by_time[timestamp] = {"time": timestamp, "price": price}
        # The live full_tick sample is newer than the monitor's persisted
        # minute row and therefore wins when both represent the same instant.
        for row in live_points.get(code, []):
            timestamp = int(row.get("time") or 0)
            price = finite_or_none(row.get("price"))
            if timestamp > 0 and price is not None and price > 0:
                by_time[timestamp] = {"time": timestamp, "price": price}

        ordered = [
            by_time[timestamp]
            for timestamp in sorted(by_time)
        ]
        if not ordered:
            continue
        sampled = downsample_spark_points(ordered)
        last_timestamp = int(sampled[-1]["time"])
        last_moment = datetime.fromtimestamp(last_timestamp / 1000, CHINA_TIME_ZONE)
        has_local = bool(local_points.get(code))
        has_backfill = bool(backfill_points.get(code))
        has_live = bool(live_points.get(code))
        if data_is_stale and (has_local or has_backfill) and has_live:
            source = "MiniQMT最近交易日1m缓存 + full_tick采样"
        elif data_is_stale and (has_local or has_backfill):
            source = "MiniQMT最近交易日1m缓存"
        elif data_is_stale and has_live:
            source = "MiniQMT最近交易日full_tick采样"
        elif (has_local or has_backfill) and has_live:
            source = "MiniQMT 1m缓存 + full_tick实时"
        elif has_local or has_backfill:
            source = "MiniQMT 1m缓存"
        else:
            source = "MiniQMT full_tick实时采样"
        sparks.append(
            {
                "secid": market_code_to_secid(code),
                "points": [float(row["price"]) for row in sampled],
                "times": [
                    datetime.fromtimestamp(
                        int(row["time"]) / 1000,
                        CHINA_TIME_ZONE,
                    ).strftime("%H%M")
                    for row in sampled
                ],
                "date": trading_date,
                "time": last_moment.strftime("%H%M"),
                "source": source,
                "data_is_stale": data_is_stale,
            }
        )

    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": (
                "MiniQMT最近交易日分时缓存"
                if data_is_stale
                else "MiniQMT 1m缓存 + full_tick实时采样"
            ),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "calendar_date": calendar_date,
            "trading_date": trading_date,
            "data_is_stale": data_is_stale,
            "market_phase": phase,
            "requested": len(codes),
            "returned": len(sparks),
            "sparks": sparks,
        }
    )


def tick_minute_timestamp(tick: dict[str, Any]) -> int:
    digits = re.sub(r"\D", "", str(tick.get("timetag") or ""))
    if len(digits) < 12:
        return 0
    clock = digits[:14] if len(digits) >= 14 else digits[:12] + "00"
    try:
        moment = datetime.strptime(clock, "%Y%m%d%H%M%S").replace(second=0)
    except ValueError:
        return 0
    in_session = (
        datetime.strptime("09:30", "%H:%M").time()
        <= moment.time()
        <= datetime.strptime("11:30", "%H:%M").time()
        or datetime.strptime("13:00", "%H:%M").time()
        <= moment.time()
        <= datetime.strptime("15:00", "%H:%M").time()
    )
    return int(moment.timestamp() * 1000) if in_session else 0


def elapsed_market_minutes(tick: dict[str, Any]) -> int:
    digits = re.sub(r"\D", "", str(tick.get("timetag") or ""))
    if len(digits) < 12:
        return 0
    clock = digits[:14] if len(digits) >= 14 else digits[:12] + "00"
    try:
        moment = datetime.strptime(clock, "%Y%m%d%H%M%S").replace(second=0)
    except ValueError:
        return 0
    morning_start = datetime.strptime("09:30", "%H:%M").time()
    morning_end = datetime.strptime("11:30", "%H:%M").time()
    afternoon_start = datetime.strptime("13:00", "%H:%M").time()
    if morning_start <= moment.time() <= morning_end:
        start = moment.replace(hour=9, minute=30, second=0, microsecond=0)
        return int((moment - start).total_seconds() // 60) + 1
    if moment.time() >= afternoon_start:
        start = moment.replace(hour=13, minute=0, second=0, microsecond=0)
        return min(240, 121 + int((moment - start).total_seconds() // 60))
    if moment.time() > morning_end:
        return 121
    return 0


def active_index_average_volume(
    candidate: dict[str, Any],
    constituent: dict[str, Any],
    selected_from_date: str,
) -> float:
    average5 = finite_or_none(candidate.get("average5Volume")) or 0
    latest_volume = finite_or_none(candidate.get("latestVolume")) or 0
    previous_volume = finite_or_none(constituent.get("previousVolume")) or 0
    latest_date = compact_date(candidate.get("latestDate"))
    selected_date = compact_date(selected_from_date)

    if previous_volume > 0 and latest_volume > 0:
        if latest_date and selected_date and latest_date < selected_date:
            return (average5 * 3 + latest_volume + previous_volume) / 5
        return (average5 * 4 + previous_volume) / 5
    if previous_volume > 0:
        return (average5 * 4 + previous_volume) / 5
    if latest_volume > 0:
        return (average5 * 4 + latest_volume) / 5
    return average5


def active_index_volume_ratio(
    tick: dict[str, Any],
    candidate: dict[str, Any],
    constituent: dict[str, Any],
    selected_from_date: str,
) -> float | None:
    average5_volume = active_index_average_volume(
        candidate,
        constituent,
        selected_from_date,
    )
    elapsed_minutes = elapsed_market_minutes(tick)
    current_volume = finite_or_none(tick.get("volume")) or 0
    if average5_volume <= 0 or elapsed_minutes <= 0:
        return None
    return current_volume / elapsed_minutes / (average5_volume / 240)


def bond_volume_ratio(
    stored_code: str,
    trading_date: str,
) -> tuple[float | None, float | None]:
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=15.0,
    )
    tick = bridge.full_tick([stored_code]).get(stored_code)
    return bond_volume_ratio_from_tick(stored_code, trading_date, tick)


def bond_volume_ratio_from_tick(
    stored_code: str,
    trading_date: str,
    tick: dict[str, Any] | None,
) -> tuple[float | None, float | None]:
    if not isinstance(tick, dict):
        return None, None
    if compact_date(tick.get("timetag")) != trading_date:
        return None, None
    source = load_active_index_source()
    candidate = next(
        (
            item
            for item in source.get("bondCandidates") or []
            if str(item.get("code") or "") == stored_code
        ),
        {},
    )
    universe_cache = load_active_index_universes(source)
    universes = universe_cache.get("universes") or {}
    universe = universes.get(trading_date)
    if not isinstance(universe, dict):
        available = [
            value
            for key, value in universes.items()
            if key <= trading_date and isinstance(value, dict)
        ]
        universe = available[-1] if available else {}
    constituent = next(
        (
            item
            for item in universe.get("constituents") or []
            if str(item.get("code") or "") == stored_code
        ),
        {},
    )
    selected_from_date = universe.get("selected_from_date") or ""
    average5_volume = active_index_average_volume(
        candidate,
        constituent,
        selected_from_date,
    )
    return (
        active_index_volume_ratio(
            tick,
            candidate,
            constituent,
            selected_from_date,
        ),
        average5_volume if average5_volume > 0 else None,
    )


def historical_bond_volume_ratio(
    stored_code: str,
    trading_date: str,
) -> tuple[float | None, float | None]:
    cache_key = f"{stored_code}:{trading_date}"
    cached = HISTORICAL_VOLUME_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < INTRADAY_CACHE_TTL_SECONDS:
        return cached[1]

    end_moment = datetime.strptime(trading_date, "%Y%m%d")
    start_time = (end_moment - timedelta(days=45)).strftime("%Y%m%d")
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=30.0,
    )
    payload = bridge.get(
        "/api/market/market_data_ex",
        {
            "stocks": stored_code,
            "period": "1d",
            "start_time": start_time,
            "end_time": trading_date,
            "count": "-1",
            "dividend_type": "none",
            "fill_data": "false",
        },
        timeout=30.0,
    )
    daily_rows = []
    for raw in (payload.get("data") or {}).get(stored_code) or []:
        row_date = compact_date(raw.get("index") or raw.get("time"))
        volume = finite_or_none(raw.get("volume"))
        if len(row_date) == 8 and volume is not None and volume > 0:
            daily_rows.append((row_date, volume))
    daily_rows.sort(key=lambda item: item[0])
    target_index = next(
        (
            index
            for index, (row_date, _) in enumerate(daily_rows)
            if row_date == trading_date
        ),
        -1,
    )
    result: tuple[float | None, float | None] = (None, None)
    if target_index >= 0:
        previous_volumes = [
            volume
            for _, volume in daily_rows[max(0, target_index - 5) : target_index]
        ]
        if previous_volumes:
            average_volume = sum(previous_volumes) / len(previous_volumes)
            target_volume = daily_rows[target_index][1]
            result = (target_volume / average_volume, average_volume)
    HISTORICAL_VOLUME_CACHE[cache_key] = (time.monotonic(), result)
    return result


def stock_daily_closes(
    bridge: Any,
    stock_code: str,
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    def fetch_rows() -> list[dict[str, Any]]:
        payload = bridge.get(
            "/api/market/market_data_ex",
            {
                "stocks": stock_code,
                "period": "1d",
                "start_time": start_date,
                "end_time": end_date,
                "count": "-1",
                "dividend_type": "none",
                "fill_data": "false",
            },
            timeout=30.0,
        )
        return list((payload.get("data") or {}).get(stock_code) or [])

    rows = fetch_rows()
    result: list[dict[str, Any]] = []
    for row in rows:
        trading_date = compact_date(row.get("index") or row.get("time"))
        close = finite_or_none(row.get("close"))
        if len(trading_date) == 8 and close is not None and close > 0:
            result.append({"date": trading_date, "close": close})
    result.sort(key=lambda item: item["date"])
    return result


def fetch_external_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://data.eastmoney.com/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        payload = json.load(response)
    return payload if isinstance(payload, dict) else {}


def latest_bond_reference(code: str) -> dict[str, Any]:
    """Fetch a current bond-to-stock mapping when the local snapshot predates listing."""
    bare_code = str(code or "").split(".")[0]
    cached = BOND_REFERENCE_CACHE.get(bare_code)
    if cached and time.monotonic() - cached[0] < BOND_REFERENCE_CACHE_TTL_SECONDS:
        return cached[1]
    result: dict[str, Any] = {}
    try:
        url = "https://datacenter-web.eastmoney.com/api/data/v1/get?" + urllib.parse.urlencode(
            {
                "reportName": "RPT_BOND_CB_LIST",
                "columns": "ALL",
                "filter": f'(SECURITY_CODE="{bare_code}")',
            }
        )
        rows = list((fetch_external_json(url).get("result") or {}).get("data") or [])
        if rows:
            row = rows[0]
            conversion_price = (
                finite_or_none(row.get("TRANSFER_PRICE"))
                or finite_or_none(row.get("INITIAL_TRANSFER_PRICE"))
                or finite_or_none(row.get("TRANSFER_VALUE"))
            )
            redeem_trigger_price = finite_or_none(row.get("REDEEM_TRIG_PRICE"))
            if redeem_trigger_price is None and conversion_price is not None:
                redeem_trigger_price = conversion_price * 1.3
            maturity_redemption_price = None
            redeem_clause = str(row.get("REDEEM_CLAUSE") or "")
            maturity_match = re.search(r"票面面值的(\d+(?:\.\d+)?)%", redeem_clause)
            if maturity_match:
                maturity_redemption_price = float(maturity_match.group(1))
            result = {
                "转债代码": row.get("SECUCODE") or code,
                "转债简称": row.get("SECURITY_NAME_ABBR"),
                "正股代码": row.get("CONVERT_STOCK_CODE"),
                "正股简称": row.get("SECURITY_SHORT_NAME"),
                "转股价": conversion_price,
                "强赎触发价": redeem_trigger_price,
                "到期赎回价": maturity_redemption_price,
                "开始转股日": row.get("TRANSFER_START_DATE"),
                "上市日期": row.get("LISTING_DATE"),
                "到期日期": row.get("EXPIRE_DATE"),
                "发行规模_亿元": finite_or_none(row.get("ACTUAL_ISSUE_SCALE")),
                "信用评级": row.get("RATING"),
                "_source": "东方财富可转债资料动态回退",
            }
    except Exception:
        result = {}
    BOND_REFERENCE_CACHE[bare_code] = (time.monotonic(), result)
    return result


def latest_bond_reference_list() -> list[dict[str, Any]]:
    """Read the current convertible-bond reference table.

    MiniQMT's convertible-bond universe can lag the first trading session of
    a new Shanghai bond.  The reference table is therefore used only for
    discovery and listing dates; realtime prices still come from MiniQMT.
    """
    global NEW_BOND_REFERENCE_LIST_CACHE
    if (
        NEW_BOND_REFERENCE_LIST_CACHE
        and time.monotonic() - NEW_BOND_REFERENCE_LIST_CACHE[0]
        < NEW_BOND_REFERENCE_CACHE_TTL_SECONDS
    ):
        return NEW_BOND_REFERENCE_LIST_CACHE[1]

    url = "https://datacenter-web.eastmoney.com/api/data/v1/get?" + urllib.parse.urlencode(
        {
            "reportName": "RPT_BOND_CB_LIST",
            "columns": (
                "SECURITY_CODE,SECURITY_NAME_ABBR,CONVERT_STOCK_CODE,"
                "SECURITY_SHORT_NAME,LISTING_DATE,ACTUAL_ISSUE_SCALE,RATING"
            ),
            "pageNumber": "1",
            "pageSize": "500",
            "sortColumns": "LISTING_DATE",
            "sortTypes": "-1",
        }
    )
    rows = list((fetch_external_json(url, timeout=15).get("result") or {}).get("data") or [])
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        code = re.sub(r"\D", "", str(row.get("SECURITY_CODE") or ""))[:6]
        listed_date = compact_date(row.get("LISTING_DATE"))
        if not CODE_PATTERN.fullmatch(code) or len(listed_date) != 8 or code in seen:
            continue
        seen.add(code)
        market_code = monitor_code(code)
        normalized.append(
            {
                "code": code,
                "market_code": market_code,
                "secid": market_code_to_secid(market_code),
                "name": str(row.get("SECURITY_NAME_ABBR") or "").strip(),
                "stock_code": stock_market_code(row.get("CONVERT_STOCK_CODE")),
                "stock_name": str(row.get("SECURITY_SHORT_NAME") or "").strip(),
                "listing_date": listed_date,
                "issue_scale_billion": finite_or_none(row.get("ACTUAL_ISSUE_SCALE")),
                "rating": str(row.get("RATING") or "").strip(),
                "source": "东方财富可转债资料动态列表",
            }
        )
    NEW_BOND_REFERENCE_LIST_CACHE = (time.monotonic(), normalized)
    return normalized


def bridge_calendar_date(
    bridge: Any,
    endpoint: str,
    date_value: str,
    market: str = "SH",
) -> str:
    payload = bridge.get(
        endpoint,
        {"date": date_value, "market": market},
        timeout=10.0,
    )
    key = endpoint.rsplit("/", 1)[-1]
    raw = payload.get(key)
    if raw is None:
        return ""
    if isinstance(raw, (int, float)):
        return china_now(datetime.fromtimestamp(float(raw) / 1000, CHINA_TIME_ZONE)).strftime(
            "%Y%m%d"
        )
    return compact_date(raw)


def latest_exchange_trade_dates() -> list[str]:
    """Load an exchange calendar that includes announced future sessions."""
    global EXCHANGE_TRADE_DATE_CACHE
    if (
        EXCHANGE_TRADE_DATE_CACHE
        and time.monotonic() - EXCHANGE_TRADE_DATE_CACHE[0]
        < EXCHANGE_TRADE_DATE_CACHE_TTL_SECONDS
    ):
        return EXCHANGE_TRADE_DATE_CACHE[1]

    try:
        import akshare as ak  # Lazy: only needed when QMT has not rolled forward.

        frame = ak.tool_trade_date_hist_sina()
        raw_dates = frame["trade_date"].tolist()
    except Exception as error:
        raise LookupError(f"备用交易日历不可用：{error}") from error

    dates = sorted(
        {
            normalized
            for value in raw_dates
            if len(normalized := compact_date(value)) == 8
        }
    )
    if not dates:
        raise LookupError("备用交易日历为空")
    EXCHANGE_TRADE_DATE_CACHE = (time.monotonic(), dates)
    return dates


def resolve_target_trading_session(
    target_date: str,
    bridge_is_trading: bool,
    bridge_previous_date: str,
    fallback_dates: list[str] | None = None,
) -> tuple[bool, str, str, str]:
    """Resolve target/previous sessions without trusting a stale QMT false."""
    if (
        bridge_is_trading
        and len(bridge_previous_date) == 8
        and bridge_previous_date < target_date
    ):
        return True, bridge_previous_date, "QMT Bridge交易日历", ""

    dates = sorted(
        {
            normalized
            for value in (fallback_dates or [])
            if len(normalized := compact_date(value)) == 8
        }
    )
    if not dates or target_date > dates[-1]:
        raise LookupError(f"交易日历尚未覆盖目标日期 {target_date}")
    try:
        target_index = dates.index(target_date)
    except ValueError:
        return False, "", "新浪交易日历（校正QMT未覆盖日期）", dates[-1]
    if target_index == 0:
        raise LookupError(f"交易日历缺少 {target_date} 的上一交易日")
    return (
        True,
        dates[target_index - 1],
        "新浪交易日历（校正QMT未覆盖日期）",
        dates[-1],
    )


def new_bond_candidates_payload(date_input: str = "") -> dict[str, Any]:
    """Return bonds whose next exchange session is their second trading day."""
    target_date = compact_date(date_input) or china_now().strftime("%Y%m%d")
    if not re.fullmatch(r"\d{8}", target_date):
        raise ValueError("交易日必须为YYYYMMDD")

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=15.0,
    )
    bridge_is_trading = False
    bridge_previous_date = ""
    bridge_calendar_error = ""
    try:
        trading_payload = bridge.get(
            "/api/calendar/is_trading_date",
            {"date": target_date, "market": "SH"},
            timeout=10.0,
        )
        bridge_is_trading = bool(trading_payload.get("is_trading"))
        bridge_previous_date = (
            bridge_calendar_date(
                bridge,
                "/api/calendar/prev_trading_date",
                target_date,
            )
            if bridge_is_trading
            else ""
        )
    except Exception as error:
        bridge_calendar_error = str(error)

    fallback_dates: list[str] | None = None
    if not bridge_is_trading or not bridge_previous_date:
        fallback_dates = latest_exchange_trade_dates()
    is_trading, previous_date, calendar_source, calendar_latest_date = (
        resolve_target_trading_session(
            target_date,
            bridge_is_trading,
            bridge_previous_date,
            fallback_dates,
        )
    )

    try:
        qmt_codes = {
            str(code)
            for code in bridge.convertible_bonds()
            if MARKET_CODE_PATTERN.fullmatch(str(code))
        }
    except Exception:
        qmt_codes = set()
    rows = latest_bond_reference_list()
    candidates: list[dict[str, Any]] = []
    if is_trading and previous_date:
        for row in rows:
            if row["listing_date"] != previous_date:
                continue
            candidates.append(
                {
                    **row,
                    "in_miniqmt_list": row["market_code"] in qmt_codes,
                    "discovery": (
                        "动态上市资料 + MiniQMT列表"
                        if row["market_code"] in qmt_codes
                        else "动态上市资料（MiniQMT列表尚未更新）"
                    ),
                }
            )

    missing_from_qmt = [
        row["code"] for row in candidates if not row["in_miniqmt_list"]
    ]
    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "target_date": target_date,
            "is_trading_date": is_trading,
            "previous_trading_date": previous_date,
            "calendar_source": calendar_source,
            "calendar_latest_date": calendar_latest_date,
            "qmt_calendar_is_trading": bridge_is_trading,
            "qmt_calendar_previous_date": bridge_previous_date,
            "qmt_calendar_error": bridge_calendar_error,
            "reference_source": "东方财富可转债资料动态列表",
            "miniqmt_list_count": len(qmt_codes),
            "miniqmt_missing_candidate_codes": missing_from_qmt,
            "returned": len(candidates),
            "candidates": candidates,
            "generated_at": china_now().isoformat(timespec="seconds"),
        }
    )


def chinese_date_to_compact(value: str) -> str:
    match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", str(value or ""))
    if not match:
        return ""
    return f"{int(match.group(1)):04d}{int(match.group(2)):02d}{int(match.group(3)):02d}"


def latest_redeem_announcement(stock_code: str) -> dict[str, Any]:
    bare_stock_code = stock_code.split(".")[0]
    cached = REDEEM_NOTICE_CACHE.get(bare_stock_code)
    if cached and time.monotonic() - cached[0] < REDEEM_NOTICE_CACHE_TTL_SECONDS:
        return cached[1]
    result: dict[str, Any] = {}
    try:
        list_url = "https://np-anotice-stock.eastmoney.com/api/security/ann?" + urllib.parse.urlencode(
            {
                "sr": "-1",
                "page_size": "100",
                "page_index": "1",
                "ann_type": "A",
                "client_source": "web",
                "stock_list": bare_stock_code,
            }
        )
        notices = list((fetch_external_json(list_url).get("data") or {}).get("list") or [])
        notice = next(
            (
                item
                for item in notices
                if "赎回" in str(item.get("title") or "")
                and any(
                    term in str(item.get("title") or "")
                    for term in ("不提前赎回", "不赎回", "提前赎回", "预计触发赎回", "赎回实施", "赎回结果", "赎回暨")
                )
            ),
            None,
        )
        if not notice:
            REDEEM_NOTICE_CACHE[bare_stock_code] = (time.monotonic(), result)
            return result
        article_code = str(notice.get("art_code") or "")
        content_url = "https://np-cnotice-stock.eastmoney.com/api/content/ann?" + urllib.parse.urlencode(
            {"art_code": article_code, "client_source": "web", "page_index": "1"}
        )
        content_payload = fetch_external_json(content_url)
        content_data = content_payload.get("data") or {}
        content = re.sub(r"\s+", "", str(content_data.get("notice_content") or ""))
        title = str(notice.get("title") or content_data.get("notice_title") or "")
        if "不提前赎回" in title or "不赎回" in title:
            notice_type = "no_redeem"
            status = "已公告暂不强赎"
        elif "赎回结果" in title:
            notice_type = "redeem_finished"
            status = "强赎已完成"
        elif "赎回实施" in title or "赎回暨" in title:
            notice_type = "redeeming"
            status = "强赎实施中"
        elif "提前赎回" in title:
            notice_type = "redeem"
            status = "已决定强赎"
        elif "预计触发赎回" in title:
            notice_type = "trigger_warning"
            status = "预计触发强赎"
        else:
            notice_type = "notice"
            status = "强赎相关公告"

        commitment_match = re.search(
            r"未来[^，。；]{0,18}?内[（(]?(?:即)?"
            r"(20\d{2}年\d{1,2}月\d{1,2}日)至"
            r"(20\d{2}年\d{1,2}月\d{1,2}日)",
            content,
        )
        commitment_start = chinese_date_to_compact(commitment_match.group(1)) if commitment_match else ""
        commitment_end = chinese_date_to_compact(commitment_match.group(2)) if commitment_match else ""
        reset_match = re.search(
            r"以(20\d{2}年\d{1,2}月\d{1,2}日)后的首个交易日重新计算",
            content,
        )
        reset_after = chinese_date_to_compact(reset_match.group(1)) if reset_match else commitment_end
        calendar_date = datetime.now().strftime("%Y%m%d")
        commitment_active = bool(
            notice_type == "no_redeem"
            and commitment_end
            and calendar_date <= commitment_end
        )
        attachments = list(content_data.get("attach_list") or [])
        attachment_url = str((attachments[0] if attachments else {}).get("attach_url") or "")
        result = {
            "type": notice_type,
            "status": "承诺期内不强赎" if commitment_active else status,
            "notice_date": compact_date(notice.get("notice_date")),
            "title": title,
            "article_code": article_code,
            "url": attachment_url or f"https://data.eastmoney.com/notices/detail/{bare_stock_code}/{article_code}.html",
            "commitment_start": commitment_start,
            "commitment_end": commitment_end,
            "commitment_active": commitment_active,
            "reset_after": reset_after,
            "source": "上市公司公告（东方财富公告镜像）",
        }
    except Exception as error:
        result = {"error": f"{type(error).__name__}: {error}"}
    REDEEM_NOTICE_CACHE[bare_stock_code] = (time.monotonic(), result)
    return result


def stock_intraday_prices(
    bridge: Any,
    stock_code: str,
    trading_date: str,
) -> list[dict[str, Any]]:
    if not stock_code or len(trading_date) != 8:
        return []

    def fetch_rows() -> list[dict[str, Any]]:
        payload = bridge.get(
            "/api/market/market_data_ex",
            {
                "stocks": stock_code,
                "period": "1m",
                "start_time": f"{trading_date}093000",
                "end_time": f"{trading_date}150000",
                "count": "-1",
                "dividend_type": "none",
                "fill_data": "false",
            },
            timeout=30.0,
        )
        return list((payload.get("data") or {}).get(stock_code) or [])

    rows = fetch_rows()
    result: list[dict[str, Any]] = []
    for row in rows:
        compact_time = re.sub(r"\D", "", str(row.get("index") or ""))
        close = finite_or_none(row.get("close"))
        if len(compact_time) >= 12 and close is not None and close > 0:
            result.append(
                {
                    "time": f"{compact_time[8:10]}:{compact_time[10:12]}",
                    "price": close,
                }
            )
    return result


def bond_metadata_payload(code_input: str) -> dict[str, Any]:
    code = normalize_code(code_input)
    stored_code = monitor_code(code)
    cached = BOND_METADATA_CACHE.get(stored_code)
    if cached and time.monotonic() - cached[0] < BOND_METADATA_CACHE_TTL_SECONDS:
        return {**cached[1], "cached": True}

    source_row = load_bond_fundamentals().get(stored_code) or {}
    reference_source = "本地条款快照"
    if not source_row.get("正股代码"):
        fallback_row = latest_bond_reference(stored_code)
        if fallback_row:
            source_row = {
                **fallback_row,
                **{
                    key: value
                    for key, value in source_row.items()
                    if value not in (None, "")
                },
            }
            reference_source = str(fallback_row.get("_source") or reference_source)
    tag_row = bond_tag_row(stored_code)
    stock_code = stock_market_code(
        source_row.get("正股代码") or tag_row.get("stockCode")
    )
    conversion_price = finite_or_none(source_row.get("转股价"))
    redeem_trigger_price = finite_or_none(source_row.get("强赎触发价"))
    issue_scale = finite_or_none(source_row.get("发行规模_亿元"))
    conversion_start_date = compact_date(source_row.get("开始转股日"))
    maturity_date = compact_date(source_row.get("到期日期"))
    maturity_redemption_price = finite_or_none(source_row.get("到期赎回价"))

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=30.0,
    )
    requested_codes = [stored_code, stock_code] if stock_code else [stored_code]
    ticks = bridge.full_tick(requested_codes)
    details = bridge.details([stored_code])
    bond_tick = ticks.get(stored_code) or {}
    stock_tick = ticks.get(stock_code) or {}
    detail = details.get(stored_code) or {}
    bond_price = (
        finite_or_none(bond_tick.get("lastPrice"))
        or finite_or_none(detail.get("PreClose"))
    )
    stock_price = finite_or_none(stock_tick.get("lastPrice"))
    stock_previous_close = finite_or_none(stock_tick.get("lastClose"))
    stock_change = (
        (stock_price / stock_previous_close - 1) * 100
        if stock_price is not None
        and stock_price > 0
        and stock_previous_close is not None
        and stock_previous_close > 0
        else None
    )
    stock_trading_date = compact_date(stock_tick.get("timetag"))
    try:
        stock_intraday = stock_intraday_prices(
            bridge,
            stock_code,
            stock_trading_date,
        )
    except Exception:
        stock_intraday = []
    float_volume = (
        finite_or_none(detail.get("FloatVolume"))
        or finite_or_none(detail.get("FloatVolumn"))
    )
    total_volume = (
        finite_or_none(detail.get("TotalVolume"))
        or finite_or_none(detail.get("TotalVolumn"))
    )
    circulating_face_value = (
        float_volume
        if float_volume is not None and float_volume > 0
        else issue_scale * 100_000_000
        if issue_scale is not None and issue_scale > 0
        else None
    )
    circulating_market_value = (
        circulating_face_value * bond_price / 100
        if circulating_face_value is not None
        and bond_price is not None
        and bond_price > 0
        else None
    )
    conversion_value = (
        stock_price / conversion_price * 100
        if stock_price is not None
        and stock_price > 0
        and conversion_price is not None
        and conversion_price > 0
        else None
    )
    premium_rate = (
        (bond_price / conversion_value - 1) * 100
        if bond_price is not None
        and bond_price > 0
        and conversion_value is not None
        and conversion_value > 0
        else None
    )

    target_days = 15
    window_days = 30
    now = datetime.now()
    calendar_date = now.strftime("%Y%m%d")
    announcement = latest_redeem_announcement(stock_code) if stock_code else {}
    reset_after = compact_date(announcement.get("reset_after"))
    price_hit_dates: list[str] = []
    observed_days = 0
    history_error = ""
    before_conversion = bool(
        len(conversion_start_date) == 8 and conversion_start_date > calendar_date
    )
    if stock_code and redeem_trigger_price and not before_conversion:
        start_date = (now - timedelta(days=120)).strftime("%Y%m%d")
        try:
            daily_rows = stock_daily_closes(
                bridge,
                stock_code,
                start_date,
                calendar_date,
            )
            eligible_rows = [
                row
                for row in daily_rows
                if not conversion_start_date or row["date"] >= conversion_start_date
                if not reset_after or row["date"] > reset_after
            ][-window_days:]
            observed_days = len(eligible_rows)
            price_hit_dates = [
                row["date"]
                for row in eligible_rows
                if float(row["close"]) >= redeem_trigger_price
            ]
        except Exception as error:
            history_error = f"{type(error).__name__}: {error}"

    price_hit_count = len(price_hit_dates)
    remaining_hit_days = max(0, target_days - price_hit_count)
    balance_condition_met = bool(
        circulating_face_value is not None and circulating_face_value < 30_000_000
    )
    price_condition_met = price_hit_count >= target_days
    announcement_type = str(announcement.get("type") or "")
    if announcement.get("commitment_active"):
        commitment_end = compact_date(announcement.get("commitment_end"))
        status = "承诺期内不强赎"
        countdown = (
            f"保护期至 {commitment_end[:4]}-{commitment_end[4:6]}-{commitment_end[6:8]}"
            if len(commitment_end) == 8
            else "以公司公告期限为准"
        )
        risk = "protected"
    elif announcement_type in {"redeem", "redeeming", "redeem_finished"}:
        status = str(announcement.get("status") or "已发布强赎公告")
        countdown = "查看最新公司公告"
        risk = "triggered"
    elif before_conversion:
        start_moment = datetime.strptime(conversion_start_date, "%Y%m%d")
        status = "未进入转股期"
        countdown = f"距开始转股 {max(0, (start_moment.date() - now.date()).days)} 天"
        risk = "inactive"
    elif balance_condition_met:
        status = "余额条件已满足"
        countdown = "待公司公告确认"
        risk = "triggered"
    elif price_condition_met:
        status = "价格条件已满足"
        countdown = "待公司公告确认"
        risk = "triggered"
    elif observed_days == 0:
        status = "强赎计数暂不可用"
        countdown = "缺少正股日线"
        risk = "unknown"
    else:
        status = f"近{window_days}日 {price_hit_count}/{target_days}"
        countdown = f"尚差 {remaining_hit_days} 个满足日"
        risk = "high" if remaining_hit_days <= 3 else "watch" if price_hit_count else "low"

    maturity_days_remaining: int | None = None
    maturity_status = "暂无到期日"
    maturity_countdown = "本地条款快照未提供到期日期"
    maturity_risk = "unknown"
    if len(maturity_date) == 8:
        maturity_moment = datetime.strptime(maturity_date, "%Y%m%d").date()
        maturity_days_remaining = (maturity_moment - now.date()).days
        if maturity_days_remaining < 0:
            maturity_status = "已到期"
            maturity_risk = "expired"
        elif maturity_days_remaining == 0:
            maturity_status = "今日到期"
            maturity_risk = "urgent"
        else:
            maturity_status = f"{maturity_days_remaining} 天"
            maturity_risk = (
                "urgent"
                if maturity_days_remaining <= 90
                else "near"
                if maturity_days_remaining <= 365
                else "normal"
            )
        maturity_countdown = f"到期日 {dashed_date(maturity_date)}"
        if maturity_redemption_price is not None:
            maturity_countdown += f" · 赎回价 {maturity_redemption_price:.2f} 元"
        if announcement_type in {"redeem", "redeeming"}:
            maturity_countdown = f"若未提前赎回 · {maturity_countdown}"

    payload = clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "cached": False,
            "generated_at": now.isoformat(timespec="seconds"),
            "source": f"MiniQMT full_tick + instrument detail + {reference_source}",
            "code": code,
            "monitor_code": stored_code,
            "name": source_row.get("转债简称") or tag_row.get("name"),
            "stock_code": stock_code,
            "stock_name": source_row.get("正股简称") or tag_row.get("stockName"),
            "bond_price": bond_price,
            "stock_price": stock_price,
            "stock_previous_close": stock_previous_close,
            "stock_change": stock_change,
            "stock_trading_date": stock_trading_date,
            "stock_intraday": stock_intraday,
            "conversion_price": conversion_price,
            "conversion_value": conversion_value,
            "premium_rate": premium_rate,
            "circulating_face_value": circulating_face_value,
            "circulating_market_value": circulating_market_value,
            "issue_face_value": issue_scale * 100_000_000 if issue_scale else total_volume,
            "circulating_source": (
                "MiniQMT FloatVolume"
                if float_volume is not None and float_volume > 0
                else "发行规模回退值"
            ),
            "redeem": {
                "risk": risk,
                "status": status,
                "countdown": countdown,
                "trigger_price": redeem_trigger_price,
                "window_days": window_days,
                "target_days": target_days,
                "observed_days": observed_days,
                "price_hit_count": price_hit_count,
                "remaining_hit_days": remaining_hit_days,
                "price_condition_met": price_condition_met,
                "balance_condition_met": balance_condition_met,
                "conversion_start_date": conversion_start_date,
                "latest_hit_date": price_hit_dates[-1] if price_hit_dates else None,
                "count_start_after": reset_after or None,
                "announcement": announcement,
                "quality": "按近30个交易日正股收盘价与当前强赎触发价估算；公司公告优先",
                "history_error": history_error or None,
            },
            "maturity": {
                "risk": maturity_risk,
                "status": maturity_status,
                "countdown": maturity_countdown,
                "maturity_date": maturity_date or None,
                "days_remaining": maturity_days_remaining,
                "redemption_price": maturity_redemption_price,
                "current_path": (
                    "strong_redeem"
                    if announcement_type in {"redeem", "redeeming"}
                    else "maturity_redemption"
                ),
                "quality": "按合同到期日期计算自然日；若公司提前强赎，以最新公司公告为准",
            },
        }
    )
    BOND_METADATA_CACHE[stored_code] = (time.monotonic(), payload)
    return payload


def elapsed_market_minutes_from_clock(value: Any) -> int:
    match = re.search(r"(\d{2}):(\d{2})", str(value or ""))
    if not match:
        return 0
    hour = int(match.group(1))
    minute = int(match.group(2))
    clock_minutes = hour * 60 + minute
    if 570 <= clock_minutes <= 690:
        return clock_minutes - 570 + 1
    if 780 <= clock_minutes <= 900:
        return 121 + clock_minutes - 780
    return 0


def compute_purple_break_stats(
    minutes: list[Any],
    series: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    """Count distinct confirmed purple-line breakdown episodes."""
    if len(minutes) < PURPLE_BREAK_CONFIRM_BARS:
        return {
            "count": 0,
            "last_ms": 0,
            "tolerance_pct": PURPLE_BREAK_TOLERANCE * 100,
            "confirm_bars": PURPLE_BREAK_CONFIRM_BARS,
        }
    values = series or MONITOR.compute_indicator_series(minutes)
    count = 0
    below_streak = 0
    active_break = False
    last_ms = 0
    for index, bar in enumerate(minutes):
        purple = finite_or_none(values["purple"][index])
        close = finite_or_none(bar.close)
        if purple is None or purple <= 0 or close is None:
            below_streak = 0
            continue
        if close <= purple * (1 - PURPLE_BREAK_TOLERANCE):
            below_streak += 1
            if below_streak >= PURPLE_BREAK_CONFIRM_BARS and not active_break:
                count += 1
                last_ms = int(bar.minute_ms)
                active_break = True
        else:
            below_streak = 0
            if close >= purple:
                active_break = False
    return {
        "count": count,
        "last_ms": last_ms,
        "tolerance_pct": PURPLE_BREAK_TOLERANCE * 100,
        "confirm_bars": PURPLE_BREAK_CONFIRM_BARS,
    }


def update_active_index_tick_minutes(
    ticks: dict[str, dict[str, Any]],
    codes: list[str],
    trading_date: str,
) -> dict[str, list[dict[str, Any]]]:
    for cached_date in list(ACTIVE_INDEX_TICK_MINUTES):
        if cached_date != trading_date:
            ACTIVE_INDEX_TICK_MINUTES.pop(cached_date, None)
    date_cache = ACTIVE_INDEX_TICK_MINUTES.setdefault(trading_date, {})

    for code in codes:
        tick = ticks.get(code)
        if not isinstance(tick, dict):
            continue
        timestamp = tick_minute_timestamp(tick)
        price = finite_or_none(tick.get("lastPrice"))
        previous_close = finite_or_none(tick.get("lastClose"))
        if timestamp <= 0 or price is None or price <= 0:
            continue
        code_cache = date_cache.setdefault(code, {})
        previous_row = max(
            (
                row
                for minute, row in code_cache.items()
                if minute < timestamp
            ),
            key=lambda row: int(row["time"]),
            default=None,
        )
        cumulative_amount = finite_or_none(tick.get("amount")) or 0
        cumulative_volume = finite_or_none(tick.get("volume")) or 0
        prior_amount = float((previous_row or {}).get("cumulative_amount") or 0)
        prior_volume = float((previous_row or {}).get("cumulative_volume") or 0)
        code_cache[timestamp] = {
            "time": timestamp,
            "close": price,
            "preClose": previous_close,
            "amount": (
                max(0.0, cumulative_amount - prior_amount)
                if previous_row
                else 0
            ),
            "volume": (
                max(0.0, cumulative_volume - prior_volume)
                if previous_row
                else 0
            ),
            "cumulative_amount": cumulative_amount,
            "cumulative_volume": cumulative_volume,
        }

    return {
        code: [
            dict(row)
            for _, row in sorted((date_cache.get(code) or {}).items())
        ]
        for code in codes
    }


def merge_active_index_minute_bars(
    codes: list[str],
    *sources: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    merged: dict[str, list[dict[str, Any]]] = {}
    for code in codes:
        by_timestamp: dict[int, dict[str, Any]] = {}
        for source in sources:
            for row in source.get(code) or []:
                timestamp = int(row.get("time") or 0)
                if timestamp > 0:
                    by_timestamp[timestamp] = row
        merged[code] = [
            by_timestamp[timestamp]
            for timestamp in sorted(by_timestamp)
        ]
    return merged


def active_index_payload() -> dict[str, Any]:
    global ACTIVE_INDEX_CACHE
    if (
        ACTIVE_INDEX_CACHE
        and time.monotonic() - ACTIVE_INDEX_CACHE[0] < ACTIVE_INDEX_CACHE_TTL_SECONDS
    ):
        return {**ACTIVE_INDEX_CACHE[1], "cached": True}

    source = load_active_index_source()
    candidates = list(source.get("bondCandidates") or [])
    candidate_by_code = {
        str(item.get("code") or ""): item
        for item in candidates
        if MARKET_CODE_PATTERN.fullmatch(str(item.get("code") or ""))
    }
    codes = list(candidate_by_code)
    names = {
        code: str(item.get("name") or code)
        for code, item in candidate_by_code.items()
    }
    if not codes:
        raise LookupError("活跃转债指数候选池为空")

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=15.0,
    )
    names = resolve_active_index_names(bridge, codes, names)
    ticks: dict[str, dict[str, Any]] = {}
    for index in range(0, len(codes), 100):
        ticks.update(bridge.full_tick(codes[index : index + 100]))
    quote_date = quote_date_from_ticks(ticks)
    if not quote_date:
        raise LookupError("MiniQMT未返回可用的转债行情日期")

    universe_cache = load_active_index_universes(source)
    universes = universe_cache["universes"]
    calendar_date = datetime.now().strftime("%Y%m%d")
    if calendar_date > quote_date:
        next_effective_date = calendar_date
    elif datetime.now().time() >= datetime.strptime("15:05", "%H:%M").time():
        next_effective_date = next_weekday(quote_date)
    else:
        next_effective_date = ""

    if next_effective_date:
        current_signature = (
            quote_date,
            len(
                [
                    tick
                    for tick in ticks.values()
                    if compact_date(tick.get("timetag")) == quote_date
                    and (finite_or_none(tick.get("amount")) or 0)
                    > ACTIVE_INDEX_THRESHOLD
                ]
            ),
        )
        cached_universe = universes.get(next_effective_date) or {}
        cached_signature = (
            compact_date(cached_universe.get("selected_from_date")),
            len(cached_universe.get("constituents") or []),
        )
        if current_signature != cached_signature:
            universes[next_effective_date] = build_universe_from_ticks(
                ticks,
                names,
                quote_date,
                next_effective_date,
            )
            persist_active_index_universes(universe_cache)

    chart_universe = universes.get(quote_date)
    if not isinstance(chart_universe, dict):
        available = [
            value
            for key, value in universes.items()
            if key <= quote_date and isinstance(value, dict)
        ]
        chart_universe = available[-1] if available else {}
    table_date = (
        calendar_date
        if calendar_date in universes and calendar_date >= quote_date
        else quote_date
    )
    table_universe = universes.get(table_date) or chart_universe

    chart_codes = [
        str(item.get("code") or "")
        for item in chart_universe.get("constituents") or []
        if MARKET_CODE_PATTERN.fullmatch(str(item.get("code") or ""))
    ]
    table_constituents = list(table_universe.get("constituents") or [])
    table_codes = [
        str(item.get("code") or "")
        for item in table_constituents
        if MARKET_CODE_PATTERN.fullmatch(str(item.get("code") or ""))
    ]
    requested_codes = list(dict.fromkeys([*chart_codes, *table_codes]))
    session_end = datetime.strptime(f"{quote_date}150000", "%Y%m%d%H%M%S")
    if quote_date == calendar_date:
        session_end = datetime.now()
    qmt_minute_error = ""
    try:
        qmt_minute_data = bridge.minute_bars(
            requested_codes,
            quote_date,
            session_end,
            timeout=40.0,
        )
    except Exception as error:
        qmt_minute_error = f"{type(error).__name__}: {error}"
        qmt_minute_data = {code: [] for code in requested_codes}
    local_minute_data = load_local_minute_bars(requested_codes, quote_date)
    tick_minute_data = update_active_index_tick_minutes(
        ticks,
        requested_codes,
        quote_date,
    )
    minute_data = merge_active_index_minute_bars(
        requested_codes,
        qmt_minute_data,
        tick_minute_data,
        local_minute_data,
    )

    historical_rows = list(source.get("indexDailyK") or [])
    previous_k = next(
        (
            row
            for row in reversed(historical_rows)
            if compact_date(row.get("date")) < quote_date
        ),
        None,
    )
    anchor = float((previous_k or {}).get("close") or 100)
    values_by_minute: dict[int, list[dict[str, float]]] = {}
    rows_by_code: dict[str, list[dict[str, Any]]] = {}
    for code in requested_codes:
        parsed_rows: list[dict[str, Any]] = []
        tick = ticks.get(code) or {}
        fallback_previous_close = finite_or_none(tick.get("lastClose"))
        for raw in minute_data.get(code) or []:
            close = finite_or_none(raw.get("close"))
            previous_close = (
                fallback_previous_close
                or finite_or_none(raw.get("preClose"))
            )
            timestamp = int(raw.get("time") or 0)
            if (
                close is None
                or close <= 0
                or previous_close is None
                or previous_close <= 0
                or timestamp <= 0
            ):
                continue
            item = {
                "time": timestamp,
                "close": close,
                "previous_close": previous_close,
                "volume": finite_or_none(raw.get("volume")) or 0,
                "amount": finite_or_none(raw.get("amount")) or 0,
            }
            parsed_rows.append(item)
            if code in chart_codes:
                values_by_minute.setdefault(timestamp, []).append(item)
        parsed_rows.sort(key=lambda item: item["time"])
        rows_by_code[code] = parsed_rows

    intraday: list[dict[str, Any]] = []
    for timestamp in sorted(values_by_minute):
        rows = values_by_minute[timestamp]
        returns = [
            row["close"] / row["previous_close"] - 1
            for row in rows
        ]
        average_return = sum(returns) / len(returns)
        intraday.append(
            {
                "time": timestamp,
                "clock": datetime.fromtimestamp(timestamp / 1000).strftime("%H:%M"),
                "value": anchor * (1 + average_return),
                "change": average_return * 100,
                "amount": sum(row["amount"] for row in rows),
                "volume": sum(row["volume"] for row in rows),
                "up": sum(1 for value in returns if value > 0),
                "down": sum(1 for value in returns if value < 0),
                "coverage": len(rows),
            }
        )

    latest_intraday = intraday[-1] if intraday else None
    current_table: list[dict[str, Any]] = []
    table_info = {
        str(item.get("code") or ""): item
        for item in table_constituents
    }
    for code in table_codes:
        tick = ticks.get(code)
        if not isinstance(tick, dict):
            continue
        price = finite_or_none(tick.get("lastPrice"))
        previous_close = finite_or_none(tick.get("lastClose"))
        if price is None or price <= 0:
            continue
        minute_rows = rows_by_code.get(code) or []
        latest_minute = minute_rows[-1] if minute_rows else None
        prior_minute = minute_rows[-2] if len(minute_rows) >= 2 else None
        speed_1m = (
            (latest_minute["close"] / prior_minute["close"] - 1) * 100
            if latest_minute and prior_minute and prior_minute["close"] > 0
            else None
        )
        candidate = candidate_by_code.get(code) or {}
        constituent = table_info.get(code) or {}
        volume_ratio = active_index_volume_ratio(
            tick,
            candidate,
            constituent,
            table_universe.get("selected_from_date") or "",
        )
        current_volume = finite_or_none(tick.get("volume")) or 0
        close_3 = finite_or_none(candidate.get("close3SessionsAgo"))
        change_3 = (
            (price / close_3 - 1) * 100
            if close_3 is not None and close_3 > 0
            else None
        )
        current_table.append(
            {
                "code": code,
                "name": names.get(code, code),
                "tags": bond_tags(code),
                "price": price,
                "change": (
                    (price / previous_close - 1) * 100
                    if previous_close is not None and previous_close > 0
                    else None
                ),
                "speed1m": speed_1m,
                "volumeRatio": volume_ratio,
                "amount": finite_or_none(tick.get("amount")) or 0,
                "volume": current_volume,
                "amount1m": float((latest_minute or {}).get("amount") or 0),
                "change3d": change_3,
                "high": finite_or_none(tick.get("high")),
                "low": finite_or_none(tick.get("low")),
                "previousAmount": finite_or_none(
                    (table_info.get(code) or {}).get("previousAmount")
                ),
                "time": str(tick.get("timetag") or "")[9:17],
            }
        )
    current_table.sort(
        key=lambda item: float(item.get("amount") or 0),
        reverse=True,
    )
    current_index_amount = sum(
        float(item.get("amount") or 0)
        for item in current_table
    )

    daily_rows = historical_rows[-120:]
    if intraday and compact_date(daily_rows[-1].get("date")) < quote_date:
        values = [float(item["value"]) for item in intraday]
        daily_rows = [
            *daily_rows,
            {
                "date": dashed_date(quote_date),
                "open": values[0],
                "high": max(values),
                "low": min(values),
                "close": values[-1],
                "amount": current_index_amount,
                "volume": sum(float(item["volume"]) for item in intraday),
                "source": "MiniQMT成分等权合成",
            },
        ]

    now = datetime.now()
    is_live = (
        quote_date == calendar_date
        and now.weekday() < 5
        and (
            datetime.strptime("09:30", "%H:%M").time()
            <= now.time()
            <= datetime.strptime("11:30", "%H:%M").time()
            or datetime.strptime("13:00", "%H:%M").time()
            <= now.time()
            <= datetime.strptime("15:05", "%H:%M").time()
        )
    )
    result = clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": "MiniQMT full_tick + 1m",
            "generated_at": now.isoformat(timespec="seconds"),
            "cached": False,
            "quote_date": dashed_date(quote_date),
            "calendar_date": dashed_date(calendar_date),
            "is_live": is_live,
            "data_is_stale": quote_date != calendar_date,
            "index": {
                "name": "活跃转债复刻指数",
                "code": "880677-R",
                "anchor": anchor,
                "value": float((latest_intraday or {}).get("value") or anchor),
                "change": float((latest_intraday or {}).get("change") or 0),
                "amount": current_index_amount,
                "up": int((latest_intraday or {}).get("up") or 0),
                "down": int((latest_intraday or {}).get("down") or 0),
            },
            "chart_universe": {
                "effective_date": dashed_date(
                    chart_universe.get("effective_date") or quote_date
                ),
                "selected_from_date": dashed_date(
                    chart_universe.get("selected_from_date") or ""
                ),
                "count": len(chart_codes),
            },
            "table_universe": {
                "effective_date": dashed_date(
                    table_universe.get("effective_date") or table_date
                ),
                "selected_from_date": dashed_date(
                    table_universe.get("selected_from_date") or ""
                ),
                "count": len(table_codes),
                "source": table_universe.get("source"),
            },
            "intraday": intraday,
            "daily": daily_rows,
            "constituents": current_table,
            "coverage": {
                "candidate_count": len(codes),
                "tick_count": len(ticks),
                "chart_requested": len(chart_codes),
                "chart_with_minutes": sum(
                    1 for code in chart_codes if rows_by_code.get(code)
                ),
                "chart_with_qmt_minutes": sum(
                    1 for code in chart_codes if qmt_minute_data.get(code)
                ),
                "chart_with_local_minutes": sum(
                    1 for code in chart_codes if local_minute_data.get(code)
                ),
                "chart_with_tick_minutes": sum(
                    1 for code in chart_codes if tick_minute_data.get(code)
                ),
                "table_requested": len(table_codes),
                "table_returned": len(current_table),
                "qmt_minute_error": qmt_minute_error,
            },
        }
    )
    ACTIVE_INDEX_CACHE = (time.monotonic(), result)
    return result


def local_reference_daily_payload(
    code_input: str,
    count_input: int = 30,
) -> dict[str, Any]:
    """Build reference daily bars entirely from local monitor minute databases."""

    code = normalize_code(code_input)
    stored_code = monitor_code(code)
    count = max(30, min(500, int(count_input or 30)))
    daily_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    query = """
        WITH selected AS (
          SELECT minute_ms,open,high,low,close,amount
          FROM minute_observations
          WHERE trading_date=? AND code=? AND (
            substr(minute_time,12,5) BETWEEN '09:30' AND '11:30'
            OR substr(minute_time,12,5) BETWEEN '13:00' AND '15:00'
          )
        )
        SELECT
          (SELECT open FROM selected ORDER BY minute_ms LIMIT 1) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          (SELECT close FROM selected ORDER BY minute_ms DESC LIMIT 1) AS close,
          COALESCE(SUM(amount),0) AS amount,
          COUNT(*) AS bar_count,
          MAX(minute_ms) AS last_minute_ms
        FROM selected
    """
    for database in available_databases():
        try:
            with closing(connect_read_only(database)) as connection:
                row = connection.execute(
                    query,
                    (database.stem, stored_code),
                ).fetchone()
        except (OSError, sqlite3.Error) as error:
            errors.append(f"{database.stem}:{type(error).__name__}")
            continue
        if not row or int(row["bar_count"] or 0) <= 0:
            continue
        open_price = finite_or_none(row["open"])
        high = finite_or_none(row["high"])
        low = finite_or_none(row["low"])
        close = finite_or_none(row["close"])
        if not all(
            value is not None and value > 0
            for value in (open_price, high, low, close)
        ):
            continue
        daily_rows.append(
            {
                "date": database.stem,
                "time": int(row["last_minute_ms"] or 0),
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": 0,
                "amount": finite_or_none(row["amount"]) or 0,
                "previous_close": None,
                "change": None,
                "suspend": 0,
                "bar_count": int(row["bar_count"] or 0),
            }
        )

    daily_rows.sort(key=lambda item: item["date"])
    daily_rows = daily_rows[-count:]
    for index, row in enumerate(daily_rows):
        previous_close = (
            finite_or_none(daily_rows[index - 1]["close"])
            if index > 0
            else None
        )
        row["previous_close"] = previous_close
        row["change"] = (
            (float(row["close"]) / previous_close - 1) * 100
            if previous_close is not None and previous_close > 0
            else None
        )
    if not daily_rows:
        raise LookupError(f"本地监控数据库没有{stored_code}的参考日线")

    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": "本地监控分钟聚合",
            "quality": "aggregated_from_local_minute_observations",
            "reference_only": True,
            "local_only": True,
            "code": code,
            "monitor_code": stored_code,
            "tags": bond_tags(stored_code),
            "count": len(daily_rows),
            "requested_count": count,
            "start_date": daily_rows[0]["date"],
            "end_date": daily_rows[-1]["date"],
            "available_dates": [row["date"] for row in daily_rows],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "download_error": None,
            "live_tick_error": None,
            "database_errors": errors,
            "cached": False,
            "rows": daily_rows,
        }
    )


def daily_payload(code_input: str, count_input: int = 120) -> dict[str, Any]:
    code = normalize_code(code_input)
    count = max(30, min(500, int(count_input or 120)))
    cache_key = f"{code}:{count}"
    cached = DAILY_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < DAILY_CACHE_TTL_SECONDS:
        return {**cached[1], "cached": True}

    stored_code = monitor_code(code)
    end_moment = datetime.now()
    start_moment = end_moment - timedelta(days=max(730, int(count * 2.6)))
    start_time = start_moment.strftime("%Y%m%d")
    end_time = end_moment.strftime("%Y%m%d")
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=30.0,
    )
    # Read the cache already maintained by MiniQMT. Interactive dashboard GETs
    # must never enqueue history_data2 because the Bridge serializes xtdata and
    # a single cold download can stall every live quote and detail request.
    download_error = "interactive_history_download_disabled"

    payload = bridge.get(
        "/api/market/market_data_ex",
        {
            "stocks": stored_code,
            "period": "1d",
            "start_time": start_time,
            "end_time": end_time,
            "count": "-1",
            "dividend_type": "none",
            "fill_data": "false",
        },
        timeout=30.0,
    )
    raw_rows = list((payload.get("data") or {}).get(stored_code) or [])
    rows: list[dict[str, Any]] = []
    for raw in raw_rows:
        open_price = finite_or_none(raw.get("open"))
        high = finite_or_none(raw.get("high"))
        low = finite_or_none(raw.get("low"))
        close = finite_or_none(raw.get("close"))
        if not all(
            value is not None and value > 0
            for value in (open_price, high, low, close)
        ):
            continue
        trading_date = str(raw.get("index") or "")
        if not re.fullmatch(r"\d{8}", trading_date):
            timestamp = int(raw.get("time") or 0)
            trading_date = (
                datetime.fromtimestamp(timestamp / 1000).strftime("%Y%m%d")
                if timestamp > 0
                else ""
            )
        previous_close = finite_or_none(raw.get("preClose"))
        change = (
            (close / previous_close - 1) * 100
            if previous_close is not None and previous_close > 0
            else None
        )
        rows.append(
            {
                "date": trading_date,
                "time": int(raw.get("time") or 0),
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": finite_or_none(raw.get("volume")) or 0,
                "amount": finite_or_none(raw.get("amount")) or 0,
                "previous_close": previous_close,
                "change": change,
                "suspend": int(raw.get("suspendFlag") or 0),
            }
        )

    live_tick_error = ""
    live_tick_added = False
    try:
        tick = bridge.full_tick([stored_code]).get(stored_code) or {}
        tick_date = compact_date(tick.get("timetag"))
        close = finite_or_none(tick.get("lastPrice"))
        previous_close = finite_or_none(tick.get("lastClose"))
        amount = finite_or_none(tick.get("amount")) or 0
        volume = finite_or_none(tick.get("volume")) or 0
        if (
            len(tick_date) == 8
            and close is not None
            and close > 0
            and (amount > 0 or volume > 0)
            and (not rows or tick_date >= str(rows[-1].get("date") or ""))
        ):
            open_price = finite_or_none(tick.get("open")) or close
            high = finite_or_none(tick.get("high")) or close
            low = finite_or_none(tick.get("low")) or close
            change = (
                (close / previous_close - 1) * 100
                if previous_close is not None and previous_close > 0
                else None
            )
            live_row = {
                "date": tick_date,
                "time": int(tick.get("time") or 0),
                "open": open_price,
                "high": max(high, open_price, close),
                "low": min(low, open_price, close),
                "close": close,
                "volume": volume,
                "amount": amount,
                "previous_close": previous_close,
                "change": change,
                "suspend": 0,
            }
            rows = [row for row in rows if row.get("date") != tick_date]
            rows.append(live_row)
            live_tick_added = True
    except Exception as error:
        live_tick_error = f"{type(error).__name__}: {error}"

    rows.sort(key=lambda row: (row["date"], row["time"]))
    rows = rows[-count:]
    if not rows:
        detail = f"；下载错误：{download_error}" if download_error else ""
        raise LookupError(f"MiniQMT未返回{stored_code}日K数据{detail}")

    result = clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "source": (
                "MiniQMT 1d + full_tick当日K"
                if live_tick_added
                else "MiniQMT 1d"
            ),
            "code": code,
            "monitor_code": stored_code,
            "tags": bond_tags(stored_code),
            "count": len(rows),
            "requested_count": count,
            "start_date": rows[0]["date"],
            "end_date": rows[-1]["date"],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "download_error": download_error or None,
            "live_tick_error": live_tick_error or None,
            "cached": False,
            "rows": rows,
        }
    )
    DAILY_CACHE[cache_key] = (time.monotonic(), result)
    return result


def resolve_name(
    connection: sqlite3.Connection,
    trading_date: str,
    code: str,
) -> str:
    row = connection.execute(
        """
        SELECT name
        FROM qmt_events
        WHERE trading_date=? AND code=? AND name<>''
        ORDER BY event_time_ms DESC
        LIMIT 1
        """,
        (trading_date, code),
    ).fetchone()
    return str(row["name"]) if row else ""


def previous_close_for_date(
    trading_date: str,
    stored_code: str,
) -> tuple[float | None, str | None]:
    databases = available_databases()
    current_index = next(
        (index for index, path in enumerate(databases) if path.stem == trading_date),
        -1,
    )
    if current_index < 0:
        return None, None
    for database in databases[current_index + 1 :]:
        with connect_read_only(database) as connection:
            row = connection.execute(
                """
                SELECT close
                FROM minute_observations
                WHERE trading_date=? AND code=?
                ORDER BY minute_ms DESC
                LIMIT 1
                """,
                (database.stem, stored_code),
            ).fetchone()
        if row and float(row["close"]) > 0:
            return float(row["close"]), database.stem
    return None, None


def intraday_download_backoff_state(
    cache_key: str,
    now: float | None = None,
) -> dict[str, Any]:
    current = time.monotonic() if now is None else float(now)
    state = INTRADAY_DOWNLOAD_BACKOFF.get(cache_key) or {}
    retry_at = float(state.get("retry_at") or 0)
    return {
        **state,
        "active": retry_at > current,
        "retry_in_seconds": max(0.0, retry_at - current),
    }


def record_intraday_download_failure(
    cache_key: str,
    error: str,
    now: float | None = None,
) -> dict[str, Any]:
    current = time.monotonic() if now is None else float(now)
    previous = INTRADAY_DOWNLOAD_BACKOFF.get(cache_key) or {}
    failures = int(previous.get("failures") or 0) + 1
    delay = min(
        INTRADAY_DOWNLOAD_BACKOFF_MAX_SECONDS,
        INTRADAY_DOWNLOAD_BACKOFF_INITIAL_SECONDS * (2 ** (failures - 1)),
    )
    state = {
        "failures": failures,
        "last_error": str(error or "minute_data_incomplete"),
        "retry_at": current + delay,
        "delay_seconds": delay,
    }
    INTRADAY_DOWNLOAD_BACKOFF[cache_key] = state
    return {**state, "active": True, "retry_in_seconds": float(delay)}


def clear_intraday_download_backoff(cache_key: str) -> None:
    INTRADAY_DOWNLOAD_BACKOFF.pop(cache_key, None)


def fetch_bridge_minute_rows(
    bridge: Any,
    stored_code: str,
    trading_date: str,
    timeout: float = 60.0,
) -> tuple[list[dict[str, Any]], float | None]:
    payload = bridge.get(
        "/api/market/market_data_ex",
        {
            "stocks": stored_code,
            "period": "1m",
            "start_time": f"{trading_date}093000",
            "end_time": f"{trading_date}150000",
            "count": "-1",
            "dividend_type": "none",
            "fill_data": "false",
        },
        timeout=timeout,
    )
    raw_rows = list((payload.get("data") or {}).get(stored_code) or [])
    rows: list[dict[str, Any]] = []
    previous_close = None
    for raw in raw_rows:
        compact_time = str(raw.get("index") or "")
        if not compact_time.startswith(trading_date):
            continue
        open_price = finite_or_none(raw.get("open"))
        high = finite_or_none(raw.get("high"))
        low = finite_or_none(raw.get("low"))
        close = finite_or_none(raw.get("close"))
        if not all(
            value is not None and value > 0
            for value in (open_price, high, low, close)
        ):
            continue
        if previous_close is None:
            previous_close = finite_or_none(raw.get("preClose"))
        try:
            minute_time = datetime.strptime(
                compact_time[:14],
                "%Y%m%d%H%M%S",
            ).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        rows.append(
            {
                "minute_ms": int(raw.get("time") or 0),
                "minute_time": minute_time,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": finite_or_none(raw.get("volume")) or 0,
                "amount": finite_or_none(raw.get("amount")) or 0,
            }
        )
    rows.sort(key=lambda row: (row["minute_ms"], row["minute_time"]))
    return rows, previous_close


def historical_minute_rows(
    stored_code: str,
    trading_date: str,
) -> tuple[list[dict[str, Any]], float | None, str | None, str]:
    if not re.fullmatch(r"\d{8}", trading_date):
        raise ValueError("历史分时日期必须为YYYYMMDD")
    cache_key = f"{stored_code}:{trading_date}"
    # The worker and the read-only detail endpoint share this cache.  Loading
    # the disk copy here is important after a dashboard restart: a ready job
    # without its rows would otherwise look complete but render another gap.
    intraday_cache_snapshot(stored_code, trading_date)
    cached = INTRADAY_CACHE.get(cache_key)
    is_current_day = trading_date == datetime.now().strftime("%Y%m%d")
    cache_ttl = (
        INTRADAY_CURRENT_CACHE_TTL_SECONDS
        if is_current_day
        else INTRADAY_CACHE_TTL_SECONDS
    )
    if cached and time.monotonic() - cached[0] < cache_ttl:
        cached_payload = cached[1]
        cached_needs_backfill = minute_rows_need_backfill(
            list(cached_payload["rows"]),
            trading_date,
        )
        partial_note = " · 部分缓存" if cached_needs_backfill else " · 缓存"
        return (
            list(cached_payload["rows"]),
            finite_or_none(cached_payload.get("previous_close")),
            cached_payload.get("previous_close_date"),
            f"MiniQMT 1m{partial_note}",
        )

    # Interactive historical views are cache-only during the realtime session.
    # All history_data2 writes are owned by the serialized maintenance queue.
    allowed, wait_reason = intraday_download_permission(trading_date)
    if not allowed:
        if cached and cached[1].get("rows"):
            cached_payload = cached[1]
            return (
                list(cached_payload["rows"]),
                finite_or_none(cached_payload.get("previous_close")),
                cached_payload.get("previous_close_date"),
                f"MiniQMT 1m · 上次缓存（{wait_reason}）",
            )
        raise LookupError(
            f"{stored_code} 在 {trading_date} 的MiniQMT分钟缓存暂不可用："
            f"{wait_reason}"
        )

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=30.0,
    )
    try:
        rows, previous_close = fetch_bridge_minute_rows(
            bridge,
            stored_code,
            trading_date,
            timeout=INTRADAY_ASYNC_REFRESH_TIMEOUT_SECONDS,
        )
    except Exception as error:
        fetch_error = f"{type(error).__name__}: {error}"
        if cached and cached[1].get("rows"):
            cached_payload = cached[1]
            return (
                list(cached_payload["rows"]),
                finite_or_none(cached_payload.get("previous_close")),
                cached_payload.get("previous_close_date"),
                "MiniQMT 1m · 上次缓存（读取失败）",
            )
        raise LookupError(
            f"{stored_code} 在 {trading_date} 的分钟数据读取失败：{fetch_error}"
        ) from error

    if not rows:
        if cached and cached[1].get("rows"):
            cached_payload = cached[1]
            INTRADAY_CACHE[cache_key] = (time.monotonic(), cached_payload)
            return (
                list(cached_payload["rows"]),
                finite_or_none(cached_payload.get("previous_close")),
                cached_payload.get("previous_close_date"),
                "MiniQMT 1m · 上次缓存（空缓存响应）",
            )
        raise LookupError(f"{stored_code} 在 {trading_date} 没有MiniQMT分钟缓存")

    cached_payload = {
        "rows": rows,
        "previous_close": previous_close,
        "previous_close_date": None,
    }
    needs_backfill = minute_rows_need_backfill(rows, trading_date)
    INTRADAY_CACHE[cache_key] = (time.monotonic(), cached_payload)
    persist_intraday_cache_payload(
        stored_code,
        trading_date,
        cached_payload,
    )
    if not needs_backfill:
        clear_intraday_download_backoff(cache_key)
    source = "MiniQMT 1m · 部分缓存" if needs_backfill else "MiniQMT 1m"
    return rows, previous_close, None, source


def intraday_cache_snapshot(
    stored_code: str,
    trading_date: str,
) -> dict[str, Any]:
    cache_key = f"{stored_code}:{trading_date}"
    cached = INTRADAY_CACHE.get(cache_key)
    if not cached:
        persisted = load_persisted_intraday_cache(stored_code, trading_date)
        if persisted:
            age_seconds = max(
                0.0,
                time.time() - float(persisted.get("saved_at_epoch") or time.time()),
            )
            INTRADAY_CACHE[cache_key] = (
                time.monotonic() - age_seconds,
                {
                    "rows": list(persisted.get("rows") or []),
                    "previous_close": persisted.get("previous_close"),
                    "previous_close_date": persisted.get("previous_close_date"),
                },
            )
            cached = INTRADAY_CACHE[cache_key]
    if not cached:
        return {
            "rows": [],
            "previous_close": None,
            "previous_close_date": None,
            "age_seconds": None,
            "fresh": False,
        }
    age_seconds = max(0.0, time.monotonic() - float(cached[0]))
    payload = cached[1]
    return {
        "rows": list(payload.get("rows") or []),
        "previous_close": finite_or_none(payload.get("previous_close")),
        "previous_close_date": payload.get("previous_close_date"),
        "age_seconds": age_seconds,
        "fresh": age_seconds < INTRADAY_CURRENT_CACHE_TTL_SECONDS,
    }


def intraday_backfill_cache_path(stored_code: str, trading_date: str) -> Path:
    if not MARKET_CODE_PATTERN.fullmatch(stored_code):
        raise ValueError("分钟缓存代码无效")
    if not re.fullmatch(r"\d{8}", trading_date):
        raise ValueError("分钟缓存日期无效")
    return INTRADAY_BACKFILL_CACHE_ROOT / trading_date / f"{stored_code}.json"


def load_persisted_intraday_cache(
    stored_code: str,
    trading_date: str,
) -> dict[str, Any] | None:
    try:
        path = intraday_backfill_cache_path(stored_code, trading_date)
        raw = json.loads(path.read_text(encoding="utf-8"))
        rows = raw.get("rows") if isinstance(raw, dict) else None
        if not isinstance(rows, list):
            return None
        valid_rows = [row for row in rows if isinstance(row, dict)]
        if not valid_rows:
            return None
        return {
            "rows": merge_minute_rows(valid_rows),
            "previous_close": finite_or_none(raw.get("previous_close")),
            "previous_close_date": raw.get("previous_close_date"),
            "saved_at_epoch": float(
                raw.get("saved_at_epoch") or path.stat().st_mtime
            ),
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def persist_intraday_cache_payload(
    stored_code: str,
    trading_date: str,
    payload: dict[str, Any],
) -> None:
    rows = [row for row in payload.get("rows") or [] if isinstance(row, dict)]
    if not rows:
        return
    path = intraday_backfill_cache_path(stored_code, trading_date)
    saved_at_epoch = time.time()
    serializable = {
        "version": 1,
        "stored_code": stored_code,
        "trading_date": trading_date,
        "saved_at_epoch": saved_at_epoch,
        "previous_close": finite_or_none(payload.get("previous_close")),
        "previous_close_date": payload.get("previous_close_date"),
        "rows": rows,
    }
    with INTRADAY_BACKFILL_CACHE_PERSIST_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(
            f"{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp"
        )
        temporary.write_text(
            json.dumps(serializable, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(path)


INTRADAY_BACKFILL_WORKING_STATUSES = {
    "queued",
    "reading_cache",
    "downloading",
    "verifying",
    "persisting",
    "waiting_for_market_close",
    "waiting_for_bridge_cooldown",
}


def intraday_backfill_cache_key(stored_code: str, trading_date: str) -> str:
    return f"{stored_code}:{trading_date}"


def intraday_backfill_now_text(now: datetime | None = None) -> str:
    return china_now(now).isoformat(timespec="seconds")


def intraday_backfill_persistable_state(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in state.items()
        if key not in {"retry_at", "queued_internal"}
    }


def persist_intraday_backfill_state() -> None:
    with INTRADAY_BACKFILL_PERSIST_LOCK:
        with INTRADAY_ASYNC_REFRESH_LOCK:
            payload = {
                "version": 2,
                "saved_at": intraday_backfill_now_text(),
                "postclose_scanned_date": INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE,
                "postclose_universe_date": (
                    INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE
                ),
                "postclose_universe_codes": sorted(
                    INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES
                ),
                "active_key": INTRADAY_ASYNC_ACTIVE_KEY,
                "jobs": {
                    key: intraday_backfill_persistable_state(value)
                    for key, value in INTRADAY_ASYNC_REFRESH_STATE.items()
                },
            }
        path = INTRADAY_BACKFILL_STATE_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(
            f"{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp"
        )
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(path)


def load_intraday_backfill_state() -> None:
    global INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE
    global INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE
    global INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES
    global INTRADAY_BACKFILL_STATE_LOADED
    with INTRADAY_ASYNC_REFRESH_LOCK:
        if INTRADAY_BACKFILL_STATE_LOADED:
            return
        INTRADAY_BACKFILL_STATE_LOADED = True
    payload = read_json(INTRADAY_BACKFILL_STATE_PATH)
    jobs = payload.get("jobs") if isinstance(payload, dict) else {}
    interrupted = False
    with INTRADAY_ASYNC_REFRESH_LOCK:
        INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE = str(
            payload.get("postclose_scanned_date") or ""
        )
        INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE = str(
            payload.get("postclose_universe_date") or ""
        )
        INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES = {
            str(code)
            for code in payload.get("postclose_universe_codes") or []
            if MARKET_CODE_PATTERN.fullmatch(str(code))
        }
        for cache_key, raw in (jobs or {}).items():
            if not isinstance(raw, dict):
                continue
            state = dict(raw)
            if str(state.get("status") or "") in (
                INTRADAY_BACKFILL_WORKING_STATUSES
                - {"waiting_for_market_close", "waiting_for_bridge_cooldown"}
            ):
                state.update(
                    {
                        "status": "interrupted",
                        "active": False,
                        "queued": False,
                        "retryable": True,
                        "error": "dashboard_service_restarted_during_backfill",
                        "updated_at": intraday_backfill_now_text(),
                    }
                )
                interrupted = True
            INTRADAY_ASYNC_REFRESH_STATE[str(cache_key)] = state
    if interrupted:
        persist_intraday_backfill_state()


def intraday_backfill_retry_seconds(state: dict[str, Any]) -> float:
    retry_epoch = float(state.get("retry_at_epoch") or 0)
    if retry_epoch > 0:
        return max(0.0, retry_epoch - time.time())
    retry_at = float(state.get("retry_at") or 0)
    return max(0.0, retry_at - time.monotonic())


def intraday_backfill_status_for_key(cache_key: str) -> dict[str, Any]:
    with INTRADAY_ASYNC_REFRESH_LOCK:
        state = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
        active_key = INTRADAY_ASYNC_ACTIVE_KEY
        queued_keys = [
            key
            for key, value in sorted(
                INTRADAY_ASYNC_REFRESH_STATE.items(),
                key=lambda item: (
                    int(item[1].get("priority", 999)),
                    int(item[1].get("sequence") or 0),
                ),
            )
            if str(value.get("status") or "") == "queued"
        ]
    internal_status = str(state.get("status") or "idle")
    if internal_status in {
        "reading_cache",
        "downloading",
        "verifying",
        "persisting",
    }:
        public_status = "running"
    elif internal_status in {
        "waiting_for_market_close",
        "waiting_for_bridge_cooldown",
    }:
        public_status = "queued"
    else:
        public_status = internal_status
    row_count_before = int(state.get("row_count_before") or 0)
    row_count_after = int(state.get("row_count") or 0)
    expected = int(state.get("expected_bar_count") or 0)
    return {
        **state,
        "job_id": cache_key,
        "date": str(state.get("trading_date") or ""),
        "status": public_status,
        "phase": internal_status,
        "active": active_key == cache_key,
        "queued": public_status == "queued",
        "queue_position": (
            queued_keys.index(cache_key) + 1
            if internal_status == "queued" and cache_key in queued_keys
            else None
        ),
        "row_count": row_count_after,
        "row_count_before": row_count_before,
        "row_count_after": row_count_after,
        "expected_bar_count": expected,
        "missing_before": max(0, expected - row_count_before),
        "missing_after": max(0, expected - row_count_after),
        "error": str(state.get("error") or ""),
        "retry_in_seconds": intraday_backfill_retry_seconds(state),
        "poll_after_seconds": (
            1 if public_status in {"queued", "running"} else 3
        ),
    }


def intraday_async_refresh_status(cache_key: str) -> dict[str, Any]:
    state = intraday_backfill_status_for_key(cache_key)
    raw_status = state["phase"]
    if raw_status in {
        "waiting_for_market_close",
        "waiting_for_bridge_cooldown",
    }:
        # Waiting for the maintenance window is not active work.  The browser
        # should stop its fast loop and let the daemon scheduler resume it.
        public_status = "deferred"
    elif raw_status in INTRADAY_BACKFILL_WORKING_STATUSES:
        public_status = "pending"
    elif raw_status == "interrupted":
        public_status = "failed"
    else:
        public_status = raw_status
    return {
        "status": public_status,
        "job_status": raw_status,
        "active": bool(state["active"]),
        "row_count": int(state["row_count"]),
        "error": str(state["error"]),
        "retry_in_seconds": float(state["retry_in_seconds"]),
        "wait_reason": str(state.get("wait_reason") or ""),
        "retry_count": int(state.get("retry_count") or 0),
    }


def intraday_monitor_active(now: datetime | None = None) -> bool:
    current = china_now(now)
    service = read_json(SERVICE_PATH)
    status = read_json(STATUS_PATH)
    return bool(
        process_alive(int(service.get("pid") or 0))
        and str(status.get("status") or "") == "running"
        and str(status.get("trading_date") or "") == current.strftime("%Y%m%d")
    )


def intraday_download_permission(
    trading_date: str,
    now: datetime | None = None,
) -> tuple[bool, str]:
    current = china_now(now)
    if intraday_monitor_active(current):
        return False, "waiting_for_monitor_to_stop"
    calendar_date = current.strftime("%Y%m%d")
    if trading_date > calendar_date:
        return False, "future_trading_date"
    phase, _ = market_phase(current)
    if phase != "closed":
        return False, "waiting_for_market_close"
    clock = current.strftime("%H:%M:%S")
    if clock < INTRADAY_BACKFILL_AUTOMATIC_START:
        return False, "waiting_for_1512"
    if clock > INTRADAY_BACKFILL_AUTOMATIC_END:
        return False, "maintenance_window_closed"
    return True, "maintenance_window"


def intraday_automatic_window_open(now: datetime | None = None) -> bool:
    current = china_now(now)
    clock = current.strftime("%H:%M:%S")
    return bool(
        current.weekday() < 5
        and INTRADAY_BACKFILL_AUTOMATIC_START
        <= clock
        <= INTRADAY_BACKFILL_AUTOMATIC_END
    )


def merge_intraday_backfill_cache(
    stored_code: str,
    trading_date: str,
    rows: list[dict[str, Any]],
    previous_close: float | None,
) -> list[dict[str, Any]]:
    cache_key = intraday_backfill_cache_key(stored_code, trading_date)
    with INTRADAY_ASYNC_REFRESH_LOCK:
        cached = INTRADAY_CACHE.get(cache_key)
        payload = cached[1] if cached else {}
        existing_rows = list(payload.get("rows") or [])
        combined_rows = merge_minute_rows(existing_rows, rows)
        merged_payload = {
            "rows": combined_rows,
            "previous_close": (
                previous_close
                or finite_or_none(payload.get("previous_close"))
            ),
            "previous_close_date": payload.get("previous_close_date"),
        }
        INTRADAY_CACHE[cache_key] = (time.monotonic(), merged_payload)
    # Keep the completed/partial rows available across API restarts.  This is
    # deliberately separate from the monitor SQLite database, which remains
    # read-only for the dashboard process.
    persist_intraday_cache_payload(stored_code, trading_date, merged_payload)
    return combined_rows


def update_intraday_backfill_state(
    cache_key: str,
    generation: int,
    **updates: Any,
) -> bool:
    with INTRADAY_ASYNC_REFRESH_LOCK:
        current = INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {}
        if int(current.get("generation") or 0) != generation:
            return False
        current.update(updates)
        current["updated_at"] = intraday_backfill_now_text()
        INTRADAY_ASYNC_REFRESH_STATE[cache_key] = current
    persist_intraday_backfill_state()
    return True


def enqueue_intraday_backfill(
    stored_code: str,
    trading_date: str,
    *,
    requested_by: str,
    download_requested: bool,
    priority: int,
    force: bool = False,
    expected_generation: int | None = None,
    expected_status: str = "",
) -> dict[str, Any]:
    global INTRADAY_BACKFILL_SEQUENCE
    load_intraday_backfill_state()
    cache_key = intraday_backfill_cache_key(stored_code, trading_date)
    with INTRADAY_ASYNC_REFRESH_LOCK:
        previous = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
        previous_status = str(previous.get("status") or "idle")
        if (
            expected_generation is not None
            and (
                int(previous.get("generation") or 0) != int(expected_generation)
                or (expected_status and previous_status != expected_status)
            )
        ):
            return {
                **intraday_backfill_status_for_key(cache_key),
                "deduplicated": True,
                "stale_candidate": True,
            }
        is_manual_upgrade = (
            requested_by == "manual"
            and (
                previous.get("requested_by") != "manual"
                or not previous.get("download_requested")
            )
        )
        if (
            not force
            and not is_manual_upgrade
            and previous_status in INTRADAY_BACKFILL_WORKING_STATUSES
        ):
            return {**intraday_backfill_status_for_key(cache_key), "deduplicated": True}
        generation = int(previous.get("generation") or 0) + 1
        INTRADAY_BACKFILL_SEQUENCE += 1
        sequence = INTRADAY_BACKFILL_SEQUENCE
        cache_snapshot = intraday_cache_snapshot(stored_code, trading_date)
        row_count_before = len(cache_snapshot["rows"])
        expected_bar_count = expected_minute_count(trading_date)
        state = {
            **previous,
            "key": cache_key,
            "code": stored_code,
            "trading_date": trading_date,
            "status": "queued",
            "active": False,
            "queued": True,
            "priority": int(priority),
            "requested_by": requested_by,
            "download_requested": bool(download_requested),
            "generation": generation,
            "sequence": sequence,
            "retry_count": (
                0
                if requested_by == "manual"
                else int(previous.get("retry_count") or 0)
            ),
            "row_count": int(previous.get("row_count") or 0),
            "row_count_before": row_count_before,
            "expected_bar_count": expected_bar_count,
            "error": "",
            "retry_at": 0,
            "retry_at_epoch": 0,
            "retryable": True,
            "created_at": previous.get("created_at") or intraday_backfill_now_text(),
            "updated_at": intraday_backfill_now_text(),
        }
        INTRADAY_ASYNC_REFRESH_STATE[cache_key] = state
        INTRADAY_BACKFILL_QUEUE.put((int(priority), sequence, cache_key, generation))
    persist_intraday_backfill_state()
    return {**intraday_backfill_status_for_key(cache_key), "deduplicated": False}


def next_intraday_backfill_job(
    timeout: float = 0.5,
) -> tuple[str, int, dict[str, Any]] | None:
    deadline = time.monotonic() + max(0.0, timeout)
    while not INTRADAY_BACKFILL_STOP_EVENT.is_set():
        remaining = max(0.0, deadline - time.monotonic())
        try:
            _priority, _sequence, cache_key, generation = (
                INTRADAY_BACKFILL_QUEUE.get(timeout=remaining)
            )
        except queue.Empty:
            return None
        with INTRADAY_ASYNC_REFRESH_LOCK:
            state = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
        if (
            int(state.get("generation") or 0) == generation
            and str(state.get("status") or "") == "queued"
        ):
            return cache_key, generation, state
        INTRADAY_BACKFILL_QUEUE.task_done()
        if time.monotonic() >= deadline:
            return None
    return None


def finish_intraday_backfill_job(
    cache_key: str,
    generation: int,
    status: str,
    rows: list[dict[str, Any]],
    *,
    error: str = "",
    retry_seconds: float = 0,
    download_attempted: bool = False,
    download_succeeded: bool = False,
    wait_reason: str = "",
) -> None:
    global INTRADAY_ASYNC_ACTIVE_KEY
    now_epoch = time.time()
    with INTRADAY_ASYNC_REFRESH_LOCK:
        current = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
    retry_count = int(current.get("retry_count") or 0)
    if status in {"partial", "failed"}:
        retry_count += 1
    retryable = status not in {"ready"} and (
        status not in {"partial", "failed"}
        or retry_count < INTRADAY_BACKFILL_MAX_RETRIES
    )
    effective_retry_seconds = retry_seconds if retryable else 0
    updates = {
        "status": status,
        "active": False,
        "queued": False,
        "row_count": len(rows),
        "error": error,
        "wait_reason": wait_reason,
        "retry_at": (
            time.monotonic() + effective_retry_seconds
            if effective_retry_seconds > 0
            else 0
        ),
        "retry_at_epoch": (
            now_epoch + effective_retry_seconds
            if effective_retry_seconds > 0
            else 0
        ),
        "retryable": retryable,
        "retry_count": retry_count,
        "download_attempted": download_attempted,
        "download_succeeded": download_succeeded,
        "completed_at": (
            intraday_backfill_now_text()
            if status in {"ready", "partial", "failed"}
            else ""
        ),
    }
    update_intraday_backfill_state(cache_key, generation, **updates)
    with INTRADAY_ASYNC_REFRESH_LOCK:
        if INTRADAY_ASYNC_ACTIVE_KEY == cache_key:
            INTRADAY_ASYNC_ACTIVE_KEY = None
    persist_intraday_backfill_state()


def record_intraday_backfill_bridge_failure() -> None:
    global INTRADAY_BACKFILL_CONSECUTIVE_FAILURES
    global INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC
    INTRADAY_BACKFILL_CONSECUTIVE_FAILURES += 1
    if (
        INTRADAY_BACKFILL_CONSECUTIVE_FAILURES
        >= INTRADAY_BACKFILL_FAILURE_PAUSE_AFTER
    ):
        INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC = (
            time.monotonic() + INTRADAY_BACKFILL_FAILURE_PAUSE_SECONDS
        )


def clear_intraday_backfill_bridge_failures() -> None:
    global INTRADAY_BACKFILL_CONSECUTIVE_FAILURES
    global INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC
    INTRADAY_BACKFILL_CONSECUTIVE_FAILURES = 0
    INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC = 0


def execute_intraday_backfill_job(
    cache_key: str,
    generation: int,
    state: dict[str, Any],
) -> None:
    global INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC
    stored_code = str(state.get("code") or "")
    trading_date = str(state.get("trading_date") or "")
    download_requested = bool(state.get("download_requested"))
    existing = intraday_cache_snapshot(stored_code, trading_date)
    rows: list[dict[str, Any]] = list(existing["rows"])
    previous_close = finite_or_none(existing.get("previous_close"))
    read_error = ""
    update_intraday_backfill_state(
        cache_key,
        generation,
        status="reading_cache",
        active=True,
        queued=False,
        started_at=intraday_backfill_now_text(),
    )
    if rows and not minute_rows_need_backfill(rows, trading_date):
        clear_intraday_download_backoff(cache_key)
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "ready",
            rows,
        )
        return
    allowed, wait_reason = intraday_download_permission(trading_date)
    if (
        not allowed
        or (
            str(state.get("requested_by") or "") != "manual"
            and not intraday_automatic_window_open()
        )
    ):
        # No queued history task may touch serialized xtdata outside the
        # maintenance window, including the old cache-only automatic reader.
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "waiting_for_market_close",
            rows,
            wait_reason=(
                wait_reason if not allowed else "automatic_window_1512_1800"
            ),
        )
        return
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=INTRADAY_ASYNC_REFRESH_TIMEOUT_SECONDS,
    )
    try:
        fetched_rows, previous_close = fetch_bridge_minute_rows(
            bridge,
            stored_code,
            trading_date,
            timeout=INTRADAY_ASYNC_REFRESH_TIMEOUT_SECONDS,
        )
        rows = merge_intraday_backfill_cache(
            stored_code,
            trading_date,
            fetched_rows,
            previous_close,
        )
    except Exception as error:
        read_error = f"cache_read:{type(error).__name__}: {error}"
        rows = list(intraday_cache_snapshot(stored_code, trading_date)["rows"])

    if rows and not minute_rows_need_backfill(rows, trading_date):
        clear_intraday_download_backoff(cache_key)
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "ready",
            rows,
        )
        return
    if not download_requested:
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "partial" if rows else "failed",
            rows,
            error=read_error or ("" if rows else "market_data_ex returned no minute rows"),
            retry_seconds=INTRADAY_ASYNC_REFRESH_RETRY_SECONDS,
        )
        return

    cooldown = max(
        0.0,
        INTRADAY_BACKFILL_PAUSED_UNTIL_MONOTONIC - time.monotonic(),
    )
    if cooldown > 0:
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "waiting_for_bridge_cooldown",
            rows,
            error="consecutive_bridge_failures",
            retry_seconds=cooldown,
            wait_reason="bridge_failure_cooldown",
        )
        return

    spacing = max(
        0.0,
        INTRADAY_BACKFILL_DOWNLOAD_SPACING_SECONDS
        - (time.monotonic() - INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC),
    )
    if spacing > 0 and INTRADAY_BACKFILL_STOP_EVENT.wait(spacing):
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "interrupted",
            rows,
            error="service_stopping",
        )
        return
    # Recheck at the last possible moment. The monitor can be restarted, or the
    # 18:00 boundary can pass, while this job is waiting behind another symbol.
    allowed, wait_reason = intraday_download_permission(trading_date)
    if not allowed:
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "waiting_for_market_close",
            rows,
            wait_reason=wait_reason,
        )
        return
    update_intraday_backfill_state(
        cache_key,
        generation,
        status="downloading",
        download_attempted=True,
    )
    row_count_before_download = len(rows)
    try:
        download_payload = bridge.download_minute_bars(
            [stored_code],
            trading_date,
            timeout=90.0,
        )
        if not isinstance(download_payload, dict):
            raise RuntimeError("Bridge下载响应不是JSON对象")
        outer_status = str(download_payload.get("status") or "").lower()
        if outer_status not in {"ok", "success"}:
            raise RuntimeError(f"Bridge返回状态：{outer_status or 'empty'}")
        per_code = download_payload.get("result")
        if not isinstance(per_code, dict) or stored_code not in per_code:
            raise RuntimeError(f"Bridge下载响应缺少{stored_code}结果")
        code_status = str(per_code.get(stored_code) or "").strip()
        if code_status.lower() not in {"ok", "success"}:
            raise RuntimeError(
                f"{stored_code}下载结果：{code_status or 'empty'}"
            )
    except Exception as error:
        record_intraday_backfill_bridge_failure()
        try:
            finish_intraday_backfill_job(
                cache_key,
                generation,
                "failed",
                rows,
                error=f"download:{type(error).__name__}: {error}",
                retry_seconds=INTRADAY_ASYNC_REFRESH_RETRY_SECONDS,
                download_attempted=True,
            )
        finally:
            INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC = time.monotonic()
        return

    verification_errors: list[str] = []
    successful_verifications = 0
    for _attempt in range(INTRADAY_BACKFILL_VERIFY_RETRIES):
        update_intraday_backfill_state(
            cache_key,
            generation,
            status="verifying",
            download_attempted=True,
            download_succeeded=True,
        )
        if INTRADAY_BACKFILL_STOP_EVENT.wait(
            INTRADAY_BACKFILL_VERIFY_WAIT_SECONDS
        ):
            break
        allowed, wait_reason = intraday_download_permission(trading_date)
        if not allowed:
            verification_errors.append(f"verify_blocked:{wait_reason}")
            break
        try:
            fetched_rows, refreshed_previous_close = fetch_bridge_minute_rows(
                bridge,
                stored_code,
                trading_date,
                timeout=INTRADAY_ASYNC_REFRESH_TIMEOUT_SECONDS,
            )
            rows = merge_intraday_backfill_cache(
                stored_code,
                trading_date,
                fetched_rows,
                refreshed_previous_close or previous_close,
            )
        except Exception as error:
            verification_errors.append(
                f"verify:{type(error).__name__}: {error}"
            )
            continue
        successful_verifications += 1
        if rows and not minute_rows_need_backfill(rows, trading_date):
            break

    incomplete = minute_rows_need_backfill(rows, trading_date)
    failure_reason = ""
    if incomplete and successful_verifications == 0:
        failure_reason = "verification_all_failed"
    elif incomplete and len(rows) <= row_count_before_download:
        failure_reason = "no_source_data" if not rows else "download_no_row_growth"
    if failure_reason == "verification_all_failed":
        record_intraday_backfill_bridge_failure()
    else:
        # A successful verify with no new rows can be legitimate for suspended,
        # delisted, or otherwise source-empty bonds and must not stop the queue.
        clear_intraday_backfill_bridge_failures()
    if failure_reason:
        verification_errors.append(failure_reason)
    if not incomplete:
        clear_intraday_download_backoff(cache_key)
    try:
        finish_intraday_backfill_job(
            cache_key,
            generation,
            "partial" if incomplete else "ready",
            rows,
            error="; ".join(verification_errors),
            retry_seconds=(INTRADAY_ASYNC_REFRESH_RETRY_SECONDS if incomplete else 0),
            download_attempted=True,
            download_succeeded=failure_reason != "verification_all_failed",
        )
    finally:
        # The next symbol waits at least one full spacing interval after this
        # task's verification/persistence completes, not after download starts.
        INTRADAY_BACKFILL_LAST_DOWNLOAD_MONOTONIC = time.monotonic()


def _refresh_current_intraday_cache(
    stored_code: str,
    trading_date: str,
) -> None:
    """Compatibility entry point for one cache-only refresh."""
    global INTRADAY_ASYNC_ACTIVE_KEY
    cache_key = intraday_backfill_cache_key(stored_code, trading_date)
    with INTRADAY_ASYNC_REFRESH_LOCK:
        state = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
        generation = int(state.get("generation") or 0) + 1
        state.update(
            {
                "key": cache_key,
                "code": stored_code,
                "trading_date": trading_date,
                "status": "reading_cache",
                "generation": generation,
                "requested_by": "automatic_read",
                "download_requested": False,
            }
        )
        INTRADAY_ASYNC_REFRESH_STATE[cache_key] = state
        INTRADAY_ASYNC_ACTIVE_KEY = cache_key
    execute_intraday_backfill_job(cache_key, generation, state)


def intraday_backfill_worker_loop() -> None:
    global INTRADAY_ASYNC_ACTIVE_KEY
    while not INTRADAY_BACKFILL_STOP_EVENT.is_set():
        job = next_intraday_backfill_job()
        if job is None:
            continue
        cache_key, generation, state = job
        with INTRADAY_ASYNC_REFRESH_LOCK:
            INTRADAY_ASYNC_ACTIVE_KEY = cache_key
        try:
            execute_intraday_backfill_job(cache_key, generation, state)
        except Exception as error:  # pragma: no cover - tested via safe helper state
            # A disk/persistence or unexpected Bridge adapter error must not kill
            # the only serialized worker. Preserve a retryable in-memory terminal
            # state even when persisting that state fails too.
            detail = f"worker:{type(error).__name__}: {error}"
            try:
                finish_intraday_backfill_job(
                    cache_key,
                    generation,
                    "failed",
                    list(intraday_cache_snapshot(
                        str(state.get("code") or ""),
                        str(state.get("trading_date") or ""),
                    )["rows"]),
                    error=detail,
                )
            except Exception as persist_error:
                with INTRADAY_ASYNC_REFRESH_LOCK:
                    current = INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {}
                    if int(current.get("generation") or 0) == generation:
                        current.update(
                            {
                                "status": "failed",
                                "active": False,
                                "queued": False,
                                "retryable": True,
                                "error": detail,
                                "updated_at": intraday_backfill_now_text(),
                            }
                        )
                        INTRADAY_ASYNC_REFRESH_STATE[cache_key] = current
                print(
                    "MiniQMT backfill worker state persistence error: "
                    f"{persist_error}",
                    flush=True,
                )
            print(f"MiniQMT backfill worker error: {error}", flush=True)
        finally:
            with INTRADAY_ASYNC_REFRESH_LOCK:
                if INTRADAY_ASYNC_ACTIVE_KEY == cache_key:
                    INTRADAY_ASYNC_ACTIVE_KEY = None
            INTRADAY_BACKFILL_QUEUE.task_done()


def schedule_current_intraday_refresh(
    stored_code: str,
    trading_date: str,
) -> dict[str, Any]:
    cache_key = intraday_backfill_cache_key(stored_code, trading_date)
    cache_snapshot = intraday_cache_snapshot(stored_code, trading_date)
    if cache_snapshot["rows"] and not minute_rows_need_backfill(
        cache_snapshot["rows"], trading_date
    ):
        return {
            "status": "ready",
            "job_status": "ready",
            "row_count": len(cache_snapshot["rows"]),
            "error": "",
            "retry_in_seconds": 0,
        }
    existing = intraday_backfill_status_for_key(cache_key)
    if (
        existing["phase"] in INTRADAY_BACKFILL_WORKING_STATUSES
        or existing["retry_in_seconds"] > 0
    ):
        return intraday_async_refresh_status(cache_key)
    existing_requested_by = str(existing.get("requested_by") or "")
    preserve_download = bool(existing.get("download_requested"))
    requested_by = (
        existing_requested_by
        if preserve_download and existing_requested_by
        else "automatic_read"
    )
    enqueue_intraday_backfill(
        stored_code,
        trading_date,
        requested_by=requested_by,
        download_requested=preserve_download,
        priority=(
            INTRADAY_BACKFILL_AUTOMATIC_PRIORITY
            if preserve_download
            else INTRADAY_BACKFILL_READ_PRIORITY
        ),
    )
    return intraday_async_refresh_status(cache_key)


def request_intraday_backfill(body: dict[str, Any]) -> dict[str, Any]:
    code = normalize_code(str(body.get("code") or ""))
    stored_code = monitor_code(code)
    trading_date = str(
        body.get("trading_date") or body.get("date") or ""
    ).strip()
    if trading_date and not re.fullmatch(r"\d{8}", trading_date):
        raise ValueError("补齐日期必须为YYYYMMDD")
    if not trading_date:
        trading_date = database_for_date().stem
    database_for_date(trading_date)
    health = api_health()
    warmup = (health.get("status") or {}).get("indicator_warmup") or {}
    excluded_codes = {
        str(item).upper()
        for item in warmup.get("history_repair_excluded_code_sample") or []
        if isinstance(item, str)
    }
    if (
        trading_date == str(health.get("calendar_date") or "")
        and stored_code in excluded_codes
    ):
        reason = str(
            (warmup.get("history_repair_exclusion_reasons") or {}).get(
                stored_code
            )
            or "qmt_non_trading"
        )
        state = {
            "status": "not_applicable",
            "phase": "not_applicable",
            "active": False,
            "queued": False,
            "job_id": "",
            "code": stored_code.split(".")[0],
            "monitor_code": stored_code,
            "date": trading_date,
            "trading_date": trading_date,
            "wait_reason": reason,
            "error": "MiniQMT 标记为非交易标的，无盘中分钟源",
            "poll_after_seconds": 0,
        }
        return clean_json(
            {
                "ok": True,
                "accepted": False,
                "mode": "non_trading_source_unavailable",
                **state,
                "job": state,
            }
        )
    state = enqueue_intraday_backfill(
        stored_code,
        trading_date,
        requested_by="manual",
        download_requested=True,
        priority=INTRADAY_BACKFILL_MANUAL_PRIORITY,
    )
    return clean_json(
        {
            "ok": True,
            "accepted": True,
            "mode": "maintenance_market_data_backfill",
            **state,
            "code": code,
            "monitor_code": stored_code,
            "date": trading_date,
            "trading_date": trading_date,
            "job": state,
        }
    )


def intraday_backfill_status_payload(
    code_input: str = "",
    trading_date_input: str = "",
    job_id_input: str = "",
) -> dict[str, Any]:
    load_intraday_backfill_state()
    if job_id_input:
        cache_key = urllib.parse.unquote(str(job_id_input or "")).strip()
        match = re.fullmatch(r"((?:110|111|113|118|123|127|128)\d{3}\.(?:SH|SZ)):(\d{8})", cache_key)
        if not match:
            raise ValueError("补齐任务ID无效")
        stored_code, trading_date = match.groups()
        code = stored_code.split(".")[0]
    elif code_input:
        code = normalize_code(code_input)
        stored_code = monitor_code(code)
        trading_date = str(trading_date_input or "").strip()
        if trading_date and not re.fullmatch(r"\d{8}", trading_date):
            raise ValueError("补齐日期必须为YYYYMMDD")
        if not trading_date:
            trading_date = database_for_date().stem
        cache_key = intraday_backfill_cache_key(stored_code, trading_date)
    else:
        cache_key = ""
    if cache_key:
        state = intraday_backfill_status_for_key(cache_key)
        return clean_json(
            {
                "ok": True,
                "mode": "read_only_status",
                **state,
                "code": code,
                "monitor_code": stored_code,
                "date": trading_date,
                "trading_date": trading_date,
                "job": state,
            }
        )
    with INTRADAY_ASYNC_REFRESH_LOCK:
        states = [
            intraday_backfill_status_for_key(key)
            for key in INTRADAY_ASYNC_REFRESH_STATE
        ]
        active_key = INTRADAY_ASYNC_ACTIVE_KEY
    return clean_json(
        {
            "ok": True,
            "mode": "read_only_status",
            "active_key": active_key,
            "queued": sum(1 for state in states if state["status"] == "queued"),
            "waiting_for_market_close": sum(
                1
                for state in states
                if state["phase"] == "waiting_for_market_close"
            ),
            "postclose_scanned_date": INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE,
            "jobs": states,
        }
    )


def board_market_codes() -> set[str]:
    payload = read_json(BOARD_STATE_PATH)
    codes: set[str] = set()
    for sector in payload.get("sectors") or []:
        if not isinstance(sector, dict):
            continue
        for stock in sector.get("stocks") or []:
            if not isinstance(stock, dict):
                continue
            secid = str(stock.get("secid") or "").strip()
            match = re.fullmatch(r"([01])\.(\d{6})", secid)
            if not match:
                continue
            market, code = match.groups()
            # Eastmoney uses market=0 for both Shenzhen and Beijing symbols.
            # QMT needs .BJ for the latter, so keep this maintenance path to
            # unambiguous Shanghai/Shenzhen codes only.
            if code.startswith(("8", "9")):
                continue
            codes.add(f"{code}.{'SH' if market == '1' else 'SZ'}")
    return codes


def postclose_intraday_universe(
    database: Path,
    trading_date: str,
) -> tuple[set[str], str]:
    sqlite_codes: set[str] = set()
    monitor_codes: set[str] = set()
    with connect_read_only(database) as connection:
        sqlite_codes = {
            str(row["code"])
            for row in connection.execute(
                """
                SELECT DISTINCT code
                FROM minute_observations
                WHERE trading_date=?
                """,
                (trading_date,),
            )
            if MARKET_CODE_PATTERN.fullmatch(str(row["code"]))
        }
        try:
            event_codes = {
                str(row["code"])
                for row in connection.execute(
                    """
                    SELECT DISTINCT code
                    FROM qmt_events
                    WHERE trading_date=?
                    """,
                    (trading_date,),
                )
                if MARKET_CODE_PATTERN.fullmatch(str(row["code"]))
            }
        except sqlite3.OperationalError:
            event_codes = set()
        sqlite_codes.update(event_codes)
        try:
            meta_row = connection.execute(
                "SELECT value FROM meta WHERE key='codes'"
            ).fetchone()
        except sqlite3.OperationalError:
            meta_row = None
        if meta_row:
            try:
                raw_codes = json.loads(str(meta_row["value"] or "[]"))
            except json.JSONDecodeError:
                raw_codes = []
            monitor_codes = {
                str(code)
                for code in raw_codes
                if MARKET_CODE_PATTERN.fullmatch(str(code))
            }
    board_codes = board_market_codes()
    if monitor_codes:
        source = (
            "sqlite_meta_codes+board_state"
            if board_codes
            else "sqlite_meta_codes"
        )
        return sqlite_codes | monitor_codes | board_codes, source

    with INTRADAY_ASYNC_REFRESH_LOCK:
        if INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE == trading_date:
            persisted_codes = set(INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES)
        else:
            persisted_codes = set()
    if persisted_codes:
        source = (
            "persisted_universe+board_state"
            if board_codes
            else "persisted_universe"
        )
        return sqlite_codes | persisted_codes | board_codes, source

    allowed, reason = intraday_download_permission(trading_date)
    if not allowed:
        raise LookupError(f"postclose_universe_blocked:{reason}")
    # Legacy monitor databases may not have meta.codes. One read-only bond-list
    # request supplies the missing zero-row symbols; it is never called per code.
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=10.0,
    )
    bridge_codes = {
        str(code)
        for code in bridge.convertible_bonds()
        if MARKET_CODE_PATTERN.fullmatch(str(code))
    }
    if not bridge_codes:
        raise LookupError("postclose_universe_bridge_returned_empty")
    source = (
        "bridge_convertible_bonds+board_state"
        if board_codes
        else "bridge_convertible_bonds"
    )
    return sqlite_codes | bridge_codes | board_codes, source


def scan_postclose_intraday_gaps(
    now: datetime | None = None,
) -> dict[str, Any]:
    global INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE
    global INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE
    global INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES
    current = china_now(now)
    calendar_date = current.strftime("%Y%m%d")
    clock = current.strftime("%H:%M:%S")
    if (
        current.weekday() >= 5
        or not (
            INTRADAY_BACKFILL_AUTOMATIC_START
            <= clock
            <= INTRADAY_BACKFILL_AUTOMATIC_END
        )
    ):
        return {"scheduled": False, "reason": "outside_postclose_window"}
    if intraday_monitor_active(current):
        return {"scheduled": False, "reason": "monitor_still_active"}
    database = DATA_ROOT / f"{calendar_date}.sqlite3"
    if not database.exists():
        return {"scheduled": False, "reason": "today_database_missing"}
    try:
        universe, universe_source = postclose_intraday_universe(
            database,
            calendar_date,
        )
    except Exception as error:
        return {
            "scheduled": False,
            "reason": "postclose_universe_unavailable",
            "error": f"{type(error).__name__}: {error}",
        }
    with INTRADAY_ASYNC_REFRESH_LOCK:
        already_covered = bool(
            INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE == calendar_date
            and INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE == calendar_date
            and universe.issubset(
                INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES
            )
        )
    if already_covered:
        return {"scheduled": False, "reason": "already_scanned"}

    grouped: dict[str, list[Any]] = {code: [] for code in universe}
    with connect_read_only(database) as connection:
        for row in connection.execute(
            """
            SELECT code,minute_ms,minute_time,open,high,low,close,amount
            FROM minute_observations
            WHERE trading_date=?
            ORDER BY code,minute_ms
            """,
            (calendar_date,),
        ):
            stored_code = str(row["code"])
            if MARKET_CODE_PATTERN.fullmatch(stored_code):
                grouped.setdefault(stored_code, []).append(row)
    missing_codes: list[str] = []
    for code, rows in grouped.items():
        cached_rows = intraday_cache_snapshot(code, calendar_date)["rows"]
        combined_rows = merge_minute_rows(
            [dict(row) for row in rows],
            list(cached_rows),
        )
        if minute_rows_need_backfill(combined_rows, calendar_date):
            missing_codes.append(code)
    scheduled_codes: list[str] = []
    preserved_codes: list[str] = []
    for stored_code in missing_codes:
        cache_key = intraday_backfill_cache_key(stored_code, calendar_date)
        with INTRADAY_ASYNC_REFRESH_LOCK:
            existing = dict(INTRADAY_ASYNC_REFRESH_STATE.get(cache_key) or {})
        if existing:
            existing_requested_by = str(existing.get("requested_by") or "")
            existing_status = str(existing.get("status") or "")
            if (
                existing_requested_by == "automatic_read"
                and existing_status != "ready"
            ):
                result = enqueue_intraday_backfill(
                    stored_code,
                    calendar_date,
                    requested_by="postclose_automatic",
                    download_requested=True,
                    priority=INTRADAY_BACKFILL_AUTOMATIC_PRIORITY,
                    force=True,
                    expected_generation=int(existing.get("generation") or 0),
                    expected_status=existing_status,
                )
                if not result.get("deduplicated"):
                    scheduled_codes.append(stored_code)
                else:
                    preserved_codes.append(stored_code)
                continue
            # Preserve manual priority and old ready/terminal results. Waiting
            # automatic-download jobs are resumed by the normal requeue pass.
            preserved_codes.append(stored_code)
            continue
        result = enqueue_intraday_backfill(
            stored_code,
            calendar_date,
            requested_by="postclose_automatic",
            download_requested=True,
            priority=INTRADAY_BACKFILL_AUTOMATIC_PRIORITY,
        )
        if not result.get("deduplicated"):
            scheduled_codes.append(stored_code)
    with INTRADAY_ASYNC_REFRESH_LOCK:
        INTRADAY_BACKFILL_POSTCLOSE_SCANNED_DATE = calendar_date
        INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_DATE = calendar_date
        INTRADAY_BACKFILL_POSTCLOSE_UNIVERSE_CODES = set(universe)
    persist_intraday_backfill_state()
    return {
        "scheduled": True,
        "trading_date": calendar_date,
        "scanned_codes": len(grouped),
        "missing_codes": len(missing_codes),
        "scheduled_codes": len(scheduled_codes),
        "preserved_codes": len(preserved_codes),
        "universe_source": universe_source,
    }


def requeue_due_intraday_backfills(now: datetime | None = None) -> int:
    current_epoch = time.time()
    queued = 0
    with INTRADAY_ASYNC_REFRESH_LOCK:
        candidates = [dict(state) for state in INTRADAY_ASYNC_REFRESH_STATE.values()]
    for state in candidates:
        status = str(state.get("status") or "")
        requested_by = str(state.get("requested_by") or "")
        trading_date = str(state.get("trading_date") or "")
        allowed, _reason = intraday_download_permission(trading_date, now)
        if not allowed:
            continue
        if requested_by != "manual" and not intraday_automatic_window_open(now):
            continue
        retry_epoch = float(state.get("retry_at_epoch") or 0)
        if status not in {
            "waiting_for_market_close",
            "waiting_for_bridge_cooldown",
            "interrupted",
            "partial",
            "failed",
        }:
            continue
        if status in {"partial", "failed"} and not bool(
            state.get("retryable", True)
        ):
            continue
        if retry_epoch > current_epoch:
            continue
        priority = (
            INTRADAY_BACKFILL_MANUAL_PRIORITY
            if requested_by == "manual"
            else INTRADAY_BACKFILL_READ_PRIORITY
            if requested_by == "automatic_read"
            else INTRADAY_BACKFILL_AUTOMATIC_PRIORITY
        )
        result = enqueue_intraday_backfill(
            str(state.get("code") or ""),
            trading_date,
            requested_by=requested_by or "postclose_automatic",
            download_requested=bool(state.get("download_requested")),
            priority=priority,
            force=True,
            expected_generation=int(state.get("generation") or 0),
            expected_status=status,
        )
        if not result.get("stale_candidate") and not result.get("deduplicated"):
            queued += 1
    return queued


def intraday_backfill_scheduler_loop() -> None:
    while not INTRADAY_BACKFILL_STOP_EVENT.is_set():
        try:
            scan_postclose_intraday_gaps()
            requeue_due_intraday_backfills()
        except Exception as error:  # pragma: no cover - daemon safety boundary
            print(f"MiniQMT backfill scheduler error: {error}", flush=True)
        INTRADAY_BACKFILL_STOP_EVENT.wait(15.0)


def start_intraday_backfill_service() -> None:
    global INTRADAY_BACKFILL_WORKER_THREAD
    global INTRADAY_BACKFILL_SCHEDULER_THREAD
    load_intraday_backfill_state()
    INTRADAY_BACKFILL_STOP_EVENT.clear()
    if (
        INTRADAY_BACKFILL_WORKER_THREAD is None
        or not INTRADAY_BACKFILL_WORKER_THREAD.is_alive()
    ):
        INTRADAY_BACKFILL_WORKER_THREAD = threading.Thread(
            target=intraday_backfill_worker_loop,
            name="miniqmt-intraday-backfill",
            daemon=True,
        )
        INTRADAY_BACKFILL_WORKER_THREAD.start()
    if (
        INTRADAY_BACKFILL_SCHEDULER_THREAD is None
        or not INTRADAY_BACKFILL_SCHEDULER_THREAD.is_alive()
    ):
        INTRADAY_BACKFILL_SCHEDULER_THREAD = threading.Thread(
            target=intraday_backfill_scheduler_loop,
            name="miniqmt-intraday-backfill-scheduler",
            daemon=True,
        )
        INTRADAY_BACKFILL_SCHEDULER_THREAD.start()


def live_tick_minute_rows(
    stored_code: str,
    trading_date: str,
    source_name: str = "",
) -> tuple[
    list[dict[str, Any]],
    float | None,
    str,
    float,
    dict[str, Any] | None,
]:
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=DETAIL_TICK_TIMEOUT_SECONDS,
    )
    payload = bridge.get(
        "/api/market/full_tick",
        {"stocks": stored_code},
        timeout=DETAIL_TICK_TIMEOUT_SECONDS,
    )
    ticks = payload.get("data", payload) if isinstance(payload, dict) else {}
    tick = ticks.get(stored_code)
    if (
        not isinstance(tick, dict)
        or compact_date(tick.get("timetag")) != trading_date
    ):
        return [], None, "", 0, None
    rows: list[dict[str, Any]] = []
    timestamp = tick_minute_timestamp(tick)
    close = finite_or_none(tick.get("lastPrice"))
    if timestamp > 0 and close is not None and close > 0:
        moment = datetime.fromtimestamp(timestamp / 1000)
        rows.append(
            {
                "minute_ms": timestamp,
                "minute_time": moment.strftime("%Y-%m-%d %H:%M:%S"),
                "open": close,
                "high": close,
                "low": close,
                "close": close,
                # full_tick.amount is the session-to-date cumulative amount,
                # not the amount of this one-minute bucket.  A sparse in-memory
                # tick cache cannot safely derive the bucket amount because its
                # previous sample may be many minutes old.  The merge below
                # keeps the authoritative SQLite/market_data_ex minute amount.
                "amount": 0.0,
            }
        )
    names = resolve_active_index_names(
        bridge,
        [stored_code],
        {stored_code: source_name},
    )
    return (
        rows,
        finite_or_none(tick.get("lastClose")),
        names.get(stored_code) or "",
        finite_or_none(tick.get("amount")) or 0,
        tick,
    )


def minute_row_clock(row: Any) -> str:
    value = str(row["minute_time"] or "")
    match = re.search(r"(\d{2}:\d{2})", value)
    return match.group(1) if match else ""


def expected_minute_count(trading_date: str) -> int:
    now = datetime.now()
    if trading_date < now.strftime("%Y%m%d"):
        return 241
    if trading_date > now.strftime("%Y%m%d") or now.weekday() >= 5:
        return 0
    clock = now.time()
    morning_open = datetime.strptime("09:30", "%H:%M").time()
    morning_close = datetime.strptime("11:30", "%H:%M").time()
    afternoon_open = datetime.strptime("13:00", "%H:%M").time()
    afternoon_close = datetime.strptime("15:00", "%H:%M").time()
    if clock < morning_open:
        return 0
    if clock <= morning_close:
        return int(
            (
                datetime.combine(now.date(), clock)
                - datetime.combine(now.date(), morning_open)
            ).total_seconds()
            // 60
        ) + 1
    if clock < afternoon_open:
        return 121
    if clock <= afternoon_close:
        return 121 + int(
            (
                datetime.combine(now.date(), clock)
                - datetime.combine(now.date(), afternoon_open)
            ).total_seconds()
            // 60
        )
    return 241


def minute_rows_need_backfill(rows: list[Any], trading_date: str) -> bool:
    if not rows:
        return True
    clocks = [minute_row_clock(row) for row in rows]
    clocks = [clock for clock in clocks if clock]
    if not clocks:
        return True
    if min(clocks) > "09:31":
        return True
    elapsed_minutes = sorted(
        {
            elapsed_market_minutes_from_clock(clock)
            for clock in clocks
            if elapsed_market_minutes_from_clock(clock) > 0
        }
    )
    if any(
        current - previous > 1
        for previous, current in zip(elapsed_minutes, elapsed_minutes[1:])
    ):
        return True
    expected = expected_minute_count(trading_date)
    return expected > 0 and len(set(clocks)) < max(1, expected - 2)


def merge_minute_rows(*sources: list[Any]) -> list[Any]:
    by_timestamp: dict[int, Any] = {}
    for source in sources:
        for row in source:
            timestamp = int(row["minute_ms"] or 0)
            if timestamp > 0:
                by_timestamp[timestamp] = row
    return [by_timestamp[timestamp] for timestamp in sorted(by_timestamp)]


def merge_bond_minute_rows(
    local_rows: list[Any],
    historical_rows: list[Any],
    live_rows: list[Any],
) -> list[Any]:
    """Fill historical gaps, prefer monitor bars, then overlay only live price.

    SQLite minute observations and market_data_ex rows contain per-minute
    amounts.  full_tick contains a cumulative session amount, so a live row is
    never allowed to replace a trusted bucket amount.  When the monitor has not
    written the new minute yet, the provisional live row starts at zero rather
    than displaying the whole cumulative amount as one minute.
    """

    by_timestamp: dict[int, dict[str, Any]] = {}
    # Bridge history only fills holes; the local monitor remains authoritative
    # for timestamps present in both sources, especially the unfinished minute.
    for source in (historical_rows, local_rows):
        for row in source:
            timestamp = int(row["minute_ms"] or 0)
            if timestamp > 0:
                by_timestamp[timestamp] = dict(row)

    for row in live_rows:
        timestamp = int(row["minute_ms"] or 0)
        if timestamp <= 0:
            continue
        live = dict(row)
        existing = by_timestamp.get(timestamp)
        if existing is None:
            live["amount"] = 0.0
            by_timestamp[timestamp] = live
            continue

        close = finite_or_none(live.get("close"))
        if close is None or close <= 0:
            continue
        merged = dict(existing)
        merged["close"] = close
        merged["high"] = max(
            finite_or_none(existing.get("high")) or close,
            finite_or_none(live.get("high")) or close,
            close,
        )
        merged["low"] = min(
            finite_or_none(existing.get("low")) or close,
            finite_or_none(live.get("low")) or close,
            close,
        )
        # Intentionally retain existing open, amount, and volume.
        by_timestamp[timestamp] = merged

    return [by_timestamp[timestamp] for timestamp in sorted(by_timestamp)]


def optional_row_value(row: Any, key: str) -> Any:
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


def bond_payload(
    code_input: str,
    date_input: str = "",
    fast: bool = False,
) -> dict[str, Any]:
    code = normalize_code(code_input)
    stored_code = monitor_code(code)
    if date_input and not re.fullmatch(r"\d{8}", date_input):
        raise ValueError("历史分时日期必须为YYYYMMDD")
    fast_mode = bool(fast and not date_input)
    database = None
    trading_date = date_input
    minute_rows: list[Any] = []
    event_rows: list[Any] = []
    name = ""
    minute_source = "本地监控数据库"
    previous_close = None
    previous_close_date = None
    live_cumulative_amount = 0.0
    history_cache_age_seconds = None
    history_backfill_status: dict[str, Any] = {"status": "not_needed"}

    try:
        database = database_for_date(date_input)
        trading_date = database.stem
        with connect_read_only(database) as connection:
            minute_rows = connection.execute(
                """
                SELECT minute_ms,minute_time,open,high,low,close,amount
                FROM minute_observations
                WHERE trading_date=? AND code=?
                ORDER BY minute_ms
                """,
                (trading_date, stored_code),
            ).fetchall()
            event_rows = connection.execute(
                """
                SELECT id,event_time_ms,event_time,event_type,direction,price,tier,
                       speed_1m,speed_3m,speed_5m,amount_1m,confidence,score,
                       details_json
                FROM qmt_events
                WHERE trading_date=? AND code=?
                ORDER BY event_time_ms,id
                """,
                (trading_date, stored_code),
            ).fetchall()
            name = resolve_name(connection, trading_date, stored_code)
    except FileNotFoundError:
        if not date_input:
            raise

    local_rows = list(minute_rows)
    local_needs_backfill = minute_rows_need_backfill(local_rows, trading_date)
    downloaded_rows: list[dict[str, Any]] = []
    downloaded_previous_close = None
    if date_input:
        try:
            (
                downloaded_rows,
                downloaded_previous_close,
                previous_close_date,
                _,
            ) = historical_minute_rows(stored_code, trading_date)
        except Exception:
            downloaded_rows = []
        history_backfill_status = {"status": "cache_only"}
    elif local_needs_backfill:
        # The current-day detail path is stale-while-revalidate: return local
        # SQLite data immediately and only merge a previously populated Bridge
        # cache. A single background GET fills the early gap for a later poll.
        cache_snapshot = intraday_cache_snapshot(stored_code, trading_date)
        downloaded_rows = list(cache_snapshot["rows"])
        downloaded_previous_close = cache_snapshot["previous_close"]
        previous_close_date = cache_snapshot["previous_close_date"]
        history_cache_age_seconds = cache_snapshot["age_seconds"]
    live_rows: list[dict[str, Any]] = []
    live_previous_close = None
    live_name = ""
    live_tick: dict[str, Any] | None = None
    live_tick_error = ""
    if not date_input and not fast_mode:
        try:
            (
                live_rows,
                live_previous_close,
                live_name,
                live_cumulative_amount,
                live_tick,
            ) = live_tick_minute_rows(stored_code, trading_date, name)
        except Exception as error:
            live_tick_error = f"{type(error).__name__}: {error}"
    minute_rows = merge_bond_minute_rows(local_rows, downloaded_rows, live_rows)
    previous_close = live_previous_close or downloaded_previous_close
    if live_name:
        name = live_name
    source_parts = []
    if local_rows:
        source_parts.append("本地监控")
    if downloaded_rows:
        source_parts.append("MiniQMT 1m补齐" if date_input else "MiniQMT 1m缓存")
    if live_rows:
        source_parts.append("实时快照")
    if source_parts:
        minute_source = " + ".join(source_parts)

    # Read the monitor's exclusion state before the no-row guard.  A stopped
    # or non-public instrument can legitimately have no current-day rows; it
    # should produce a stable explanatory payload instead of a 404 that makes
    # the panel retry and flash forever.
    health = api_health()
    monitor_history_repair = (
        (health.get("status") or {})
        .get("indicator_warmup", {})
        .get("history_repair", {})
    )
    monitor_warmup = (health.get("status") or {}).get("indicator_warmup", {})
    monitor_excluded_codes = {
        str(item).upper()
        for item in (
            list(monitor_warmup.get("history_repair_excluded_code_sample") or [])
            + list((monitor_warmup.get("history_repair_exclusion_reasons") or {}).keys())
        )
        if isinstance(item, str)
    }
    current_day_source_unavailable = bool(
        not date_input and stored_code in monitor_excluded_codes
    )
    exclusion_reasons = monitor_warmup.get(
        "history_repair_exclusion_reasons"
    ) or {}
    source_unavailable_reason = str(
        exclusion_reasons.get(stored_code) or "qmt_non_trading"
    )
    monitor_repair_enabled = bool(
        not date_input
        and monitor_history_repair.get("cache_refresh_enabled")
        and monitor_history_repair.get("download_enabled")
    )
    history_gap_remaining = minute_rows_need_backfill(minute_rows, trading_date)
    history_required = bool(
        history_gap_remaining and not current_day_source_unavailable
    )
    monitor_priority_requested = bool(
        monitor_repair_enabled
        and history_required
        and request_monitor_history_repair_priority(
            stored_code,
            trading_date,
        )
    )
    if not minute_rows:
        if current_day_source_unavailable:
            database_updated_at = (
                datetime.fromtimestamp(database.stat().st_mtime).isoformat(
                    timespec="seconds"
                )
                if database is not None
                else datetime.now().isoformat(timespec="seconds")
            )
            available_dates = [path.stem for path in available_databases()]
            if trading_date not in available_dates:
                available_dates.insert(0, trading_date)
            return clean_json(
                {
                    "ok": True,
                    "mode": "read_only",
                    "fast_preview": fast_mode,
                    "formula_source": str(MONITOR_ROOT / "shortline_monitor.py"),
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                    "database_updated_at": database_updated_at,
                    "code": code,
                    "monitor_code": stored_code,
                    "name": name or code,
                    "tags": bond_tags(stored_code),
                    "source": "MiniQMT 无分钟源",
                    "history_backfill": {
                        "status": "not_applicable",
                        "asynchronous": True,
                        "required": False,
                        "local_gap_detected": True,
                        "source_unavailable": True,
                        "source_unavailable_reason": source_unavailable_reason,
                        "cached_bar_count": 0,
                        "cache_age_seconds": None,
                        "retry_in_seconds": None,
                        "wait_reason": source_unavailable_reason,
                        "retry_count": 0,
                        "error": "MiniQMT 当前未提供该标的盘中分钟数据",
                        "monitor_priority_requested": False,
                        "monitor_repair_enabled": monitor_repair_enabled,
                    },
                    "trading_date": trading_date,
                    "available_dates": available_dates,
                    "bar_count": 0,
                    "complete_session": False,
                    "full_session": False,
                    "intraday_average_quality": "unavailable_without_minute_source",
                    "volume_ratio_quality": "unavailable_without_live_qmt_baseline",
                    "first_price": None,
                    "previous_close": None,
                    "previous_close_date": None,
                    "latest_price": None,
                    "daily_return": None,
                    "volume_ratio": None,
                    "support_counts": {
                        "purple": 0,
                        "purple_break": 0,
                        "intraday_average": 0,
                        "total": 0,
                    },
                    "purple_break_definition": {
                        "close_below_tolerance_pct": 0.1,
                        "confirm_bars": 2,
                        "last_break_minute_ms": None,
                        "quality": "暂无分钟数据，无法计算指标",
                    },
                    "change_from_first": None,
                    "total_amount": 0,
                    "latest_minute": None,
                    "realtime": {
                        "monitor_alive": bool(health.get("monitor_alive")),
                        "is_latest_trading_date": (
                            trading_date == health.get("latest_trading_date")
                        ),
                        "calendar_date": health.get("calendar_date"),
                        "is_today": trading_date == health.get("calendar_date"),
                        "data_is_stale": trading_date != health.get("calendar_date"),
                        "auto_follow_latest": True,
                        "refresh_interval_seconds": 2,
                        "live_tick_error": "该标的无可用盘中分钟源",
                        "live_tick_skipped": True,
                    },
                    "rows": [],
                    "events": [],
                }
            )
        raise LookupError(f"{code} 在 {trading_date} 没有分钟数据")

    minutes = [
        MONITOR.MinuteBucket(
            minute_ms=int(row["minute_ms"]),
            amount=float(row["amount"]),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
        )
        for row in minute_rows
    ]
    indicators = MONITOR.compute_indicator_series(minutes)
    try:
        if date_input:
            volume_ratio, average5_volume = historical_bond_volume_ratio(
                stored_code,
                trading_date,
            )
        else:
            volume_ratio, average5_volume = bond_volume_ratio_from_tick(
                stored_code,
                trading_date,
                live_tick,
            )
    except Exception:
        volume_ratio = None
        average5_volume = None

    rows: list[dict[str, Any]] = []
    cumulative_amount = 0.0
    cumulative_estimated_units = 0.0
    cumulative_qmt_volume = 0.0
    has_qmt_volume = any(
        (finite_or_none(optional_row_value(row, "volume")) or 0) > 0
        for row in minute_rows
    )
    for index, row in enumerate(minute_rows):
        amount = float(row["amount"])
        cumulative_amount += amount
        close = float(row["close"])
        if amount > 0 and close > 0:
            cumulative_estimated_units += amount / close
        cumulative_qmt_volume += (
            finite_or_none(optional_row_value(row, "volume")) or 0
        )
        intraday_average = (
            cumulative_amount / cumulative_estimated_units
            if cumulative_estimated_units > 0
            else close
        )
        elapsed_minutes = elapsed_market_minutes_from_clock(row["minute_time"])
        estimated_qmt_volume = (
            cumulative_qmt_volume
            if has_qmt_volume
            else cumulative_estimated_units / MONITOR.CB_VOLUME_MULTIPLIER
        )
        minute_volume_ratio = (
            estimated_qmt_volume
            / elapsed_minutes
            / (average5_volume / 240)
            if average5_volume
            and average5_volume > 0
            and elapsed_minutes > 0
            else None
        )
        visible = indicators["visible_funds"][index]
        rows.append(
            {
                "minute_ms": int(row["minute_ms"]),
                "time": str(row["minute_time"])[11:16],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "amount": amount,
                "cumulative_amount": cumulative_amount,
                "volume_ratio": minute_volume_ratio,
                "intraday_average": intraday_average,
                "purple": indicators["purple"][index],
                "purple_ma27": indicators["purple_ma27"][index],
                "purple_rising": (
                    indicators["purple"][index]
                    > indicators["purple_ma27"][index]
                ),
                "dark_state": (
                    "inflow" if indicators["sy02"][index] >= 0 else "outflow"
                ),
                "dark_sy02": indicators["sy02"][index],
                "dark_buy": indicators["dark_buy"][index],
                "dark_sell": indicators["dark_sell"][index],
                "dif": indicators["dif"][index],
                "dea": indicators["dea"][index],
                "macd": indicators["macd"][index],
                "visible_funds": visible,
                "visible_funds_aa": visible + 1,
            }
        )

    latest_estimated_volume_ratio = finite_or_none(rows[-1].get("volume_ratio"))
    if (
        volume_ratio is not None
        and latest_estimated_volume_ratio is not None
        and latest_estimated_volume_ratio > 0
    ):
        volume_ratio_scale = volume_ratio / latest_estimated_volume_ratio
        for row in rows:
            value = finite_or_none(row.get("volume_ratio"))
            row["volume_ratio"] = (
                value * volume_ratio_scale
                if value is not None
                else None
            )

    support_minutes = minutes
    current_minute_ms = int(
        datetime.now().replace(second=0, microsecond=0).timestamp() * 1000
    )
    if support_minutes and support_minutes[-1].minute_ms == current_minute_ms:
        support_minutes = support_minutes[:-1]
    support_series = (
        MONITOR.compute_indicator_series(support_minutes)
        if support_minutes
        else None
    )
    support_counts = MONITOR.compute_pullback_support_counts(
        support_minutes,
        support_series,
    )
    purple_break_stats = compute_purple_break_stats(
        support_minutes,
        support_series,
    )

    events: list[dict[str, Any]] = []
    for event in event_rows:
        try:
            details = json.loads(event["details_json"] or "{}")
        except json.JSONDecodeError:
            details = {}
        events.append(
            {
                "id": int(event["id"]),
                "event_time_ms": int(event["event_time_ms"]),
                "event_time": str(event["event_time"]),
                "event_type": str(event["event_type"]),
                "direction": str(event["direction"]),
                "price": float(event["price"]),
                "tier": str(event["tier"]),
                "speed_1m": finite_or_none(event["speed_1m"]),
                "speed_3m": finite_or_none(event["speed_3m"]),
                "speed_5m": finite_or_none(event["speed_5m"]),
                "amount_1m": finite_or_none(event["amount_1m"]),
                "confidence": str(event["confidence"]),
                "score": float(event["score"]),
                "details": details,
            }
        )

    first = rows[0]
    latest = rows[-1]
    if previous_close is None:
        previous_close, previous_close_date = previous_close_for_date(
            trading_date,
            stored_code,
        )
    daily_return = (
        (latest["close"] / previous_close - 1) * 100
        if previous_close and previous_close > 0
        else None
    )
    if fast_mode:
        history_backfill_status = {
            "status": (
                "not_applicable"
                if current_day_source_unavailable
                else "deferred" if history_gap_remaining else "ready"
            )
        }
    elif not date_input:
        if current_day_source_unavailable:
            history_backfill_status = {
                "status": "not_applicable",
                "wait_reason": source_unavailable_reason,
            }
        elif not local_needs_backfill or not history_gap_remaining:
            history_backfill_status = {
                "status": "not_needed" if not local_needs_backfill else "ready"
            }
        elif monitor_repair_enabled:
            history_backfill_status = {
                "status": "deferred",
                "wait_reason": "monitor_targeted_repair",
                "retry_in_seconds": 5,
            }
        else:
            history_backfill_status = schedule_current_intraday_refresh(
                stored_code,
                trading_date,
            )
            if history_backfill_status.get("status") == "ready":
                # The worker may finish before this response is serialized, but
                # its rows were not part of this payload. Ask the client for one
                # cheap follow-up so the completed cache is actually merged.
                history_backfill_status = {
                    **history_backfill_status,
                    "status": "pending",
                }
    history_backfill = {
        "status": str(history_backfill_status.get("status") or "idle"),
        "asynchronous": not bool(date_input),
        "required": history_required,
        "local_gap_detected": bool(local_needs_backfill),
        "source_unavailable": current_day_source_unavailable,
        "source_unavailable_reason": (
            source_unavailable_reason if current_day_source_unavailable else ""
        ),
        "cached_bar_count": len(downloaded_rows),
        "cache_age_seconds": history_cache_age_seconds,
        "retry_in_seconds": finite_or_none(
            history_backfill_status.get("retry_in_seconds")
        ),
        "wait_reason": str(history_backfill_status.get("wait_reason") or ""),
        "retry_count": int(history_backfill_status.get("retry_count") or 0),
        "error": str(history_backfill_status.get("error") or ""),
        "monitor_priority_requested": monitor_priority_requested,
        # The live monitor owns the serialized Bridge repair worker.  Expose
        # its capability so the panel can describe an active intraday repair
        # without creating a second dashboard-side queue.
        "monitor_repair_enabled": monitor_repair_enabled,
    }
    database_updated_at = (
        datetime.fromtimestamp(database.stat().st_mtime).isoformat(timespec="seconds")
        if database is not None
        else datetime.now().isoformat(timespec="seconds")
    )
    available_dates = [path.stem for path in available_databases()]
    if trading_date not in available_dates:
        available_dates.insert(0, trading_date)
    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "fast_preview": fast_mode,
            "formula_source": str(MONITOR_ROOT / "shortline_monitor.py"),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "database_updated_at": database_updated_at,
            "code": code,
            "monitor_code": stored_code,
            "name": name,
            "tags": bond_tags(stored_code),
            "source": minute_source,
            "history_backfill": history_backfill,
            "trading_date": trading_date,
            "available_dates": available_dates,
            "bar_count": len(rows),
            "complete_session": len(rows) >= 240,
            "full_session": len(rows) >= 241,
            "intraday_average_quality": "estimated_from_minute_amount_and_close",
            "volume_ratio_quality": (
                "historical_qmt_minute_volume_vs_prior_5_day_average"
                if date_input and volume_ratio is not None and has_qmt_volume
                else "estimated_intraday_path_anchored_to_live_qmt"
                if volume_ratio is not None
                else "unavailable_without_live_qmt_baseline"
            ),
            "first_price": first["open"],
            "previous_close": previous_close,
            "previous_close_date": previous_close_date,
            "latest_price": latest["close"],
            "daily_return": daily_return,
            "volume_ratio": volume_ratio,
            "support_counts": {
                "purple": support_counts["purple_support_count"],
                "purple_break": purple_break_stats["count"],
                "intraday_average": support_counts[
                    "intraday_average_support_count"
                ],
                "total": support_counts["support_confirmation_count"],
            },
            "purple_break_definition": {
                "close_below_tolerance_pct": purple_break_stats[
                    "tolerance_pct"
                ],
                "confirm_bars": purple_break_stats["confirm_bars"],
                "last_break_minute_ms": purple_break_stats["last_ms"] or None,
                "quality": "连续2根已完成1分钟K线收盘低于紫线0.1%，计为1次有效跌破；重新收回紫线后才可再次计数",
            },
            "change_from_first": (
                (latest["close"] / first["open"] - 1) * 100
                if first["open"]
                else None
            ),
            "total_amount": max(cumulative_amount, live_cumulative_amount),
            "latest_minute": latest["time"],
            "realtime": {
                "monitor_alive": bool(health["monitor_alive"]),
                "is_latest_trading_date": (
                    trading_date == health["latest_trading_date"]
                ),
                "calendar_date": health["calendar_date"],
                "is_today": trading_date == health["calendar_date"],
                "data_is_stale": trading_date != health["calendar_date"],
                "auto_follow_latest": not bool(date_input),
                "refresh_interval_seconds": 2,
                "live_tick_error": live_tick_error,
                "live_tick_skipped": fast_mode,
            },
            "rows": rows,
            "events": events,
        }
    )


def events_payload(
    scope: str = "focus",
    after_id: int = 0,
    limit: int = 80,
    codes_input: str = "",
    event_types_input: str = "",
    min_daily_amount_input: str = "",
    min_daily_amplitude_input: str = "",
    cursor_trading_date: str = "",
) -> dict[str, Any]:
    normalized_scope = scope if scope in {"focus", "all"} else "focus"
    requested_after_id = max(0, int(after_id))
    safe_limit = min(200, max(1, int(limit)))
    try:
        min_daily_amount = max(0.0, float(min_daily_amount_input or 0))
    except (TypeError, ValueError):
        min_daily_amount = 0.0
    try:
        min_daily_amplitude = max(0.0, float(min_daily_amplitude_input or 0))
    except (TypeError, ValueError):
        min_daily_amplitude = 0.0
    database = database_for_date()
    trading_date = database.stem
    with closing(connect_read_only(database)) as connection:
        current_max_id_row = connection.execute(
            "SELECT MAX(id) AS max_id FROM qmt_events WHERE trading_date=?",
            (trading_date,),
        ).fetchone()
    current_max_id = (
        int(current_max_id_row["max_id"] or 0)
        if current_max_id_row
        else 0
    )
    cursor_reset_reason = ""
    if (
        cursor_trading_date
        and cursor_trading_date != trading_date
        and requested_after_id > 0
    ):
        cursor_reset_reason = "cursor_trading_date_changed"
    elif requested_after_id > current_max_id:
        cursor_reset_reason = "after_id_ahead_of_current_day"
    effective_after_id = 0 if cursor_reset_reason else requested_after_id
    conditions = ["trading_date=?"]
    parameters: list[Any] = [trading_date]
    monitored_codes: list[str] = []
    for value in str(codes_input or "").split(","):
        if not value.strip():
            continue
        try:
            code = monitor_code(normalize_code(value))
        except ValueError:
            continue
        if code not in monitored_codes:
            monitored_codes.append(code)
    if monitored_codes:
        placeholders = ",".join("?" for _ in monitored_codes)
        conditions.append(f"code IN ({placeholders})")
        parameters.extend(monitored_codes)
    selected_event_types = list(
        dict.fromkeys(
            value
            for value in str(event_types_input or "").split(",")
            if re.fullmatch(r"[a-z0-9_]+", value)
        )
    )
    if selected_event_types:
        placeholders = ",".join("?" for _ in selected_event_types)
        conditions.append(f"event_type IN ({placeholders})")
        parameters.extend(selected_event_types)
    elif normalized_scope == "focus":
        event_types = sorted(FOCUS_EVENT_TYPES)
        placeholders = ",".join("?" for _ in event_types)
        conditions.append(f"event_type IN ({placeholders})")
        parameters.extend(event_types)
    if effective_after_id:
        conditions.append("id>?")
        parameters.append(effective_after_id)
    order = "ASC" if effective_after_id else "DESC"
    query = f"""
        SELECT id,event_time_ms,event_time,code,name,event_type,direction,price,
               tier,speed_1m,speed_3m,speed_5m,amount_1m,confidence,score,
               details_json
        FROM qmt_events
        WHERE {' AND '.join(conditions)}
        ORDER BY id {order}
        LIMIT ?
    """
    query_limit = (
        min(1000, max(safe_limit * 5, 400))
        if min_daily_amount > 0 or min_daily_amplitude > 0
        else safe_limit
    )
    parameters.append(query_limit)
    with closing(connect_read_only(database)) as connection:
        rows = connection.execute(query, parameters).fetchall()

    live_market: dict[str, dict[str, float | None]] = {}
    if (min_daily_amount > 0 or min_daily_amplitude > 0) and rows:
        event_codes = list(dict.fromkeys(str(row["code"]) for row in rows))
        now = time.monotonic()
        stale_codes = [
            code
            for code in event_codes
            if code not in EVENT_MARKET_CACHE
            or now - EVENT_MARKET_CACHE[code][0] >= EVENT_MARKET_CACHE_TTL_SECONDS
        ]
        if stale_codes:
            try:
                bridge = MONITOR.BridgeClient(
                    f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
                    timeout=15.0,
                )
                ticks = bridge.full_tick(stale_codes)
                for code in stale_codes:
                    tick = ticks.get(code)
                    if not isinstance(tick, dict):
                        continue
                    high = finite_or_none(tick.get("high"))
                    low = finite_or_none(tick.get("low"))
                    last_close = finite_or_none(tick.get("lastClose"))
                    amplitude = (
                        (high - low) / last_close
                        if high is not None
                        and low is not None
                        and last_close is not None
                        and high > 0
                        and low > 0
                        and high >= low
                        and last_close > 0
                        else None
                    )
                    EVENT_MARKET_CACHE[code] = (
                        now,
                        {
                            "daily_amount": finite_or_none(tick.get("amount")),
                            "daily_amplitude": amplitude,
                        },
                    )
            except Exception:
                pass
        live_market = {
            code: EVENT_MARKET_CACHE[code][1]
            for code in event_codes
            if code in EVENT_MARKET_CACHE
        }

    events: list[dict[str, Any]] = []
    scanned_event_ids: list[int] = []
    for row in rows:
        scanned_event_ids.append(int(row["id"]))
        try:
            details = json.loads(row["details_json"] or "{}")
        except json.JSONDecodeError:
            details = {}
        daily_amount = (
            live_market.get(str(row["code"]), {}).get("daily_amount")
            if min_daily_amount > 0
            else finite_or_none(details.get("daily_amount"))
        )
        if daily_amount is None:
            daily_amount = finite_or_none(details.get("daily_amount"))
        if min_daily_amount > 0 and (
            daily_amount is None or daily_amount < min_daily_amount
        ):
            continue
        daily_amplitude = (
            live_market.get(str(row["code"]), {}).get("daily_amplitude")
            if min_daily_amplitude > 0
            else finite_or_none(details.get("daily_amplitude"))
        )
        if daily_amplitude is None:
            daily_amplitude = finite_or_none(details.get("daily_amplitude"))
        if min_daily_amplitude > 0 and (
            daily_amplitude is None or daily_amplitude <= min_daily_amplitude
        ):
            continue
        events.append(
            {
                "id": int(row["id"]),
                "event_time_ms": int(row["event_time_ms"]),
                "event_time": str(row["event_time"]),
                "code": str(row["code"]).split(".")[0],
                "monitor_code": str(row["code"]),
                "name": str(row["name"] or ""),
                "tags": bond_tags(str(row["code"])),
                "event_type": str(row["event_type"]),
                "direction": str(row["direction"]),
                "price": float(row["price"]),
                "tier": str(row["tier"]),
                "speed_1m": finite_or_none(row["speed_1m"]),
                "speed_3m": finite_or_none(row["speed_3m"]),
                "speed_5m": finite_or_none(row["speed_5m"]),
                "amount_1m": finite_or_none(row["amount_1m"]),
                "daily_amount": daily_amount,
                "daily_amplitude": daily_amplitude,
                "purple_support_count": int(
                    details.get("purple_support_count") or 0
                ),
                "intraday_average_support_count": int(
                    details.get("intraday_average_support_count") or 0
                ),
                "support_confirmation_count": int(
                    details.get("support_confirmation_count") or 0
                ),
                "confidence": str(row["confidence"]),
                "score": float(row["score"]),
                "priority": str(details.get("alert_priority") or "medium"),
                "source_bar_time": details.get("source_bar_time"),
            }
        )
        if len(events) >= safe_limit:
            break
    if effective_after_id:
        events.reverse()

    health = api_health()
    active_monitor_code_count = int(
        (
            health.get("status", {})
            .get("indicator_warmup", {})
            .get("requested_codes")
        )
        or 0
    )
    latest_id = max(
        scanned_event_ids,
        default=(current_max_id if cursor_reset_reason else effective_after_id),
    )
    return clean_json(
        {
            "ok": True,
            "mode": "read_only",
            "scope": normalized_scope,
            "event_types": selected_event_types,
            "min_daily_amount": min_daily_amount,
            "min_daily_amplitude": min_daily_amplitude,
            "trading_date": trading_date,
            "requested_after_id": requested_after_id,
            "effective_after_id": effective_after_id,
            "cursor_reset": bool(cursor_reset_reason),
            "cursor_reset_reason": cursor_reset_reason or None,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "monitor_alive": bool(health["monitor_alive"]),
            "data_is_stale": trading_date != health["calendar_date"],
            "monitored_code_count": len(monitored_codes),
            "active_monitor_code_count": active_monitor_code_count,
            "latest_id": latest_id,
            "events": events,
        }
    )


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "MiniQMTDashboard/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/health":
                self.send_payload(200, api_health())
                return
            if parsed.path == "/intraday-backfill":
                self.send_payload(
                    200,
                    intraday_backfill_status_payload(
                        (query.get("code") or [""])[0],
                        (
                            query.get("trading_date")
                            or query.get("date")
                            or [""]
                        )[0],
                        (query.get("job_id") or [""])[0],
                    ),
                )
                return
            if parsed.path == "/bond":
                payload = bond_payload(
                    (query.get("code") or [""])[0],
                    (query.get("date") or [""])[0],
                    (query.get("fast") or [""])[0].lower()
                    in {"1", "true", "yes"},
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/bond-meta":
                self.send_payload(
                    200,
                    bond_metadata_payload((query.get("code") or [""])[0]),
                )
                return
            if parsed.path == "/daily":
                reference_only = (
                    (query.get("reference") or [""])[0].lower()
                    in {"1", "true", "yes"}
                )
                payload_factory = (
                    local_reference_daily_payload if reference_only else daily_payload
                )
                payload = payload_factory(
                    (query.get("code") or [""])[0],
                    int((query.get("count") or ["120"])[0]),
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/events":
                payload = events_payload(
                    (query.get("scope") or ["focus"])[0],
                    int((query.get("after_id") or ["0"])[0]),
                    int((query.get("limit") or ["80"])[0]),
                    (query.get("codes") or [""])[0],
                    (query.get("types") or [""])[0],
                    (query.get("min_daily_amount") or [""])[0],
                    (query.get("min_daily_amplitude") or [""])[0],
                    (query.get("trading_date") or [""])[0],
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/quotes":
                payload = quotes_payload(
                    (query.get("codes") or [""])[0],
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/new-bond-candidates":
                self.send_payload(
                    200,
                    new_bond_candidates_payload(
                        (query.get("date") or query.get("trading_date") or [""])[0]
                    ),
                )
                return
            if parsed.path == "/sparks":
                payload = sparks_payload(
                    (query.get("codes") or [""])[0],
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/order-book":
                self.send_payload(
                    200,
                    order_book_payload((query.get("code") or [""])[0]),
                )
                return
            if parsed.path == "/trading":
                self.send_payload(200, trading_payload())
                return
            if parsed.path == "/trading/capabilities":
                self.send_payload(200, trading_capabilities_payload())
                return
            if parsed.path == "/active-index":
                self.send_payload(200, active_index_payload())
                return
            if parsed.path == "/tags":
                self.send_payload(
                    200,
                    tags_payload(
                        (query.get("code") or [""])[0],
                        (query.get("tag") or [""])[0],
                    ),
                )
                return
            self.send_payload(404, {"error": "not found"})
        except ValueError as error:
            self.send_payload(400, {"error": str(error)})
        except (FileNotFoundError, LookupError) as error:
            self.send_payload(404, {"error": str(error)})
        except Exception as error:  # pragma: no cover - top-level safety boundary
            self.send_payload(500, {"error": str(error)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 64 * 1024:
                raise TradingError("请求内容为空或过大")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise TradingError("请求内容必须是JSON对象")
            if parsed.path == "/intraday-backfill":
                self.send_payload(202, request_intraday_backfill(body))
                return
            handlers = {
                "/trading/unlock": trading_unlock_payload,
                "/trading/order-preview": trading_order_preview_payload,
                "/trading/order-execute": trading_order_execute_payload,
                "/trading/cancel-preview": trading_cancel_preview_payload,
                "/trading/cancel-execute": trading_cancel_execute_payload,
            }
            handler = handlers.get(parsed.path)
            if handler is None:
                self.send_payload(404, {"error": "not found"})
                return
            self.send_payload(200, handler(body))
        except TradingError as error:
            self.send_payload(error.status, {"error": str(error)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_payload(400, {"error": "请求JSON格式错误"})
        except ValueError as error:
            self.send_payload(400, {"error": str(error)})
        except Exception as error:  # pragma: no cover - top-level safety boundary
            self.send_payload(500, {"error": str(error)})

    def send_payload(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(
            clean_json(payload),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message: str, *args: Any) -> None:
        print(
            f"[{self.log_date_time_string()}] {self.address_string()} "
            f"{message % args}",
            flush=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18890)
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    if args.health:
        print(json.dumps(api_health(), ensure_ascii=False, indent=2))
        return 0
    start_intraday_backfill_service()
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(
        f"MiniQMT dashboard API listening on http://{args.host}:{args.port}",
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        INTRADAY_BACKFILL_STOP_EVENT.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
