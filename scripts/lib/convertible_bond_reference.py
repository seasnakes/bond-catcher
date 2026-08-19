"""Point-in-time convertible-bond reference data.

The finance board already uses the Eastmoney RPT_BOND_CB_LIST table to find
new listings.  This module applies the same source to the complete lifecycle
universe so a local data store can add new bonds without waiting for MiniQMT's
sector list to roll forward.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Callable


CODE_PATTERN = re.compile(r"^(110|111|113|118|123|127|128)\d{3}$")
EASTMONEY_ENDPOINT = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def compact_date(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:8] if len(digits) >= 8 else ""


def market_code(code: str) -> str:
    exchange = "SH" if str(code).startswith(("110", "111", "113", "118")) else "SZ"
    return f"{code}.{exchange}"


def secid(code: str) -> str:
    return f"{'1' if market_code(code).endswith('.SH') else '0'}.{code}"


def stock_market_code(code: Any) -> str:
    bare = re.sub(r"\D", "", str(code or ""))[:6]
    if len(bare) != 6:
        return ""
    return f"{bare}.{'SH' if bare.startswith(('5', '6', '9')) else 'SZ'}"


def finite_or_none(value: Any) -> float | None:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


def fetch_json(url: str, timeout: float = 15.0) -> dict[str, Any]:
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


def fetch_reference_rows(
    *,
    timeout: float = 15.0,
    page_size: int = 500,
    loader: Callable[[str, float], dict[str, Any]] = fetch_json,
) -> list[dict[str, Any]]:
    """Fetch and normalize the complete bond reference table."""
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    page = 1
    while True:
        url = EASTMONEY_ENDPOINT + "?" + urllib.parse.urlencode(
            {
                "reportName": "RPT_BOND_CB_LIST",
                "columns": "ALL",
                "pageNumber": str(page),
                "pageSize": str(page_size),
                "sortColumns": "LISTING_DATE",
                "sortTypes": "-1",
            }
        )
        payload = loader(url, timeout)
        result = payload.get("result") or {}
        rows = list(result.get("data") or [])
        for row in rows:
            code = re.sub(r"\D", "", str(row.get("SECURITY_CODE") or ""))[:6]
            listing_date = compact_date(row.get("LISTING_DATE"))
            if not CODE_PATTERN.fullmatch(code) or len(listing_date) != 8 or code in seen:
                continue
            seen.add(code)
            normalized.append(
                {
                    "code": market_code(code),
                    "bare_code": code,
                    "secid": secid(code),
                    "name": str(row.get("SECURITY_NAME_ABBR") or "").strip(),
                    "stock_code": stock_market_code(row.get("CONVERT_STOCK_CODE")),
                    "stock_name": str(row.get("SECURITY_SHORT_NAME") or "").strip(),
                    "listing_date": listing_date,
                    "delist_date": compact_date(row.get("DELIST_DATE")),
                    "expire_date": compact_date(row.get("EXPIRE_DATE")),
                    "issue_scale_billion": finite_or_none(row.get("ACTUAL_ISSUE_SCALE")),
                    "rating": str(row.get("RATING") or "").strip(),
                    "source": "eastmoney:RPT_BOND_CB_LIST",
                }
            )
        pages = int(result.get("pages") or 0)
        if not rows or len(rows) < page_size or (pages and page >= pages):
            break
        page += 1
    return normalized


def active_reference_rows(
    rows: list[dict[str, Any]], as_of: str
) -> list[dict[str, Any]]:
    target = compact_date(as_of)
    if len(target) != 8:
        raise ValueError("as_of must be YYYYMMDD")
    active = []
    for row in rows:
        listing_date = compact_date(row.get("listing_date"))
        delist_date = compact_date(row.get("delist_date"))
        name = str(row.get("name") or "")
        code = str(row.get("code") or "")
        if listing_date > target or (delist_date and delist_date < target):
            continue
        if code.startswith(("124", "810")) or re.search(r"定(?:转|\d{2})", name):
            continue
        active.append(dict(row))
    return sorted(active, key=lambda row: str(row["code"]))


def china_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
