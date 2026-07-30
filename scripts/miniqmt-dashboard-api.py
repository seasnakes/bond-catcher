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
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


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


def bond_payload(code_input: str, date_input: str = "") -> dict[str, Any]:
    code = normalize_code(code_input)
    stored_code = monitor_code(code)
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

    rows: list[dict[str, Any]] = []
    cumulative_amount = 0.0
    cumulative_estimated_units = 0.0
    for index, row in enumerate(minute_rows):
        amount = float(row["amount"])
        cumulative_amount += amount
        close = float(row["close"])
        if amount > 0 and close > 0:
            cumulative_estimated_units += amount / close
        intraday_average = (
            cumulative_amount / cumulative_estimated_units
            if cumulative_estimated_units > 0
            else close
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
    database_updated_at = datetime.fromtimestamp(
        database.stat().st_mtime
    ).isoformat(timespec="seconds")
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
            "trading_date": trading_date,
            "available_dates": [path.stem for path in available_databases()],
            "bar_count": len(rows),
            "complete_session": len(rows) >= 240,
            "full_session": len(rows) >= 241,
            "intraday_average_quality": "estimated_from_minute_amount_and_close",
            "first_price": first["open"],
            "previous_close": previous_close,
            "previous_close_date": previous_close_date,
            "latest_price": latest["close"],
            "daily_return": daily_return,
            "change_from_first": (
                (latest["close"] / first["open"] - 1) * 100
                if first["open"]
                else None
            ),
            "total_amount": cumulative_amount,
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
            self.send_payload(404, {"error": "not found"})
        except ValueError as error:
            self.send_payload(400, {"error": str(error)})
        except (FileNotFoundError, LookupError) as error:
            self.send_payload(404, {"error": str(error)})
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
