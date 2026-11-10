#!/usr/bin/env python3
"""Stable QMT HTTP contract for the finance board.

The board and short-line monitor use a stable HTTP API backed by Big QMT.
The legacy MiniQMT backend is retired. Trading is disabled by default and
is never changed by market-data requests.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hmac
import json
import math
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from qmt_history_quality import suspended_placeholder


TRADING_WRITE_PATHS = {"/api/trading/order", "/api/trading/cancel"}
TRADING_READ_PATHS = {
    "/api/trading/account_status",
    "/api/trading/asset",
    "/api/trading/positions",
    "/api/trading/orders",
    "/api/trading/trades",
}
SUPPORTED_BACKENDS = {"bigqmt"}
CHINA_TIMEZONE = dt.timezone(dt.timedelta(hours=8))
# Big QMT can briefly expose yesterday's daily bar one session late while its
# local history cache is warming.  Revalidate the previous-close baseline so a
# transient stale row cannot remain on the board for the rest of the day.
PREVIOUS_CLOSE_CACHE_TTL_SECONDS = 60.0
PREVIOUS_CLOSE_MISMATCH_ABS_TOLERANCE = 0.005
PREVIOUS_CLOSE_MISMATCH_REL_TOLERANCE = 0.00001
PREVIOUS_CLOSE_BACKFILL_RETRY_SECONDS = 300.0
PREVIOUS_CLOSE_AUDIT_RETRY_SECONDS = 300.0
RAW_PREVIOUS_CLOSE_STALE_MIN_CODES = 20
RAW_PREVIOUS_CLOSE_STALE_RATIO = 0.5


class GatewayError(RuntimeError):
    status = HTTPStatus.BAD_GATEWAY

    def __init__(self, message: str, *, status: int | HTTPStatus | None = None):
        super().__init__(message)
        if status is not None:
            self.status = HTTPStatus(status)


class UnsupportedEndpoint(GatewayError):
    status = HTTPStatus.NOT_IMPLEMENTED


class GatewayBusy(GatewayError):
    status = HTTPStatus.SERVICE_UNAVAILABLE


class UpstreamHttpError(GatewayError):
    def __init__(self, status: int, payload: Any):
        message = payload.get("detail") if isinstance(payload, dict) else str(payload)
        super().__init__(message or f"upstream returned HTTP {status}", status=status)
        self.payload = payload


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_env_file(path: str | os.PathLike[str] | None) -> None:
    """Load simple KEY=VALUE entries without overriding process settings."""
    if not path:
        return
    env_path = Path(path).expanduser()
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        if key and key.replace("_", "").isalnum():
            os.environ.setdefault(key, value)


def split_values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        parts = value
    else:
        parts = str(value or "").split(",")
    return [str(item).strip() for item in parts if str(item).strip()]


def parse_bool(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def compact_date(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        stamp = float(value)
        if stamp > 10_000_000_000:
            stamp /= 1000
        return dt.datetime.fromtimestamp(
            stamp, dt.timezone(dt.timedelta(hours=8))
        ).strftime("%Y%m%d")
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits[:8] if len(digits) >= 8 else ""


def china_midnight_ms(date_value: str) -> int:
    moment = dt.datetime.strptime(date_value, "%Y%m%d").replace(
        tzinfo=CHINA_TIMEZONE
    )
    return int(moment.timestamp() * 1000)


def has_current_session_trade(tick: Any, now: dt.datetime) -> bool:
    """A real index trade can confirm today when QMT's calendar ends yesterday."""
    if not isinstance(tick, dict):
        return False
    try:
        values = [tick.get(key) for key in ("time", "lastPrice", "amount", "volume")]
        if any(isinstance(value, bool) for value in values):
            return False
        stamp, price, amount, volume = map(float, values)
        if not all(math.isfinite(value) and value > 0 for value in (stamp, price, amount, volume)):
            return False
        moment = dt.datetime.fromtimestamp(stamp / 1000, CHINA_TIMEZONE)
    except (TypeError, ValueError, OverflowError, OSError):
        return False
    current = now.astimezone(CHINA_TIMEZONE)
    clock = moment.strftime("%H:%M:%S")
    return (moment.date() == current.date()
            and moment.timestamp() <= current.timestamp() + 10
            and ("09:30:00" <= clock <= "11:30:59"
                 or "13:00:00" <= clock <= "15:00:59"))


def latest_completed_closes(
    payload: Any,
    codes: list[str],
    current_date: str,
) -> dict[str, float]:
    """Use the last completed daily bar only when it contains real data.

    QMT can publish a zero-volume placeholder for a missing session with the
    prior bar's close carried forward.  That close is not yesterday's close.
    """
    safe_payload = json_safe(payload)
    if not isinstance(safe_payload, dict):
        return {}
    result: dict[str, float] = {}
    for code in codes:
        rows = safe_payload.get(code)
        if not isinstance(rows, list):
            continue
        candidates: list[tuple[str, dict[str, Any]]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            trading_date = compact_date(
                row.get("index") or row.get("date") or row.get("time")
            )
            if trading_date and trading_date < current_date:
                candidates.append((trading_date, row))
        if candidates:
            row = max(candidates, key=lambda item: item[0])[1]
            try:
                close = float(row.get("close"))
                pre_close = float(row.get("preClose", close))
                volume = float(row.get("volume", 1))
                amount = float(row.get("amount", 1))
            except (TypeError, ValueError):
                continue
            if (all(math.isfinite(value) for value in
                    (close, pre_close, volume, amount))
                    and close > 0 and pre_close > 0
                    and (volume > 0 or amount > 0)):
                result[code] = close
    return result


def supports_daily_previous_close(code: str) -> bool:
    return (
        len(code) == 9
        and code[:6].isdigit()
        and code[6:] in {".SH", ".SZ"}
    )


def previous_close_differs(value: Any, reference: Any) -> bool:
    try:
        current = float(value)
        expected = float(reference)
    except (TypeError, ValueError):
        return True
    if current <= 0 or expected <= 0:
        return True
    tolerance = max(
        PREVIOUS_CLOSE_MISMATCH_ABS_TOLERANCE,
        abs(expected) * PREVIOUS_CLOSE_MISMATCH_REL_TOLERANCE,
    )
    return abs(current - expected) > tolerance


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "item"):
        try:
            return json_safe(value.item())
        except Exception:
            pass
    if hasattr(value, "to_dict") and hasattr(value, "columns"):
        frame = value
        try:
            index_name = str(frame.index.name or "index")
            if index_name in frame.columns:
                index_name = "index"
            rows = frame.reset_index(names=index_name).to_dict(orient="records")
        except TypeError:  # pandas < 1.5 in some QMT environments
            rows = frame.reset_index().to_dict(orient="records")
        return json_safe(rows)
    if hasattr(value, "__dict__"):
        return json_safe(vars(value))
    return str(value)


