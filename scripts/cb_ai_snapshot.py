#!/usr/bin/env python3
"""Read existing Finance Board data for AI research; never starts QMT or writes its databases."""
from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
MONITOR_ROOT = Path(os.environ.get(
    "MINIQMT_MONITOR_ROOT",
    "/Users/seasnake/Documents/Codex/2026-07-27/miniqmt/outputs/miniqmt_cb_shortline_monitor",
)).expanduser()
MONITOR_RUNTIME = Path(os.environ.get("MINIQMT_RUNTIME_ROOT", MONITOR_ROOT / "runtime"))
CHINA = ZoneInfo("Asia/Shanghai")


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {} if default is None else default


def number(value):
    if value is None or isinstance(value, bool) or value == "":
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def connect(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=3)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def market_minute(clock):
    return "09:30" <= clock <= "11:30" or "13:00" <= clock <= "15:00"


def load_indicator_module():
    path = MONITOR_ROOT / "shortline_monitor.py"
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("cb_ai_indicator_source", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_master(code, as_of):
    path = Path(os.environ.get("MINIQMT_REDEEM_STATUS_DATABASE_PATH", ROOT / "runtime/convertible-bond-market.sqlite3"))
    result = {"instrument": {}, "daily": [], "redeem": {}, "errors": []}
    if not path.exists():
        result["errors"].append("本地日线与条款数据库不存在")
        return result
    try:
        with closing(connect(path)) as conn:
            row = conn.execute("SELECT * FROM instruments WHERE code=?", (code,)).fetchone()
            result["instrument"] = dict(row) if row else {}
            rows = conn.execute(
                "SELECT * FROM daily_bars WHERE code=? AND trade_date<=? AND adjustment='none' ORDER BY trade_date DESC LIMIT 160",
                (code, as_of),
            ).fetchall()
            for row in reversed(rows):
                result["daily"].append({
                    "date": row["trade_date"], "open": row["open"], "high": row["high"],
                    "low": row["low"], "close": row["close"], "volume_lots": row["volume"],
                    "amount_yuan": row["amount"], "previous_close": row["pre_close"],
                    "suspend": row["suspend_flag"], "source": row["source"],
                    "source_fetched_at": row["ingested_at"], "quality": "qmt_daily_none", "adjustment": "none",
                })
            try:
                # This table contains latest observations only, not a historical time series.
                row = conn.execute("SELECT * FROM redeem_status_observations WHERE code=? AND trade_date<=?", (code.split(".")[0], as_of)).fetchone()
                if row:
                    result["redeem"] = {k: row[k] for k in row.keys() if k != "raw_json"}
            except sqlite3.Error:
                result["errors"].append("本地强赎观察不可用")
    except (OSError, sqlite3.Error) as exc:
        result["errors"].append(f"本地日线/条款读取失败：{type(exc).__name__}")
    return result


def load_snapshot(code, as_of="", days=5, now=None):
    if not re.fullmatch(r"(?:110|111|113|118)\d{3}\.SH|(?:123|127|128)\d{3}\.SZ", code):
        raise ValueError("仅支持沪深公开可转债代码")
    now = now or datetime.now(CHINA)
    today = now.strftime("%Y%m%d")
    if as_of and (not re.fullmatch(r"\d{8}", as_of) or as_of > today):
        raise ValueError("分析日期无效或晚于今天")
    if as_of:
        datetime.strptime(as_of, "%Y%m%d")
    days = max(1, min(5, int(days)))
    files = sorted((MONITOR_RUNTIME / "data").glob("????????.sqlite3"), reverse=True)
    files = [p for p in files if re.fullmatch(r"\d{8}", p.stem) and p.stem <= today]
    quote_data = read_json(ROOT / "runtime/board-quote-snapshot.json")
    quotes = quote_data.get("quotes", [])
    quote = next((q for q in quotes if q.get("monitor_code") == code or q.get("code") == code[:6]), {})
    quote_date = re.sub(r"\D", "", str(quote.get("date") or ""))[:8]
    as_of = as_of or max([p.stem for p in files[:1]] + ([quote_date] if len(quote_date) == 8 and quote_date <= today else []) + [today if not files else ""])
    files = [p for p in files if p.stem <= as_of][:125]
    selected_dates = [p.stem for p in files[:days]]
    reference_daily = []
    sessions = []
    errors = []
    try:
        indicator_module = load_indicator_module()
    except Exception:
        indicator_module = None
        errors.append("现有分钟指标模块不可用，保留原始价格与成交额")
    current_minute = int(now.replace(second=0, microsecond=0).timestamp() * 1000)
    for file in reversed(files):
        try:
            with closing(connect(file)) as conn:
                raw = conn.execute(
                    "SELECT minute_ms,minute_time,open,high,low,close,amount FROM minute_observations WHERE trading_date=? AND code=? ORDER BY minute_ms",
                    (file.stem, code),
                ).fetchall()
                rows = []
                for r in raw:
                    clock = str(r["minute_time"])[11:16]
                    if not market_minute(clock) or r["minute_ms"] >= current_minute:
                        continue
                    if not all((number(r[k]) or 0) > 0 for k in ("open", "high", "low", "close")):
                        continue
                    rows.append({
                        "minute_ms": r["minute_ms"], "time": clock,
                        "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"],
                        "amount_yuan": max(0, number(r["amount"])) if number(r["amount"]) is not None else None,
                    })
                if not rows:
                    continue
                last_expected = 900 if file.stem < today else min(900, now.hour * 60 + now.minute - 1)
                expected = {f"{m // 60:02d}:{m % 60:02d}" for m in range(571, last_expected + 1) if m <= 690 or m >= 781}
                reference_daily.append({
                    "date": file.stem, "open": rows[0]["open"],
                    "high": max(r["high"] for r in rows), "low": min(r["low"] for r in rows),
                    "close": rows[-1]["close"], "volume_lots": None,
                    "amount_yuan": sum(r["amount_yuan"] for r in rows) if all(r["amount_yuan"] is not None for r in rows) else None,
                    "bar_count": len(rows), "missing_bars": len(expected - {r["time"] for r in rows}),
                    "source": "本地监控分钟聚合", "quality": "minute_aggregate", "adjustment": "none",
                    "last_minute": rows[-1]["time"], "source_fetched_at": datetime.fromtimestamp(file.stat().st_mtime, CHINA).isoformat(),
                })
                if file.stem not in selected_dates:
                    continue
                events = []
                try:
                    events = [dict(r) for r in conn.execute(
                        "SELECT event_time_ms,event_time,event_type,direction,price,confidence FROM qmt_events WHERE trading_date=? AND code=? AND event_time_ms<? ORDER BY event_time_ms DESC LIMIT 40",
                        (file.stem, code, current_minute),
                    )]
                except sqlite3.Error:
                    pass
            indicators = {}
            if indicator_module:
                minutes = [indicator_module.MinuteBucket(
                    minute_ms=r["minute_ms"], open=r["open"], high=r["high"], low=r["low"], close=r["close"], amount=r["amount_yuan"] or 0,
                ) for r in rows]
                indicators = indicator_module.compute_indicator_series(minutes)
            cumulative_amount = 0.0
            estimated_units = 0.0
            amount_complete = True
            for i, r in enumerate(rows):
                amount_complete = amount_complete and r["amount_yuan"] is not None
                cumulative_amount += r["amount_yuan"] or 0
                estimated_units += (r["amount_yuan"] or 0) / r["close"]
                r["average_approx"] = cumulative_amount / estimated_units if amount_complete and estimated_units > 0 else None
                for key in ("purple", "purple_ma27", "dif", "dea", "macd"):
                    r[key] = number(indicators.get(key, [None] * len(rows))[i])
            sessions.append({
                "date": file.stem, "source": "本地监控 minute_observations", "rows": rows,
                "events": list(reversed(events)), "source_fetched_at": datetime.fromtimestamp(file.stat().st_mtime, CHINA).isoformat(),
                "indicator_source": "现有 shortline_monitor.compute_indicator_series" if indicators else "unavailable",
                "indicator_warmup": "按当日已有分钟递推，与个债页面公式一致；早盘预热可能不足",
                "average_quality": "estimated_from_minute_amount_and_close",
            })
        except (OSError, sqlite3.Error) as exc:
            errors.append(f"{file.stem} 分钟读取失败：{type(exc).__name__}")

    master = load_master(code, as_of)
    errors.extend(master["errors"])
    daily_by_date = {r["date"]: r for r in master["daily"]}
    # Keep native 1d bars; aggregated additions carry row-level provenance.
    for r in reference_daily:
        daily_by_date.setdefault(r["date"], r)
    daily = sorted(daily_by_date.values(), key=lambda r: r["date"])[-120:]
    source = read_json(ROOT / "data/convertible-bond-tag-source.json")
    values = source.get("values", [])
    terms = {}
    if values:
        raw = next((r for r in values[1:] if r and str(r[0]) == code), None)
        if raw:
            terms = dict(zip(values[0], raw))
    tags = read_json(ROOT / "data/convertible-bond-tags.json")
    tag = next((r for r in tags.get("rows", []) if r.get("code") == code), {})
    instrument = master["instrument"]
    stock_code = instrument.get("stock_code") or tag.get("stockCode") or str(terms.get("正股代码") or "")
    if re.fullmatch(r"\d{6}", stock_code):
        stock_code += ".SH" if stock_code.startswith("6") else ".SZ"
    stock_quote = next((q for q in quotes if q.get("monitor_code") == stock_code or q.get("code") == stock_code[:6]), {})
    lifecycle_data = read_json(ROOT / "runtime/convertible-bond-lifecycle.json")
    lifecycle = lifecycle_data.get("bonds", {}).get(code, {})
    # Snapshot terms are intentionally kept separate from prices and their as-of dates.
    term_snapshot = {
        "source": "本地转债条款表", "as_of": str(terms.get("QMT行情时间") or "")[:8] or None,
        "conversion_price": number(terms.get("转股价")), "maturity_date": terms.get("到期日期") or instrument.get("expire_date") or None,
        "maturity_redemption_price": number(terms.get("到期赎回价")),
        "conversion_start_date": terms.get("开始转股日"), "listing_date": terms.get("上市日期") or instrument.get("listing_date"),
        "issue_scale_billion": number(terms.get("发行规模_亿元")) or number(instrument.get("issue_scale_billion")),
        "rating": terms.get("信用评级") or instrument.get("rating") or None,
        "put_trigger_price": number(terms.get("回售触发价")), "redeem_trigger_price": number(terms.get("强赎触发价")),
        "remaining_face_value_yuan": None,
    }
    return {
        "code": code, "name": instrument.get("name") or tag.get("name") or terms.get("转债简称") or code,
        "stock_code": stock_code, "stock_name": instrument.get("stock_name") or tag.get("stockName") or terms.get("正股简称") or "",
        "date": as_of, "requested_days": days, "generated_at": now.isoformat(),
        "available_dates": sorted({p.stem for p in files}, reverse=True),
        "daily": daily, "reference_daily": reference_daily, "sessions": sessions,
        "quote": quote, "stock_quote": stock_quote, "quote_backend": quote_data.get("quote_backend"),
        "terms": term_snapshot, "redeem": master["redeem"], "lifecycle": lifecycle,
        "tags": tag.get("tags", []), "tags_as_of": tags.get("asOf"),
        "monitor_status": read_json(MONITOR_RUNTIME / "status.json").get("status", "unknown"),
        "errors": errors,
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = load_snapshot(str(request.get("code") or ""), str(request.get("date") or ""), request.get("days", 5))
        json.dump(result, sys.stdout, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
