#!/usr/bin/env python3
"""Read-only HTTP API for the local MiniQMT intraday indicator dashboard."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

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
INTRADAY_CURRENT_CACHE_TTL_SECONDS = 10
INTRADAY_BACKFILL_RETRIES = 3
INTRADAY_BACKFILL_WAIT_SECONDS = 0.4
INTRADAY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
HISTORICAL_VOLUME_CACHE: dict[
    str,
    tuple[float, tuple[float | None, float | None]],
] = {}
FINANCE_ROOT = Path(__file__).resolve().parents[1]
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


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def api_health() -> dict[str, Any]:
    databases = available_databases()
    status = read_json(STATUS_PATH)
    service = read_json(SERVICE_PATH)
    pid = int(service.get("pid") or 0)
    latest = databases[0] if databases else None
    calendar_date = datetime.now().strftime("%Y%m%d")
    return {
        "ok": bool(latest),
        "mode": "read_only",
        "monitor_alive": process_alive(pid),
        "monitor_pid": pid or None,
        "calendar_date": calendar_date,
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
                "timestamp": int(tick.get("time") or 0),
                "source": "MiniQMT full_tick",
            }
        )

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
    if len(rows) < 30:
        try:
            bridge.post(
                "/api/download/history_data2",
                {
                    "stocks": [stock_code],
                    "period": "1d",
                    "start_time": start_date,
                    "end_time": end_date,
                },
                timeout=90.0,
            )
            rows = fetch_rows()
        except Exception:
            pass
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
    if len(rows) < 2:
        try:
            bridge.post(
                "/api/download/history_data2",
                {
                    "stocks": [stock_code],
                    "period": "1m",
                    "start_time": trading_date,
                    "end_time": trading_date,
                },
                timeout=90.0,
            )
            rows = fetch_rows()
        except Exception:
            pass
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
    download_error = ""
    try:
        bridge.post(
            "/api/download/history_data2",
            {
                "stocks": [stored_code],
                "period": "1d",
                "start_time": start_time,
                "end_time": end_time,
            },
            timeout=90.0,
        )
    except Exception as error:
        download_error = f"{type(error).__name__}: {error}"

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


def historical_minute_rows(
    stored_code: str,
    trading_date: str,
) -> tuple[list[dict[str, Any]], float | None, str | None, str]:
    if not re.fullmatch(r"\d{8}", trading_date):
        raise ValueError("历史分时日期必须为YYYYMMDD")
    cache_key = f"{stored_code}:{trading_date}"
    cached = INTRADAY_CACHE.get(cache_key)
    is_current_day = trading_date == datetime.now().strftime("%Y%m%d")
    cache_ttl = (
        INTRADAY_CURRENT_CACHE_TTL_SECONDS
        if is_current_day
        else INTRADAY_CACHE_TTL_SECONDS
    )
    if (
        cached
        and time.monotonic() - cached[0] < cache_ttl
        and not minute_rows_need_backfill(list(cached[1]["rows"]), trading_date)
    ):
        cached_payload = cached[1]
        return (
            list(cached_payload["rows"]),
            finite_or_none(cached_payload.get("previous_close")),
            cached_payload.get("previous_close_date"),
            "MiniQMT 1m · 缓存",
        )

    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=30.0,
    )
    download_error = ""
    try:
        bridge.download_minute_bars([stored_code], trading_date, timeout=90.0)
    except Exception as error:
        download_error = f"{type(error).__name__}: {error}"
    rows: list[dict[str, Any]] = []
    previous_close = None
    for attempt in range(INTRADAY_BACKFILL_RETRIES):
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
            timeout=60.0,
        )
        raw_rows = list((payload.get("data") or {}).get(stored_code) or [])
        rows = []
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
        if not minute_rows_need_backfill(rows, trading_date):
            break
        if attempt + 1 < INTRADAY_BACKFILL_RETRIES:
            time.sleep(INTRADAY_BACKFILL_WAIT_SECONDS * (attempt + 1))
            try:
                bridge.download_minute_bars(
                    [stored_code],
                    trading_date,
                    timeout=90.0,
                )
            except Exception as error:
                download_error = f"{type(error).__name__}: {error}"
    if not rows:
        detail = f"；下载错误：{download_error}" if download_error else ""
        raise LookupError(f"{stored_code} 在 {trading_date} 没有分钟数据{detail}")

    cached_payload = {
        "rows": rows,
        "previous_close": previous_close,
        "previous_close_date": None,
    }
    if minute_rows_need_backfill(rows, trading_date):
        INTRADAY_CACHE.pop(cache_key, None)
    else:
        INTRADAY_CACHE[cache_key] = (time.monotonic(), cached_payload)
    return rows, previous_close, None, "MiniQMT 1m"


def live_tick_minute_rows(
    stored_code: str,
    trading_date: str,
) -> tuple[list[dict[str, Any]], float | None, str, float]:
    bridge = MONITOR.BridgeClient(
        f"http://{QMT_BRIDGE_HOST}:{QMT_BRIDGE_PORT}",
        timeout=15.0,
    )
    ticks = bridge.full_tick([stored_code])
    tick = ticks.get(stored_code)
    if (
        not isinstance(tick, dict)
        or compact_date(tick.get("timetag")) != trading_date
    ):
        return [], None, "", 0
    tick_rows = update_active_index_tick_minutes(
        ticks,
        [stored_code],
        trading_date,
    ).get(stored_code) or []
    rows: list[dict[str, Any]] = []
    for raw in tick_rows:
        timestamp = int(raw.get("time") or 0)
        close = finite_or_none(raw.get("close"))
        if timestamp <= 0 or close is None or close <= 0:
            continue
        moment = datetime.fromtimestamp(timestamp / 1000)
        rows.append(
            {
                "minute_ms": timestamp,
                "minute_time": moment.strftime("%Y-%m-%d %H:%M:%S"),
                "open": close,
                "high": close,
                "low": close,
                "close": close,
                "amount": finite_or_none(raw.get("amount")) or 0,
            }
        )
    names = resolve_active_index_names(
        bridge,
        [stored_code],
        {stored_code: ""},
    )
    return (
        rows,
        finite_or_none(tick.get("lastClose")),
        names.get(stored_code) or "",
        finite_or_none(tick.get("amount")) or 0,
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


def optional_row_value(row: Any, key: str) -> Any:
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


def bond_payload(code_input: str, date_input: str = "") -> dict[str, Any]:
    code = normalize_code(code_input)
    stored_code = monitor_code(code)
    if date_input and not re.fullmatch(r"\d{8}", date_input):
        raise ValueError("历史分时日期必须为YYYYMMDD")
    database = None
    trading_date = date_input
    minute_rows: list[Any] = []
    event_rows: list[Any] = []
    name = ""
    minute_source = "本地监控数据库"
    previous_close = None
    previous_close_date = None
    live_cumulative_amount = 0.0

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
    downloaded_rows: list[dict[str, Any]] = []
    downloaded_previous_close = None
    if date_input or minute_rows_need_backfill(local_rows, trading_date):
        try:
            (
                downloaded_rows,
                downloaded_previous_close,
                previous_close_date,
                _,
            ) = historical_minute_rows(stored_code, trading_date)
        except Exception:
            downloaded_rows = []
    live_rows: list[dict[str, Any]] = []
    live_previous_close = None
    live_name = ""
    if not date_input:
        (
            live_rows,
            live_previous_close,
            live_name,
            live_cumulative_amount,
        ) = live_tick_minute_rows(stored_code, trading_date)
    minute_rows = merge_minute_rows(local_rows, downloaded_rows, live_rows)
    previous_close = live_previous_close or downloaded_previous_close
    if live_name:
        name = live_name
    source_parts = []
    if local_rows:
        source_parts.append("本地监控")
    if downloaded_rows:
        source_parts.append("MiniQMT 1m补齐")
    if live_rows:
        source_parts.append("实时快照")
    if source_parts:
        minute_source = " + ".join(source_parts)
    if not minute_rows:
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
            volume_ratio, average5_volume = bond_volume_ratio(
                stored_code,
                trading_date,
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
    health = api_health()
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
            "formula_source": str(MONITOR_ROOT / "shortline_monitor.py"),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "database_updated_at": database_updated_at,
            "code": code,
            "monitor_code": stored_code,
            "name": name,
            "tags": bond_tags(stored_code),
            "source": minute_source,
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
) -> dict[str, Any]:
    normalized_scope = scope if scope in {"focus", "all"} else "focus"
    safe_after_id = max(0, int(after_id))
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
    if safe_after_id:
        conditions.append("id>?")
        parameters.append(safe_after_id)
    order = "ASC" if safe_after_id else "DESC"
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
    with connect_read_only(database) as connection:
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
    if safe_after_id:
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
        default=safe_after_id,
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
            if parsed.path == "/bond":
                payload = bond_payload(
                    (query.get("code") or [""])[0],
                    (query.get("date") or [""])[0],
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
                payload = daily_payload(
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
                )
                self.send_payload(200, payload)
                return
            if parsed.path == "/quotes":
                payload = quotes_payload(
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
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(
        f"MiniQMT dashboard API listening on http://{args.host}:{args.port}",
        flush=True,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