def public_health(value: Any) -> Any:
    """Remove identifiers and credentials from diagnostic payloads."""
    blocked = ("account", "password", "secret", "token", "api_key")
    if isinstance(value, dict):
        return {
            str(key): public_health(item)
            for key, item in value.items()
            if not any(word in str(key).lower() for word in blocked)
        }
    if isinstance(value, (list, tuple)):
        return [public_health(item) for item in value]
    return json_safe(value)


@dataclass(frozen=True)
class GatewayConfig:
    host: str = "127.0.0.1"
    port: int = 18889
    market_backend: str = "bigqmt"
    trading_backend: str = "disabled"
    bigqmt_zmq_address: str = "tcp://10.211.55.3:15588"
    bigqmt_formula_host: str = "10.211.55.3"
    bigqmt_formula_port: int = 58600
    bigqmt_account_id: str = ""
    api_key: str = ""
    bigqmt_orders_enabled: bool = False
    timeout_seconds: float = 12.0
    bigqmt_probe_timeout_seconds: float = 4.0
    circuit_cooldown_seconds: float = 20.0
    market_selection_path: str = ""

    @classmethod
    def from_env(cls, host: str | None = None, port: int | None = None):
        bigqmt_zmq_address = os.environ.get(
            "FINANCE_BIGQMT_ZMQ_ADDRESS", "tcp://10.211.55.3:15588"
        )
        formula_host = os.environ.get("FINANCE_BIGQMT_FORMULA_HOST", "").strip()
        if not formula_host:
            formula_host = urllib.parse.urlparse(bigqmt_zmq_address).hostname or "10.211.55.3"
        config = cls(
            market_selection_path=os.environ.get(
                "FINANCE_QMT_MARKET_SELECTION_PATH",
                str(Path(__file__).resolve().parents[1] / "runtime" / "qmt-market-source.json"),
            ),
            host=host or os.environ.get("FINANCE_QMT_GATEWAY_HOST", "127.0.0.1"),
            port=port or int(os.environ.get("FINANCE_QMT_GATEWAY_PORT", "18889")),
            market_backend=os.environ.get("FINANCE_QMT_MARKET_BACKEND", "bigqmt").lower(),
            trading_backend=os.environ.get(
                "FINANCE_QMT_TRADING_BACKEND", "disabled"
            ).lower(),
            bigqmt_zmq_address=bigqmt_zmq_address,
            bigqmt_formula_host=formula_host,
            bigqmt_formula_port=int(
                os.environ.get("FINANCE_BIGQMT_FORMULA_PORT", "58600")
            ),
            bigqmt_account_id=(
                os.environ.get("BIGQMT_ACCOUNT_ID")
                or os.environ.get("QMT_BRIDGE_STOCK_ACCOUNT_ID")
                or ""
            ),
            api_key=os.environ.get("QMT_BRIDGE_API_KEY", ""),
            bigqmt_orders_enabled=env_bool(
                "FINANCE_BIGQMT_ORDER_METHODS_ENABLED", False
            ),
            timeout_seconds=float(os.environ.get("FINANCE_QMT_TIMEOUT_SECONDS", "12")),
            bigqmt_probe_timeout_seconds=float(
                os.environ.get("FINANCE_BIGQMT_PROBE_TIMEOUT_SECONDS", "4")
            ),
            circuit_cooldown_seconds=float(
                os.environ.get("FINANCE_QMT_CIRCUIT_COOLDOWN_SECONDS", "20")
            ),
        )
        return config

    def __post_init__(self):
        # Migrate persisted launch/environment settings without ever contacting
        # the retired service, even if an old launch definition is still loaded.
        if self.market_backend not in {"auto", "miniqmt", "bigqmt"}:
            raise ValueError("FINANCE_QMT_MARKET_BACKEND must be bigqmt")
        object.__setattr__(self, "market_backend", "bigqmt")
        if self.trading_backend == "miniqmt":
            object.__setattr__(self, "trading_backend", "disabled")
        if self.trading_backend not in {"disabled", "bigqmt"}:
            raise ValueError("FINANCE_QMT_TRADING_BACKEND must be disabled|bigqmt")


