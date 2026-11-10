"""Guarded manual trading for the local finance board.

The guard never selects an account by raw id from browser input. It accepts an
account label, validates against the configured account list, creates a short
lived preview, and consumes that preview exactly once before calling QMT.
"""

from __future__ import annotations

import json
import math
import secrets
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

CHINA_TIME_ZONE = ZoneInfo("Asia/Shanghai")


UNLOCK_PHRASE = "开启实盘交易"
BOND_PREFIXES = ("110", "111", "113", "118", "123", "127", "128")
SH_BOND_PREFIXES = ("110", "111", "113", "118")
CANCELABLE_STATUSES = {48, 49, 50, 51, 52, 53, 55}


class TradingError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _number(value: Any) -> float:
    try:
        number = float(value or 0)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _integer(value: Any) -> int:
    return int(_number(value))


def _pick(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row.get(key)
    return default


def normalize_market_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    if len(text) == 9 and text[6:] in {".SH", ".SZ"} and text[:6].isdigit():
        return text
    digits = "".join(character for character in text if character.isdigit())[:6]
    if len(digits) != 6:
        raise TradingError("请输入有效的6位证券代码")
    if digits.startswith(SH_BOND_PREFIXES) or digits.startswith(("5", "6", "9")):
        return f"{digits}.SH"
    return f"{digits}.SZ"


class TradingGuard:
    def __init__(
        self,
        *,
        audit_path: Path,
        max_order_amount: float = 20_000,
        max_price_deviation: float = 0.05,
        session_ttl_seconds: int = 600,
        preview_ttl_seconds: int = 30,
        clock: Callable[[], float] = time.time,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        self.audit_path = audit_path
        self.max_order_amount = float(max_order_amount)
        self.max_price_deviation = float(max_price_deviation)
        self.session_ttl_seconds = int(session_ttl_seconds)
        self.preview_ttl_seconds = int(preview_ttl_seconds)
        self.clock = clock
        self.token_factory = token_factory or (lambda: secrets.token_urlsafe(24))
        self.sessions: dict[str, float] = {}
        self.previews: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def capabilities(self) -> dict[str, Any]:
        return {
            "ok": True,
            "mode": "guarded_live",
            "unlock_phrase": UNLOCK_PHRASE,
            "session_ttl_seconds": self.session_ttl_seconds,
            "preview_ttl_seconds": self.preview_ttl_seconds,
            "limit_orders_only": True,
            "max_order_amount": self.max_order_amount,
            "max_price_deviation_pct": self.max_price_deviation * 100,
            "execution_hours": "工作日 09:20–11:30、13:00–15:00",
        }

    def unlock(self, phrase: Any) -> dict[str, Any]:
        if str(phrase or "").strip() != UNLOCK_PHRASE:
            raise TradingError("解锁确认语不正确", 403)
        token = self.token_factory()
        expires_at = self.clock() + self.session_ttl_seconds
        with self.lock:
            self._cleanup_locked()
            self.sessions[token] = expires_at
        self._audit("unlock", "accepted", request_id=uuid.uuid4().hex)
        return {
            "ok": True,
            "session_token": token,
            "expires_at": int(expires_at * 1000),
            "expires_in_seconds": self.session_ttl_seconds,
        }

    def preview_order(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        self._require_session(body.get("session_token"))
        candidate = self._validate_order(body, accounts, bridge_get)
        side_name = "买入" if candidate["order_type"] == 23 else "卖出"
        unit_name = "张" if candidate["is_bond"] else "股"
        confirmation = (
            f"确认{side_name} {candidate['name']} {candidate['stock_code']} "
            f"{candidate['order_volume']}{unit_name} 限价{candidate['price']:.3f}"
        )
        preview_token = self.token_factory()
        request_id = uuid.uuid4().hex
        expires_at = self.clock() + self.preview_ttl_seconds
        stored = {
            **candidate,
            "kind": "order",
            "request_id": request_id,
            "confirmation": confirmation,
            "expires_at": expires_at,
            "consumed": False,
        }
        with self.lock:
            self._cleanup_locked()
            self.previews[preview_token] = stored
        self._audit("order_preview", "created", request_id=request_id, item=stored)
        return {
            "ok": True,
            "preview_token": preview_token,
            "expires_at": int(expires_at * 1000),
            "confirmation": confirmation,
            "order": self._public_order(stored),
            "checks": stored["checks"],
        }

    def execute_order(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
        bridge_post: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        self._require_session(body.get("session_token"))
        preview = self._consume_preview(
            body.get("preview_token"),
            kind="order",
            confirmation=body.get("confirmation"),
        )
        self._require_execution_window()
        recheck = self._validate_order(preview, accounts, bridge_get)
        request_id = preview["request_id"]
        payload = {
            "stock_code": recheck["stock_code"],
            "order_type": recheck["order_type"],
            "order_volume": recheck["order_volume"],
            "price_type": 11,
            "price": recheck["price"],
            "strategy_name": "finance-board-manual",
            "order_remark": f"finance-board:{request_id[:12]}",
            "account_id": recheck["account_id"],
        }
        self._audit("order_execute", "submitting", request_id=request_id, item=recheck)
        try:
            result = bridge_post("/api/trading/order", payload)
        except Exception:
            self._audit("order_execute", "unknown", request_id=request_id, item=recheck)
            raise TradingError("提交结果未知，请先刷新今日委托核对，禁止直接重复下单", 502)
        order_id = _integer(_pick(result if isinstance(result, dict) else {}, "order_id", "data"))
        self._audit(
            "order_execute",
            "submitted",
            request_id=request_id,
            item={**recheck, "order_id": order_id},
        )
        return {
            "ok": True,
            "status": "submitted",
            "order_id": order_id or None,
            "request_id": request_id,
            "message": "委托已提交，请以今日委托和成交回报为准",
        }

    def preview_cancel(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        self._require_session(body.get("session_token"))
        candidate = self._validate_cancel(body, accounts, bridge_get)
        confirmation = (
            f"确认撤单 {candidate['name']} {candidate['stock_code']} "
            f"委托{candidate['order_id']}"
        )
        preview_token = self.token_factory()
        request_id = uuid.uuid4().hex
        expires_at = self.clock() + self.preview_ttl_seconds
        stored = {
            **candidate,
            "kind": "cancel",
            "request_id": request_id,
            "confirmation": confirmation,
            "expires_at": expires_at,
            "consumed": False,
        }
        with self.lock:
            self._cleanup_locked()
            self.previews[preview_token] = stored
        self._audit("cancel_preview", "created", request_id=request_id, item=stored)
        return {
            "ok": True,
            "preview_token": preview_token,
            "expires_at": int(expires_at * 1000),
            "confirmation": confirmation,
            "order": self._public_order(stored),
        }

    def execute_cancel(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
        bridge_post: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        self._require_session(body.get("session_token"))
        preview = self._consume_preview(
            body.get("preview_token"),
            kind="cancel",
            confirmation=body.get("confirmation"),
        )
        self._require_execution_window()
        candidate = self._validate_cancel(preview, accounts, bridge_get)
        request_id = preview["request_id"]
        self._audit("cancel_execute", "submitting", request_id=request_id, item=candidate)
        try:
            result = bridge_post(
                "/api/trading/cancel",
                {"order_id": candidate["order_id"], "account_id": candidate["account_id"]},
            )
        except Exception:
            self._audit("cancel_execute", "unknown", request_id=request_id, item=candidate)
            raise TradingError("撤单结果未知，请刷新今日委托核对，禁止直接重复撤单", 502)
        self._audit("cancel_execute", "submitted", request_id=request_id, item=candidate)
        return {
            "ok": True,
            "status": "submitted",
            "request_id": request_id,
            "message": "撤单请求已提交，请刷新今日委托确认最终状态",
            "result": self._sanitize_result(result),
        }

    def _validate_order(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        account = self._account_by_label(accounts, body.get("account") or body.get("account_label"))
        stock_code = normalize_market_code(body.get("stock_code"))
        side = str(body.get("side") or "").strip().lower()
        order_type = _integer(body.get("order_type"))
        if side in {"buy", "买入"}:
            order_type = 23
        elif side in {"sell", "卖出"}:
            order_type = 24
        if order_type not in {23, 24}:
            raise TradingError("交易方向只能是买入或卖出")
        volume = _integer(body.get("order_volume") or body.get("volume"))
        if volume <= 0:
            raise TradingError("委托数量必须大于0")
        is_bond = stock_code.startswith(BOND_PREFIXES)
        if is_bond and volume % 10:
            raise TradingError("可转债委托数量必须是10张的整数倍")
        price = round(_number(body.get("price")), 3)
        if price <= 0:
            raise TradingError("限价必须大于0")
        amount = price * volume
        if amount > self.max_order_amount + 1e-6:
            raise TradingError(f"单笔金额不得超过{self.max_order_amount:,.0f}元")

        params = {"account_id": account["id"]}
        typed_params = dict(params)
        if account.get("type"):
            typed_params["account_type"] = account["type"]
        status = bridge_get("/api/trading/account_status", params)
        if not isinstance(status, dict) or not status.get("connected"):
            raise TradingError("QMT交易账户未连接", 503)
        asset = bridge_get("/api/trading/asset", typed_params)
        positions = bridge_get("/api/trading/positions", typed_params)
        ticks = bridge_get("/api/market/full_tick", {"stocks": stock_code})
        tick = (ticks or {}).get(stock_code) if isinstance(ticks, dict) else None
        if not isinstance(tick, dict):
            raise TradingError("未取得标的实时行情，不能生成实盘委托", 503)
        last_price = _number(tick.get("lastPrice"))
        if last_price <= 0:
            raise TradingError("标的当前无有效价格，不能生成实盘委托")
        deviation = abs(price / last_price - 1)
        if deviation > self.max_price_deviation:
            raise TradingError(
                f"限价偏离现价{deviation * 100:.2f}%，超过{self.max_price_deviation * 100:.0f}%限制"
            )
        up_limit = _number(tick.get("upStopPrice"))
        down_limit = _number(tick.get("downStopPrice"))
        if up_limit > 0 and price > up_limit + 1e-6:
            raise TradingError("限价高于涨停价")
        if down_limit > 0 and price < down_limit - 1e-6:
            raise TradingError("限价低于跌停价")

        cash = _number(_pick(asset if isinstance(asset, dict) else {}, "cash", "m_dCash"))
        available = 0
        position_rows = positions if isinstance(positions, list) else []
        for position in position_rows:
            code = str(_pick(position, "stock_code", "m_strStockCode", default="") or "")
            if code == stock_code:
                available += _integer(_pick(position, "can_use_volume", "m_nCanUseVolume"))
        if order_type == 23:
            reserve = max(5.0, amount * 0.001)
            if cash + 1e-6 < amount + reserve:
                raise TradingError("可用资金不足，已包含手续费安全余量")
            if not is_bond and volume % 100:
                raise TradingError("A股买入数量必须是100股的整数倍")
        else:
            if volume > available:
                raise TradingError(f"可卖数量不足，当前可卖{available}")
            if not is_bond and volume != available and volume % 100:
                raise TradingError("A股部分卖出数量必须是100股的整数倍")

        name = stock_code
        try:
            names = bridge_get("/api/utility/batch_stock_name", {"stocks": stock_code})
            if isinstance(names, dict):
                name = str(names.get(stock_code) or stock_code)
        except Exception:
            pass
        return {
            "account_id": account["id"],
            "account_label": account["label"],
            "stock_code": stock_code,
            "name": name,
            "order_type": order_type,
            "side": "买入" if order_type == 23 else "卖出",
            "order_volume": volume,
            "price_type": 11,
            "price": price,
            "amount": amount,
            "is_bond": is_bond,
            "checks": {
                "last_price": last_price,
                "price_deviation_pct": deviation * 100,
                "cash": cash,
                "available_volume": available,
                "max_order_amount": self.max_order_amount,
            },
        }

    def _validate_cancel(
        self,
        body: dict[str, Any],
        accounts: list[dict[str, str]],
        bridge_get: Callable[[str, dict[str, Any]], Any],
    ) -> dict[str, Any]:
        account = self._account_by_label(accounts, body.get("account") or body.get("account_label"))
        order_id = _integer(body.get("order_id"))
        if order_id <= 0:
            raise TradingError("缺少有效委托编号")
        params: dict[str, Any] = {"account_id": account["id"], "cancelable_only": "true"}
        if account.get("type"):
            params["account_type"] = account["type"]
        rows = bridge_get("/api/trading/orders", params)
        target: dict[str, Any] | None = None
        for row in rows if isinstance(rows, list) else []:
            candidate_id = _integer(_pick(row, "order_id", "m_nOrderID"))
            if candidate_id == order_id:
                target = row
                break
        if target is None:
            raise TradingError("该委托当前不可撤，可能已成交或已撤销", 409)
        stock_code = str(_pick(target, "stock_code", "m_strStockCode", default="") or "")
        name = str(_pick(target, "instrument_name", "m_strInstrumentName", default=stock_code) or stock_code)
        order_type = _integer(_pick(target, "order_type", "m_nOrderType"))
        return {
            "account_id": account["id"],
            "account_label": account["label"],
            "order_id": order_id,
            "stock_code": stock_code,
            "name": name,
            "side": "买入" if order_type == 23 else "卖出" if order_type == 24 else "其他",
            "price": _number(_pick(target, "price", "m_dPrice")),
            "order_volume": _integer(_pick(target, "order_volume", "m_nOrderVolume")),
            "traded_volume": _integer(_pick(target, "traded_volume", "m_nTradedVolume")),
        }

    def _account_by_label(self, accounts: list[dict[str, str]], label: Any) -> dict[str, str]:
        requested = str(label or "").strip()
        if not requested and len(accounts) == 1:
            return accounts[0]
        for account in accounts:
            if account.get("label") == requested:
                return account
        raise TradingError("请选择有效交易账户")

    def _require_session(self, token: Any) -> None:
        key = str(token or "")
        with self.lock:
            self._cleanup_locked()
            expires_at = self.sessions.get(key, 0)
        if not key or expires_at <= self.clock():
            raise TradingError("交易会话未解锁或已过期，请重新解锁", 423)

    def _consume_preview(self, token: Any, *, kind: str, confirmation: Any) -> dict[str, Any]:
        key = str(token or "")
        with self.lock:
            self._cleanup_locked()
            preview = self.previews.get(key)
            if not preview:
                raise TradingError("预览令牌不存在或已过期", 410)
            if preview.get("consumed"):
                raise TradingError("该预览已经使用，禁止重复提交", 409)
            if preview.get("kind") != kind:
                raise TradingError("预览类型不匹配", 409)
            if str(confirmation or "") != preview.get("confirmation"):
                raise TradingError("二次确认语不完全一致", 403)
            preview["consumed"] = True
            return dict(preview)

    def _cleanup_locked(self) -> None:
        now = self.clock()
        self.sessions = {token: expiry for token, expiry in self.sessions.items() if expiry > now}
        self.previews = {
            token: preview
            for token, preview in self.previews.items()
            if float(preview.get("expires_at") or 0) > now
        }

    def _require_execution_window(self) -> None:
        moment = datetime.fromtimestamp(self.clock(), CHINA_TIME_ZONE)
        if moment.weekday() >= 5:
            raise TradingError("非交易日禁止提交实盘委托", 409)
        minute = moment.hour * 60 + moment.minute
        if not (9 * 60 + 20 <= minute <= 11 * 60 + 30 or 13 * 60 <= minute <= 15 * 60):
            raise TradingError("当前不在允许下单时段（09:20–11:30、13:00–15:00）", 409)

    def _public_order(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            key: item.get(key)
            for key in (
                "account_label",
                "stock_code",
                "name",
                "side",
                "order_volume",
                "price",
                "amount",
                "order_id",
                "traded_volume",
            )
            if item.get(key) is not None
        }

    def _sanitize_result(self, result: Any) -> dict[str, Any]:
        if not isinstance(result, dict):
            return {"status": "submitted"}
        allowed = {"status", "order_id", "cancel_result", "message"}
        return {key: value for key, value in result.items() if key in allowed}

    def _audit(
        self,
        action: str,
        status: str,
        *,
        request_id: str,
        item: dict[str, Any] | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "time": datetime.fromtimestamp(self.clock()).isoformat(timespec="seconds"),
            "action": action,
            "status": status,
            "request_id": request_id,
        }
        if item:
            for key in ("stock_code", "name", "side", "order_volume", "price", "amount", "order_id"):
                if item.get(key) is not None:
                    row[key] = item.get(key)
        try:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        except OSError:
            pass