class DeadlineRpcClient:
    """Include time waiting for the shared RPC client in each call's budget.

    The upstream ZMQ transport starts its timeout only after acquiring its
    unbounded client lock. HTTP callers can otherwise retain sockets/threads
    long after their own timeout when that serialized transport falls behind.
    """

    def __init__(self, client: Any):
        self._client = client
        self._call_lock = threading.Lock()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    def call(
        self, method, params=None, account_id=None, timeout_seconds=None,
        use_formula=True,
    ):
        budget = float(
            self._client.timeout_seconds if timeout_seconds is None else timeout_seconds
        )
        deadline = time.monotonic() + max(0.0, budget)
        if not self._call_lock.acquire(timeout=max(0.0, budget)):
            raise GatewayBusy("Big QMT RPC queue wait exceeded request timeout")
        rpc_started = time.monotonic()
        try:
            remaining = deadline - rpc_started
            if remaining <= 0:
                raise GatewayBusy("Big QMT RPC queue wait exceeded request timeout")
            return self._client.call(
                method, params, account_id=account_id,
                timeout_seconds=remaining, use_formula=use_formula,
            )
        except TimeoutError:
            # A QMT restart can leave the long-lived DEALER unable to receive
            # replies even while new clients work. Retire it under the call
            # lock; the next request gets a fresh connection/identity. Never
            # replay the timed-out request, whose result may be unknown.
            transport = getattr(self._client, "_transport_instance", None)
            if getattr(transport, "name", None) == "zmq":
                try:
                    transport.stop()
                    print("[qmt-rpc] retired timed-out ZMQ connection", file=sys.stderr, flush=True)
                except Exception as reset_error:
                    print(
                        f"[qmt-rpc] ZMQ reset failed: {type(reset_error).__name__}",
                        file=sys.stderr, flush=True,
                    )
            raise
        finally:
            self._call_lock.release()
            elapsed = time.monotonic() - rpc_started
            queued = rpc_started - (deadline - max(0.0, budget))
            if elapsed + queued >= 2.0:
                values = params if isinstance(params, dict) else {}
                stocks = values.get("stock_list", values.get("stocks", []))
                print(
                    f"[qmt-rpc] method={method} period={values.get('period', '')} "
                    f"codes={len(stocks) if isinstance(stocks, (list, tuple)) else 0} "
                    f"queue_seconds={queued:.3f} rpc_seconds={elapsed:.3f}",
                    file=sys.stderr, flush=True,
                )


class BigQmtRpcBackend:
    name = "bigqmt"

    def __init__(self, config: GatewayConfig):
        self.config = config
        self._lock = threading.RLock()
        self._client = None
        self._data = None
        self._trader = None
        self._calendar_cache: dict[tuple[str, str, str, str], tuple[float, list[str]]] = {}
        self._calendar_lock = threading.Lock()
        self._previous_close_refresh_lock = threading.Lock()
        self._previous_close_cache_date = ""
        self._previous_close_cache: dict[str, float] = {}
        self._previous_close_cache_checked_at: dict[str, float] = {}
        self._previous_close_quote_dates: dict[str, str] = {}
        self._previous_close_backfill_queue: queue.Queue[
            tuple[str, list[str]]
        ] = queue.Queue()
        self._previous_close_backfill_pending: set[tuple[str, str]] = set()
        self._previous_close_backfill_attempted_at: dict[
            tuple[str, str], float
        ] = {}
        self._previous_close_backfill_thread: threading.Thread | None = None
        self._previous_close_backfill_last_error = ""
        self._previous_close_backfill_completed = 0
        self._raw_previous_close_date = ""
        self._raw_previous_close_checked_codes: set[str] = set()
        self._raw_previous_close_mismatched_codes: set[str] = set()
        self._raw_previous_close_last_checked_at = ""

    def _ensure_started(self) -> None:
        if self._client is not None:
            return
        with self._lock:
            if self._client is not None:
                return
            try:
                from bigqmt_signal_trader.xtquant_compat import (
                    BigQmtRpcClient,
                    BigQmtXtData,
                    BigQmtXtTrader,
                )
            except ImportError as error:
                raise GatewayError(
                    "xtquant-big-convert is not installed in the gateway Python"
                ) from error
            transport_config = {
                "transport": "zmq",
                "zmq": {"connect_address": self.config.bigqmt_zmq_address},
                # FormulaServer is safe and dramatically faster for immutable
                # instrument reference data.  Limit it to those methods so
                # ticks and bars always use the live strategy RPC path.
                "formula_server": {
                    "enabled": False,
                    "host": self.config.bigqmt_formula_host,
                    "port": self.config.bigqmt_formula_port,
                    "methods": [
                        "get_instrument_detail",
                        "get_instrumentdetail",
                    ],
                },
                "local_cache_enabled": False,
                "full_tick_cache_enabled": False,
            }
            self._client = DeadlineRpcClient(BigQmtRpcClient(
                account_id=self.config.bigqmt_account_id,
                redis_config=transport_config,
                timeout_seconds=self.config.timeout_seconds,
                transport="zmq",
            ))
            self._data = BigQmtXtData(self._client)
            self._trader = BigQmtXtTrader(
                account_id=self.config.bigqmt_account_id,
                redis_config=transport_config,
                timeout_seconds=self.config.timeout_seconds,
            )

    def _account(self, query: dict[str, str] | Any) -> SimpleNamespace:
        values = query if isinstance(query, dict) else query or {}
        account_id = str(
            values.get("account_id") or self.config.bigqmt_account_id or ""
        )
        if not account_id:
            raise GatewayError("Big QMT account id is not configured", status=503)
        return SimpleNamespace(
            account_id=account_id,
            account_type=str(values.get("account_type") or "STOCK").upper(),
        )

    def _health(self) -> dict[str, Any]:
        ping = json_safe(
            self._client.call(
                "ping",
                {},
                # An active connection shares its RPC queue with market reads.
                # A short discovery probe here can falsely open the market
                # circuit while ordinary quotes are still succeeding.
                timeout_seconds=self.config.timeout_seconds,
                use_formula=False,
            )
        )
        return {
            "status": "ok",
            "trading": {
                "enabled": self.config.trading_backend == "bigqmt" and self.config.bigqmt_orders_enabled,
                "connected": self.config.trading_backend == "bigqmt",
                "error": None,
            },
            "bigqmt": {
                "transport": "zmq",
                "server": public_health(ping)
                if isinstance(ping, dict)
                else {"reply": ping},
            },
        }

    def probe(self) -> Any:
        self._ensure_started()
        return self._client.call(
            "ping",
            {},
            timeout_seconds=self.config.bigqmt_probe_timeout_seconds,
            use_formula=False,
        )

    def probe_quotes(self, stocks: list[str]) -> dict[str, Any]:
        self._ensure_started()
        return {"data": json_safe(self._data.get_full_tick(stocks))}

    def _daily_previous_closes(
        self, codes: list[str], quote_date: str | None = None,
    ) -> dict[str, float]:
        current_date = dt.datetime.now(CHINA_TIMEZONE).strftime("%Y%m%d")
        quote_date = quote_date or current_date
        supported_codes = sorted(
            {code for code in codes if supports_daily_previous_close(code)}
        )

        def stale_codes() -> list[str]:
            now = time.monotonic()
            return [
                code for code in supported_codes
                if code not in self._previous_close_cache_checked_at
                or self._previous_close_quote_dates.get(code) != quote_date
                or now - self._previous_close_cache_checked_at[code]
                >= (86400.0 if quote_date < current_date else PREVIOUS_CLOSE_CACHE_TTL_SECONDS)
            ]

        def cached_closes() -> dict[str, float]:
            return {
                code: self._previous_close_cache[code]
                for code in supported_codes
                if code in self._previous_close_cache
                and self._previous_close_quote_dates.get(code) == quote_date
            }

        # Keep state/status reads independent of network I/O. In particular,
        # refreshing a large board must not block already-cached monitor codes.
        with self._lock:
            if self._previous_close_cache_date != current_date:
                self._previous_close_cache = {}
                self._previous_close_cache_checked_at = {}
                self._previous_close_quote_dates = {}
                self._previous_close_cache_date = current_date
            if not stale_codes():
                return cached_closes()

        budget = max(0.0, self.config.timeout_seconds)
        deadline = time.monotonic() + budget
        if not self._previous_close_refresh_lock.acquire(timeout=budget):
            raise GatewayBusy("previous-close refresh queue exceeded request timeout")
        try:
            with self._lock:
                pending = stale_codes()
            for index in range(0, len(pending), 100):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise GatewayBusy("previous-close refresh exceeded request timeout")
                group = pending[index : index + 100]
                result = self._data.get_market_data_ex(
                    field_list=["close", "preClose", "volume", "amount"],
                    stock_list=group,
                    period="1d",
                    start_time="",
                    end_time=quote_date,
                    count=10,
                    dividend_type="none",
                    fill_data=False,
                    use_formula=False,
                    timeout_seconds=remaining,
                )
                closes = latest_completed_closes(result, group, quote_date)
                checked_at = time.monotonic()
                with self._lock:
                    # A successful empty refresh must invalidate older values.
                    # A failed refresh leaves their original freshness intact.
                    for code in group:
                        self._previous_close_cache.pop(code, None)
                    self._previous_close_cache.update(closes)
                    self._previous_close_cache_checked_at.update(
                        {code: checked_at for code in group}
                    )
                    self._previous_close_quote_dates.update(
                        {code: quote_date for code in group}
                    )
            with self._lock:
                return cached_closes()
        finally:
            self._previous_close_refresh_lock.release()

    def schedule_previous_close_backfill(self, codes: list[str]) -> int:
        """Queue stale Big QMT daily history without blocking live quotes."""
        current_date = dt.datetime.now(CHINA_TIMEZONE).strftime("%Y%m%d")
        now = time.monotonic()
        with self._lock:
            selected = []
            for code in sorted(set(codes)):
                if not supports_daily_previous_close(code):
                    continue
                key = (current_date, code)
                if key in self._previous_close_backfill_pending:
                    continue
                attempted_at = self._previous_close_backfill_attempted_at.get(
                    key, 0.0
                )
                if now - attempted_at < PREVIOUS_CLOSE_BACKFILL_RETRY_SECONDS:
                    continue
                self._previous_close_backfill_pending.add(key)
                selected.append(code)
            if not selected:
                return 0
            if (
                self._previous_close_backfill_thread is None
                or not self._previous_close_backfill_thread.is_alive()
            ):
                self._previous_close_backfill_thread = threading.Thread(
                    target=self._previous_close_backfill_worker,
                    name="bigqmt-previous-close-backfill",
                    daemon=True,
                )
                self._previous_close_backfill_thread.start()
            for index in range(0, len(selected), 100):
                self._previous_close_backfill_queue.put(
                    (current_date, selected[index : index + 100])
                )
            return len(selected)

    def _previous_close_backfill_worker(self) -> None:
        while True:
            current_date, codes = self._previous_close_backfill_queue.get()
            success = False
            error_text = ""
            try:
                start_date = (
                    dt.datetime.strptime(current_date, "%Y%m%d")
                    - dt.timedelta(days=10)
                ).strftime("%Y%m%d")
                assert self._data is not None
                self._data.download_history_data2(
                    codes,
                    "1d",
                    start_date,
                    current_date,
                    dividend_type="none",
                )
                success = True
            except Exception as error:  # pragma: no cover - live daemon boundary
                error_text = f"{type(error).__name__}: {error}"[:500]
            finally:
                attempted_at = time.monotonic()
                with self._lock:
                    for code in codes:
                        key = (current_date, code)
                        self._previous_close_backfill_pending.discard(key)
                        self._previous_close_backfill_attempted_at[key] = attempted_at
                        self._previous_close_cache.pop(code, None)
                        self._previous_close_cache_checked_at.pop(code, None)
                    if success:
                        self._previous_close_backfill_completed += len(codes)
                        self._previous_close_backfill_last_error = ""
                    else:
                        self._previous_close_backfill_last_error = error_text
                self._previous_close_backfill_queue.task_done()

    def previous_close_backfill_status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "pending": len(self._previous_close_backfill_pending),
                "completed": self._previous_close_backfill_completed,
                "last_error": self._previous_close_backfill_last_error or None,
            }

    def _record_raw_previous_close_health(
        self,
        ticks: dict[str, Any],
        codes: list[str],
        daily_closes: dict[str, float],
    ) -> None:
        """Detect a broadly stale ContextInfo reference-price session.

        A single raw ``lastClose`` can legitimately differ from the prior daily
        close on an ex-right/ex-dividend date.  A large cross-section disagreeing
        at once is different: in the observed Guojin full-QMT session it meant
        current-day ticks were paired with the previous session's metadata.
        Keep this detector diagnostic-only; corrected quote delivery remains the
        responsibility of the Big QMT daily-bar repair path.
        """
        current_date = dt.datetime.now(CHINA_TIMEZONE).strftime("%Y%m%d")
        checked: set[str] = set()
        mismatched: set[str] = set()
        for code in codes:
            tick = ticks.get(code)
            if not isinstance(tick, dict) or code not in daily_closes:
                continue
            if tick.get("_bigqmtQuoteChannel") == "native_xtdata":
                # A native session reference is exchange-adjusted and may differ
                # from the unadjusted D-1 close on a corporate-action date.
                continue
            try:
                raw_previous_close = float(tick.get("lastClose"))
            except (TypeError, ValueError):
                continue
            if raw_previous_close <= 0:
                continue
            checked.add(code)
            if previous_close_differs(raw_previous_close, daily_closes[code]):
                mismatched.add(code)

        if not checked:
            return
        with self._lock:
            if self._raw_previous_close_date != current_date:
                self._raw_previous_close_date = current_date
                self._raw_previous_close_checked_codes = set()
                self._raw_previous_close_mismatched_codes = set()
            self._raw_previous_close_checked_codes.update(checked)
            self._raw_previous_close_mismatched_codes.difference_update(
                checked - mismatched
            )
            self._raw_previous_close_mismatched_codes.update(mismatched)
            self._raw_previous_close_last_checked_at = dt.datetime.now(
                CHINA_TIMEZONE
            ).isoformat(timespec="seconds")

    def raw_previous_close_status(self) -> dict[str, Any]:
        with self._lock:
            checked = len(self._raw_previous_close_checked_codes)
            mismatched = len(self._raw_previous_close_mismatched_codes)
            ratio = mismatched / checked if checked else 0.0
            if checked == 0:
                status = "unknown"
            elif (
                checked >= RAW_PREVIOUS_CLOSE_STALE_MIN_CODES
                and ratio >= RAW_PREVIOUS_CLOSE_STALE_RATIO
            ):
                status = "stale"
            elif mismatched == 0:
                status = "consistent"
            else:
                status = "mixed"
            return {
                "status": status,
                "date": self._raw_previous_close_date or None,
                "checked_codes": checked,
                "mismatched_codes": mismatched,
                "mismatch_ratio": round(ratio, 4),
                "restart_recommended": status == "stale",
                "last_checked_at": self._raw_previous_close_last_checked_at or None,
                "method": "context_lastClose_vs_latest_completed_daily_close",
            }

    def _correct_previous_closes(
        self,
        ticks: Any,
        stocks: list[str],
    ) -> Any:
        supported_codes = [
            code for code in stocks if supports_daily_previous_close(code)
        ]
        safe_ticks = json_safe(ticks)
        if not supported_codes:
            return safe_ticks
        if not isinstance(safe_ticks, dict):
            raise GatewayError("Big QMT full_tick response is not a mapping")
        # Full QMT's native xtdata channel already carries the exchange's
        # official session reference price. Trust it: unlike an unadjusted D-1
        # daily close, it remains correct on ex-right/ex-dividend dates. Only
        # ContextInfo fallbacks need the slower historical repair path.
        fallback_codes = []
        for code in supported_codes:
            tick = safe_ticks.get(code)
            if not isinstance(tick, dict):
                continue
            try:
                previous_close = float(tick.get("lastClose"))
            except (TypeError, ValueError):
                previous_close = 0.0
            if (
                tick.get("_bigqmtQuoteChannel") == "native_xtdata"
                and previous_close > 0
            ):
                tick["previousCloseSource"] = "bigqmt_native_xtdata"
                continue
            fallback_codes.append(code)

        # A weekend request still carries Friday's quote. Its reference must
        # precede Friday, not the wall-clock date of the HTTP request. Group by
        # quote date so suspended/stale symbols cannot borrow another session.
        by_date: dict[str, list[str]] = {}
        today = dt.datetime.now(CHINA_TIMEZONE).strftime("%Y%m%d")
        for code in fallback_codes:
            tick = safe_ticks[code]
            quote_date = compact_date(tick.get("timetag") or tick.get("time")) or today
            by_date.setdefault(quote_date, []).append(code)
        closes = {}
        for quote_date, group in by_date.items():
            closes.update(self._daily_previous_closes(group, quote_date))
        self._record_raw_previous_close_health(
            safe_ticks,
            fallback_codes,
            closes,
        )
        for code in fallback_codes:
            tick = safe_ticks.get(code)
            if not isinstance(tick, dict):
                continue
            if code not in closes:
                tick["previousCloseSource"] = "bigqmt_context_tick"
                continue
            tick["lastClose"] = closes[code]
            tick["lastSettlementPrice"] = closes[code]
            tick["previousCloseSource"] = "bigqmt_daily"
        return safe_ticks

    def request(
        self,
        method: str,
        path: str,
        query: dict[str, str],
        body: Any,
        _headers: dict[str, str],
    ) -> Any:
        self._ensure_started()
        assert self._client is not None and self._data is not None
        assert self._trader is not None

        if method == "GET" and path == "/api/meta/health":
            return self._health()
        if method == "GET" and path == "/api/cb/list":
            # This broker's full QMT exposes the convertible-bond sector under
            # 沪深转债. The shorter 可转债 label is accepted but returns an empty
            # list without an error, which is a dangerous false-success.
            stocks = list(self._data.get_stock_list_in_sector("沪深转债") or [])
            if not stocks:
                raise GatewayError("Big QMT convertible-bond sector is empty")
            return {"count": len(stocks), "stocks": stocks}
        if method == "GET" and path == "/api/market/full_tick":
            stocks = split_values(query.get("stocks"))
            ticks = self._data.get_full_tick(stocks)
            return {"data": self._correct_previous_closes(ticks, stocks)}
        if method == "GET" and path == "/api/instrument/detail_list":
            stocks = split_values(query.get("stocks"))
            details = {
                code: json_safe(self._data.get_instrument_detail(code))
                for code in stocks
            }
            return {"data": details}
        if method == "GET" and path == "/api/market/market_data_ex":
            stocks = split_values(query.get("stocks"))
            fields = split_values(query.get("fields") or query.get("field_list"))
            result = self._data.get_market_data_ex(
                field_list=fields,
                stock_list=stocks,
                period=query.get("period", "1d"),
                start_time=query.get("start_time", ""),
                end_time=query.get("end_time", ""),
                count=int(query.get("count", "-1")),
                dividend_type=query.get("dividend_type", "none"),
                fill_data=parse_bool(query.get("fill_data"), True),
                use_formula=False,
                timeout_seconds=self.config.timeout_seconds,
            )
            data = json_safe(result)
            rejected: dict[str, int] = {}
            if query.get("period", "1d") == "1m" and isinstance(data, dict):
                for code, rows in data.items():
                    if not isinstance(rows, list):
                        continue
                    valid = []
                    for row in rows:
                        if suspended_placeholder(row):
                            rejected[code] = rejected.get(code, 0) + 1
                            continue
                        # QMT historical bars are labelled by their END time;
                        # the monitor's live buckets use their START time.
                        # Keep the public QMT timestamp intact for other clients.
                        timestamp = int(row.get("time") or 0)
                        if timestamp > 0:
                            row["_minute_start_ms"] = timestamp - 60_000
                        valid.append(row)
                    data[code] = valid
            payload = {"data": data}
            if rejected:
                payload["data_quality"] = {
                    "rejected_suspended_placeholders": rejected,
                    "status": "incomplete_history",
                }
            return payload
        if method == "GET" and path == "/api/calendar/is_trading_date":
            target = compact_date(query.get("date"))
            dates = self._trading_dates(query.get("market", "SH"), target, target)
            return {
                "market": query.get("market", "SH"),
                "date": target,
                "is_trading": target in dates,
            }
        if method == "GET" and path == "/api/calendar/prev_trading_date":
            target = compact_date(query.get("date"))
            dates = self._trading_dates(
                query.get("market", "SH"), "19900101", target
            )
            previous = max((value for value in dates if value < target), default="")
            return {
                "market": query.get("market", "SH"),
                "prev_trading_date": china_midnight_ms(previous) if previous else None,
            }
        if method == "GET" and path == "/api/utility/batch_stock_name":
            result = {}
            for code in split_values(query.get("stocks")):
                detail = self._data.get_instrument_detail(code) or {}
                result[code] = str(
                    detail.get("InstrumentName")
                    or detail.get("instrument_name")
                    or detail.get("name")
                    or ""
                )
            return {"data": result}
        if method == "POST" and path == "/api/download/history_data2":
            payload = body if isinstance(body, dict) else {}
            result = self._data.download_history_data2(
                split_values(payload.get("stocks")),
                payload.get("period", "1d"),
                payload.get("start_time", ""),
                payload.get("end_time", ""),
                dividend_type=payload.get("dividend_type", "none"),
            )
            return json_safe(result)
        if method == "GET" and path == "/api/trading/account_status":
            account = self._account(query)
            ping = self._client.call("ping", {}, account_id=account.account_id)
            return {
                "data": {
                    "connected": bool(ping),
                    "account_type": account.account_type,
                }
            }
        if method == "GET" and path == "/api/trading/asset":
            return {"data": json_safe(self._trader.query_stock_asset(self._account(query)))}
        if method == "GET" and path == "/api/trading/positions":
            return {
                "data": json_safe(self._trader.query_stock_positions(self._account(query)))
            }
        if method == "GET" and path == "/api/trading/orders":
            return {
                "data": json_safe(
                    self._trader.query_stock_orders(
                        self._account(query),
                        cancelable_only=parse_bool(query.get("cancelable_only"), False),
                        strategy_name=query.get("strategy_name", ""),
                    )
                )
            }
        if method == "GET" and path == "/api/trading/trades":
            return {
                "data": json_safe(
                    self._trader.query_stock_trades(
                        self._account(query), strategy_name=query.get("strategy_name", "")
                    )
                )
            }
        if method == "POST" and path == "/api/trading/order":
            if not self.config.bigqmt_orders_enabled:
                raise GatewayError(
                    "Big QMT order methods are disabled; read-only migration mode is active",
                    status=403,
                )
            payload = body if isinstance(body, dict) else {}
            account = self._account(payload)
            result = self._trader.order_stock_result(
                account,
                payload.get("stock_code", ""),
                int(payload.get("order_type", 0)),
                int(payload.get("order_volume", 0)),
                int(payload.get("price_type", 0)),
                float(payload.get("price", 0)),
                payload.get("strategy_name", "finance-board"),
                payload.get("order_remark", "finance-board"),
            )
            order_id = self._trader._order_id((result or {}).get("order_sys_id"))
            return {"data": {"order_id": int(order_id), **json_safe(result or {})}}
        if method == "POST" and path == "/api/trading/cancel":
            if not self.config.bigqmt_orders_enabled:
                raise GatewayError(
                    "Big QMT cancel methods are disabled; read-only migration mode is active",
                    status=403,
                )
            payload = body if isinstance(body, dict) else {}
            result = self._trader.cancel_order_stock(
                self._account(payload), int(payload.get("order_id", 0))
            )
            return {"data": {"cancel_result": json_safe(result)}}
        raise UnsupportedEndpoint(f"Big QMT mapping is not implemented for {method} {path}")

    def _trading_dates(self, market: str, start_time: str, end_time: str) -> list[str]:
        # Repeated calendar reads from independent panels were taking seconds
        # each and competing with live ticks on the same serialized RPC socket.
        # Calendar results are reusable for five minutes, with a separate key
        # for each market/range/day and no cached failures or empty responses.
        current = dt.datetime.now(CHINA_TIMEZONE)
        today = current.strftime("%Y%m%d")
        key = (today, market, start_time, end_time)
        if not self._calendar_lock.acquire(timeout=self.config.timeout_seconds):
            raise GatewayBusy("calendar refresh queue exceeded request timeout")
        try:
            cached = self._calendar_cache.get(key)
            if cached and time.monotonic() - cached[0] < 300.0:
                return list(cached[1])
            values = self._data.get_trading_dates(
                market, start_time=start_time, end_time=end_time, count=-1
            )
            result = sorted({value for value in map(compact_date, values or []) if value})
            # ContextInfo's calendar can omit the ongoing session even while
            # its live indices are trading. Confirm only today, using a real
            # exchange index trade; never infer holidays from the weekday.
            index = {"SH": "000001.SH", "SZ": "399001.SZ"}.get(market.upper())
            if (index and today not in result
                    and (not start_time or start_time <= today)
                    and (not end_time or today <= end_time)
                    and current.strftime("%H:%M:%S") >= "09:30:00"):
                ticks = self._data.get_full_tick([index])
                if has_current_session_trade((ticks or {}).get(index), current):
                    result = sorted([*result, today])
            if result:
                self._calendar_cache = {
                    k: v for k, v in self._calendar_cache.items()
                    if k[0] == today and time.monotonic() - v[0] < 300.0
                }
                self._calendar_cache[key] = (time.monotonic(), result)
            return list(result)
        finally:
            self._calendar_lock.release()


class BackendRouter:
    def __init__(
        self,
        config: GatewayConfig,
        bigqmt: Any | None = None,
    ):
        self.config = config
        self.backends = {"bigqmt": bigqmt or BigQmtRpcBackend(config)}
        self._lock = threading.Lock()
        self._selection_lock = threading.Lock()
        self._market_backend = "bigqmt"
        # Old persisted auto/miniqmt selections are intentionally ignored.
        self._failures = {"bigqmt": 0}
        self._last_error = {"bigqmt": ""}
        self._circuit_until = {"bigqmt": 0.0}
        self._active_market_backend = ""
        self._switch_count = 0

    def _note_success(self, name: str, *, market: bool) -> None:
        with self._lock:
            self._failures[name] = 0
            self._last_error[name] = ""
            self._circuit_until[name] = 0.0
            if (market and self._market_backend in {"auto", name}
                    and self._active_market_backend != name):
                if self._active_market_backend:
                    self._switch_count += 1
                self._active_market_backend = name

    def _note_failure(self, name: str, error: Exception) -> None:
        with self._lock:
            self._failures[name] += 1
            self._last_error[name] = f"{type(error).__name__}: {error}"[:500]
            self._circuit_until[name] = (
                time.monotonic() + self.config.circuit_cooldown_seconds
            )

    def _call_backend(
        self,
        name: str,
        method: str,
        path: str,
        query: dict[str, str],
        body: Any,
        headers: dict[str, str],
        *,
        market: bool,
    ) -> Any:
        try:
            result = self.backends[name].request(method, path, query, body, headers)
        except (UnsupportedEndpoint, GatewayBusy):
            # A missing optional API (for example sector/list during startup)
            # says nothing about the working quote connection. Do not open
            # the global market circuit for an unsupported optional endpoint.
            raise
        except Exception as error:
            self._note_failure(name, error)
            raise
        self._note_success(name, market=market)
        return result

    def request(
        self,
        method: str,
        path: str,
        query: dict[str, str],
        body: Any,
        headers: dict[str, str],
    ) -> Any:
        is_trading = path in TRADING_READ_PATHS | TRADING_WRITE_PATHS
        if is_trading:
            self._authorize(headers)
            if self.config.trading_backend == "disabled":
                raise GatewayError("账户与交易通道未启用", status=503)
            return self._call_backend(
                "bigqmt", method, path, query, body, headers, market=False,
            )
        return self._call_backend(
            "bigqmt", method, path, query, body, headers, market=True,
        )

    def _authorize(self, headers: dict[str, str]) -> None:
        if not self.config.api_key:
            return
        supplied = headers.get("x-api-key", "")
        if not hmac.compare_digest(supplied, self.config.api_key):
            raise GatewayError("invalid or missing X-API-Key", status=401)

    def select_market_backend(self, body: Any, headers: dict[str, str]) -> dict[str, Any]:
        self._authorize(headers)
        if not isinstance(body, dict) or set(body) != {"market_backend"}:
            raise GatewayError("only market_backend may be changed", status=400)
        selected = body["market_backend"]
        if not isinstance(selected, str) or selected not in SUPPORTED_BACKENDS:
            raise GatewayError("仅支持大 QMT 行情源", status=400)
        with self._selection_lock:
            # Probe real quotes without changing the current route. A 200 or
            # connected=true is insufficient. Failed selection is atomic.
            candidates = ["bigqmt"]
            active = ""
            for candidate in candidates:
                try:
                    probe_quotes = getattr(self.backends[candidate], "probe_quotes", None)
                    payload = probe_quotes(["000001.SH", "123247.SZ"]) if probe_quotes else self.backends[candidate].request(
                        "GET", "/api/market/full_tick", {"stocks": "000001.SH,123247.SZ"}, None, headers,
                    )
                    ticks = payload.get("data", {}) if isinstance(payload, dict) else {}
                    if not all(
                        isinstance(ticks.get(code), dict)
                        and float(ticks[code].get("lastPrice") or 0) > 0
                        for code in ("000001.SH", "123247.SZ")
                    ):
                        raise GatewayError("empty quote response")
                    active = candidate
                    break
                except Exception:
                    continue
            if not active:
                label = "大 QMT"
                raise GatewayError(f"{label}未返回有效行情，请确认客户端及行情服务已启动；已保留原行情源", status=503)
            if self.config.market_selection_path:
                target = Path(self.config.market_selection_path)
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_suffix(".tmp")
                temporary.write_text(json.dumps({"market_backend": selected}), encoding="utf-8")
                temporary.replace(target)
            with self._lock:
                self._market_backend = selected
            self._note_success(active, market=True)
            return self.status()

    def status(self) -> dict[str, Any]:
        remaining = {
            name: max(0.0, until - time.monotonic())
            for name, until in self._circuit_until.items()
        }
        backfill_status = getattr(
            self.backends.get("bigqmt"),
            "previous_close_backfill_status",
            lambda: {"pending": 0, "completed": 0, "last_error": None},
        )()
        raw_reference_status = getattr(
            self.backends.get("bigqmt"),
            "raw_previous_close_status",
            lambda: {
                "status": "unknown",
                "date": None,
                "checked_codes": 0,
                "mismatched_codes": 0,
                "mismatch_ratio": 0.0,
                "restart_recommended": False,
                "last_checked_at": None,
                "method": None,
            },
        )()
        return {
            "status": "ok",
            "mode": "bigqmt_gateway",
            "market": {
                "configured": self._market_backend,
                "active": self._active_market_backend or None,
                "switch_count": self._switch_count,
                "automatic_failover": False,
                "available": ["bigqmt"],
                "previous_close_backfill": backfill_status,
                "bigqmt_reference_data": raw_reference_status,
            },
            "trading": {
                "configured": self.config.trading_backend,
                "automatic_failover": False,
                "bigqmt_order_methods_enabled": self.config.bigqmt_orders_enabled,
            },
            "backends": {
                name: {
                    "failures": self._failures[name],
                    "last_error": self._last_error[name] or None,
                    "circuit_open_seconds": round(remaining[name], 3),
                }
                for name in ("bigqmt",)
            },
        }


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = "FinanceQmtGateway/1.0"

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        query = {
            key: values[-1]
            for key, values in urllib.parse.parse_qs(
                parsed.query, keep_blank_values=True
            ).items()
        }
        headers = {key.lower(): value for key, value in self.headers.items()}
        body = None
        if method == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > 2 * 1024 * 1024:
                    raise GatewayError("request body is too large", status=413)
                body = json.loads(self.rfile.read(length) or b"{}")
            except GatewayError as error:
                self._write_error(error)
                return
            except Exception:
                self._write_error(GatewayError("invalid JSON body", status=400))
                return
        try:
            if method == "GET" and parsed.path == "/api/meta/qmt-backends":
                payload = self.server.router.status()  # type: ignore[attr-defined]
            elif method == "POST" and parsed.path == "/api/meta/qmt-backends":
                if self.client_address[0] not in {"127.0.0.1", "::1"}:
                    raise GatewayError("market selection requires a local request", status=403)
                payload = self.server.router.select_market_backend(body, headers)
            else:
                payload = self.server.router.request(  # type: ignore[attr-defined]
                    method, parsed.path, query, body, headers
                )
            self._write_json(HTTPStatus.OK, payload)
        except UpstreamHttpError as error:
            self._write_json(error.status, error.payload)
        except GatewayError as error:
            self._write_error(error)
        except Exception as error:
            self._write_error(GatewayError(f"{type(error).__name__}: {error}"))

    def _write_error(self, error: GatewayError) -> None:
        self._write_json(error.status, {"detail": str(error), "status": "error"})

    def _write_json(self, status: int | HTTPStatus, payload: Any) -> None:
        data = json.dumps(json_safe(payload), ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionError, TimeoutError):
            # The caller has already gone away; a second error response cannot
            # reach it and only generates another traceback.
            self.close_connection = True

    def log_message(self, format_string: str, *args: Any) -> None:
        # BaseHTTPRequestHandler's default message includes self.path, including
        # query parameters. Log only the route so account ids, API keys and
        # request bodies can never enter the gateway log.
        route = urllib.parse.urlsplit(self.path).path
        status = str(args[1]) if len(args) > 1 else "-"
        print(
            f"[{self.log_date_time_string()}] {self.client_address[0]} "
            f"{self.command} {route} {status}"
        )


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self, address: tuple[str, int], router: BackendRouter, *,
        max_active_requests: int = 32, request_timeout_seconds: float = 15.0,
    ):
        self._request_slots = threading.BoundedSemaphore(max_active_requests)
        self.request_timeout_seconds = request_timeout_seconds
        super().__init__(address, GatewayHandler)
        self.router = router

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(self.request_timeout_seconds)
        return request, address

    def process_request(self, request, client_address):
        if not self._request_slots.acquire(blocking=False):
            # Reject before starting a thread. Blocking admission would retain
            # the same sockets that exhausted the launchd file-descriptor limit.
            body = b'{"detail":"QMT gateway busy; retry later","status":"error"}'
            try:
                request.settimeout(0.1)
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Type: application/json; charset=utf-8\r\n"
                    b"Connection: close\r\nRetry-After: 1\r\n"
                    b"Content-Length: " + str(len(body)).encode("ascii")
                    + b"\r\n\r\n" + body
                )
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--env-file", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    config = GatewayConfig.from_env(args.host, args.port)
    if config.host not in {"127.0.0.1", "localhost", "::1"} and not env_bool(
        "FINANCE_QMT_ALLOW_REMOTE_GATEWAY", False
    ):
        raise SystemExit(
            "refusing a non-loopback bind; set FINANCE_QMT_ALLOW_REMOTE_GATEWAY=1 explicitly"
        )
    server = GatewayServer((config.host, config.port), BackendRouter(config))
    print(
        "Finance QMT gateway listening on %s:%s; market=%s trading=%s bigqmt_orders=%s"
        % (
            config.host,
            config.port,
            config.market_backend,
            config.trading_backend,
            "enabled" if config.bigqmt_orders_enabled else "disabled",
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
