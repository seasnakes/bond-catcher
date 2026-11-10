#!/usr/bin/env python3
"""Refresh the current convertible-bond lifecycle visibility map.

The QMT current convertible-bond list is the primary source.  A very recent
listed bond discovered by the finance new-bond pipeline may temporarily remain
visible while QMT catches up.  Historical/tag source rows are never deleted;
the generated map only controls current-view visibility.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from lib.convertible_bond_reference import fetch_reference_rows


BOND_CODE_PATTERN = re.compile(r"^(?:110|111|113|118|123|124|127|128)\d{3}\.(?:SH|SZ)$")
MIN_CURRENT_BONDS = 250
MAX_CURRENT_BONDS = 500
MIN_REFERENCE_BONDS = 700
MAX_REFERENCE_BONDS = 2_000
SUPPLEMENT_MAX_AGE_DAYS = 15


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def normalize_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    suffix = re.fullmatch(r"(\d{6})\.(SH|SZ)", text)
    if suffix:
        return f"{suffix.group(1)}.{suffix.group(2)}"
    secid = re.fullmatch(r"([01])\.(\d{6})", text)
    if secid:
        return f"{secid.group(2)}.{('SH' if secid.group(1) == '1' else 'SZ')}"
    digits = re.fullmatch(r"\d{6}", text)
    if digits:
        market = "SH" if re.match(r"^(110|111|113|118)", text) else "SZ"
        return f"{text}.{market}"
    return ""


def parse_date(value: Any) -> date | None:
    text = re.sub(r"\D", "", str(value or ""))[:8]
    if len(text) != 8:
        return None
    try:
        return datetime.strptime(text, "%Y%m%d").date()
    except ValueError:
        return None


def fetch_json(host: str, port: int, path: str, timeout: float) -> dict[str, Any]:
    url = f"http://{host}:{port}{path}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with opener.open(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {}


def fetch_current_codes(host: str, port: int, timeout: float) -> set[str]:
    payload = fetch_json(host, port, "/api/cb/list", timeout)
    raw_codes = payload.get("stocks") if isinstance(payload, dict) else None
    codes = {
        normalize_code(value)
        for value in (raw_codes if isinstance(raw_codes, list) else [])
    }
    codes = {code for code in codes if BOND_CODE_PATTERN.fullmatch(code)}
    if not MIN_CURRENT_BONDS <= len(codes) <= MAX_CURRENT_BONDS:
        raise RuntimeError(
            f"QMT current-list quality gate failed: count={len(codes)} "
            f"expected={MIN_CURRENT_BONDS}..{MAX_CURRENT_BONDS}"
        )
    return codes


def fetch_instrument_details(
    host: str,
    port: int,
    codes: set[str],
    timeout: float,
) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    ordered = sorted(codes)
    for index in range(0, len(ordered), 100):
        batch = ordered[index : index + 100]
        query = urllib.parse.urlencode({"stocks": ",".join(batch)})
        payload = fetch_json(
            host,
            port,
            f"/api/instrument/detail_list?{query}",
            timeout,
        )
        for code, row in (payload.get("data") or {}).items():
            if isinstance(row, dict):
                details[normalize_code(code)] = row
    return details


def directed_or_non_public_reason(code: str, detail: dict[str, Any]) -> str:
    name = str(detail.get("InstrumentName") or "").strip()
    if code.startswith("124") or code.startswith("1108") or code.startswith("1185"):
        return "directed_convertible_bond_code"
    if re.search(r"定(?:转|\d{2})", name):
        return "directed_convertible_bond_name"
    return ""


def reference_inactive_reasons(
    rows: list[dict[str, Any]],
    today: date,
) -> dict[str, str]:
    if not MIN_REFERENCE_BONDS <= len(rows) <= MAX_REFERENCE_BONDS:
        raise RuntimeError(
            f"Eastmoney lifecycle quality gate failed: count={len(rows)} "
            f"expected={MIN_REFERENCE_BONDS}..{MAX_REFERENCE_BONDS}"
        )
    reasons: dict[str, str] = {}
    for row in rows:
        code = normalize_code(row.get("code"))
        delisted = parse_date(row.get("delist_date"))
        if BOND_CODE_PATTERN.fullmatch(code) and delisted is not None and delisted <= today:
            reasons[code] = f"eastmoney_delisted_{delisted.strftime('%Y%m%d')}"
    return reasons


def fetch_reference_rows_with_retry(timeout: float) -> list[dict[str, Any]]:
    errors: list[str] = []
    for _attempt in range(2):
        try:
            return fetch_reference_rows(timeout=max(15.0, timeout), page_size=500)
        except Exception as error:
            errors.append(f"{type(error).__name__}: {error}")
    raise RuntimeError("; ".join(errors))


def previous_reference_inactive_reasons(
    previous: dict[str, Any],
    today: date,
) -> dict[str, str]:
    previous_rows = previous.get("bonds") if isinstance(previous.get("bonds"), dict) else {}
    reasons: dict[str, str] = {}
    for code, row in previous_rows.items():
        if not isinstance(row, dict) or row.get("isActive") is not False:
            continue
        reason = str(row.get("reason") or "")
        match = re.fullmatch(r"eastmoney_delisted_(\d{8})", reason)
        delisted = parse_date(match.group(1)) if match else None
        normalized = normalize_code(code)
        if BOND_CODE_PATTERN.fullmatch(normalized) and delisted is not None and delisted <= today:
            reasons[normalized] = reason
    return reasons


def collect_known_rows(
    tags: dict[str, Any],
    board: dict[str, Any],
    heatmap: dict[str, Any],
    universe: dict[str, Any],
    qmt_details: dict[str, dict[str, Any]],
) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}

    def remember(code_value: Any, name_value: Any = "", source: str = "") -> None:
        code = normalize_code(code_value)
        if not BOND_CODE_PATTERN.fullmatch(code):
            return
        row = rows.setdefault(code, {"name": "", "knownFrom": ""})
        name = str(name_value or "").strip()
        if name and not row["name"]:
            row["name"] = name
        sources = [item for item in row["knownFrom"].split(",") if item]
        if source and source not in sources:
            sources.append(source)
        row["knownFrom"] = ",".join(sources)

    for row in tags.get("rows") or []:
        if isinstance(row, dict):
            remember(row.get("code"), row.get("name"), "tag_library")
    for row in heatmap.get("rows") or []:
        if isinstance(row, dict):
            remember(row.get("code"), row.get("name"), "heatmap_snapshot")
    for row in universe.get("bonds") or []:
        if isinstance(row, dict):
            remember(row.get("code"), row.get("name"), "new_bond_universe")
    for sector in board.get("sectors") or []:
        if not isinstance(sector, dict):
            continue
        for row in sector.get("stocks") or []:
            if isinstance(row, dict):
                remember(row.get("secid"), row.get("name"), "board_state")
    for code, detail in qmt_details.items():
        remember(code, detail.get("InstrumentName"), "qmt_current_list")
    return rows


def add_qmt_known_rows(
    rows: dict[str, dict[str, str]],
    codes: set[str],
    details: dict[str, dict[str, Any]],
) -> None:
    for code in codes:
        detail = details.get(code) or {}
        row = rows.setdefault(code, {"name": "", "knownFrom": ""})
        name = str(detail.get("InstrumentName") or "").strip()
        if name and not row["name"]:
            row["name"] = name
        sources = [item for item in row["knownFrom"].split(",") if item]
        if "qmt_current_list" not in sources:
            sources.append("qmt_current_list")
        row["knownFrom"] = ",".join(sources)


def recent_supplemental_codes(
    universe: dict[str, Any],
    current_codes: set[str],
    today: date,
) -> set[str]:
    supplemental: set[str] = set()
    for row in universe.get("bonds") or []:
        if not isinstance(row, dict):
            continue
        code = normalize_code(row.get("code"))
        listed = parse_date(row.get("listingDate"))
        valid_through = parse_date(row.get("validThrough"))
        if (
            not BOND_CODE_PATTERN.fullmatch(code)
            or code in current_codes
            or listed is None
            or listed > today
            or today - listed > timedelta(days=SUPPLEMENT_MAX_AGE_DAYS)
            or (valid_through is not None and valid_through < today)
        ):
            continue
        # This exception exists only for a newly discovered bond that QMT did
        # not contain at discovery time.  A formerly present bond cannot be
        # kept alive by an old manifest row after it exits the current list.
        if row.get("inMiniQmtList") is False:
            supplemental.add(code)
    return supplemental


def build_payload(
    *,
    current_codes: set[str],
    known_rows: dict[str, dict[str, str]],
    supplemental_codes: set[str],
    previous: dict[str, Any],
    checked_at: str,
    qmt_raw_count: int,
    excluded_non_public: dict[str, str],
    qmt_ordinary_count: int,
    qmt_listed_codes: set[str],
    inactive_reasons: dict[str, str],
    reference_status: str,
    reference_count: int,
    reference_error: str,
) -> dict[str, Any]:
    active_codes = current_codes | supplemental_codes
    all_codes = sorted(set(known_rows) | current_codes | supplemental_codes)
    previous_rows = previous.get("bonds") if isinstance(previous.get("bonds"), dict) else {}
    bonds: dict[str, dict[str, Any]] = {}
    for code in all_codes:
        prior = previous_rows.get(code) if isinstance(previous_rows.get(code), dict) else {}
        known = known_rows.get(code) or {}
        in_qmt = code in qmt_listed_codes
        in_supplement = code in supplemental_codes
        is_active = code in active_codes
        status = (
            "active_listed"
            if is_active and in_qmt
            else "active_new_bond_supplement"
            if is_active and in_supplement
            else "inactive_or_exited"
        )
        reason = (
            "present_in_qmt_current_list"
            if is_active and in_qmt
            else "recent_new_bond_not_yet_in_qmt"
            if is_active and in_supplement
            else inactive_reasons.get(code, "absent_from_qmt_current_list")
        )
        row = {
            "code": code,
            "name": known.get("name") or str(prior.get("name") or ""),
            "lifecycleStatus": status,
            "isActive": is_active,
            "visibility": "active" if is_active else "hidden",
            "reason": reason,
            "inQmtCurrentList": in_qmt,
            "inNewBondSupplement": in_supplement,
            "knownFrom": known.get("knownFrom") or str(prior.get("knownFrom") or ""),
            "checkedAt": checked_at,
            "firstObservedAt": str(prior.get("firstObservedAt") or checked_at),
            "lastObservedActiveAt": (
                checked_at if is_active else str(prior.get("lastObservedActiveAt") or "")
            ),
            "firstObservedInactiveAt": (
                str(prior.get("firstObservedInactiveAt") or checked_at)
                if not is_active
                else ""
            ),
        }
        bonds[code] = row
    hidden_count = sum(1 for row in bonds.values() if not row["isActive"])
    return {
        "version": 1,
        "qualityStatus": "ok",
        "source": (
            "QMT Bridge /api/cb/list + Eastmoney RPT_BOND_CB_LIST lifecycle "
            "+ finance recent new-bond supplement"
        ),
        "checkedAt": checked_at,
        "qmtRawCount": qmt_raw_count,
        "qmtOrdinaryCount": qmt_ordinary_count,
        "qmtActiveCount": len(current_codes),
        "excludedNonPublicCount": len(excluded_non_public),
        "excludedNonPublic": excluded_non_public,
        "excludedInactiveCount": len(inactive_reasons),
        "excludedInactive": inactive_reasons,
        "referenceStatus": reference_status,
        "referenceCount": reference_count,
        "referenceError": reference_error,
        "supplementalActiveCount": len(supplemental_codes),
        "activeCount": len(active_codes),
        "knownCount": len(bonds),
        "hiddenCount": hidden_count,
        "bonds": bonds,
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        Path(temporary_name).replace(path)
    except Exception:
        try:
            Path(temporary_name).unlink()
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18889)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tags", type=Path, required=True)
    parser.add_argument("--board", type=Path, required=True)
    parser.add_argument("--heatmap", type=Path, required=True)
    parser.add_argument("--new-bond-universe", type=Path, required=True)
    args = parser.parse_args()

    tags = read_json(args.tags)
    board = read_json(args.board)
    heatmap = read_json(args.heatmap)
    universe = read_json(args.new_bond_universe)
    previous = read_json(args.output)
    raw_current_codes = fetch_current_codes(args.host, args.port, args.timeout)
    details = fetch_instrument_details(
        args.host,
        args.port,
        raw_current_codes,
        args.timeout,
    )
    excluded_non_public = {
        code: reason
        for code in sorted(raw_current_codes)
        if (reason := directed_or_non_public_reason(code, details.get(code) or {}))
    }
    qmt_ordinary_codes = raw_current_codes - set(excluded_non_public)
    known_rows = collect_known_rows(tags, board, heatmap, universe, {})
    source_known_codes = set(known_rows)
    today = date.today()
    inactive_reasons: dict[str, str] = {}
    reference_status = "ok"
    reference_count = 0
    reference_error = ""
    try:
        reference_rows = fetch_reference_rows_with_retry(args.timeout)
        reference_count = len(reference_rows)
        reference_reasons = reference_inactive_reasons(reference_rows, today)
        relevant_codes = qmt_ordinary_codes | source_known_codes
        inactive_reasons.update({
            code: reason
            for code, reason in reference_reasons.items()
            if code in relevant_codes
        })
    except Exception as error:
        # QMT may retain redeemed bonds in /api/cb/list after their delisting.
        # Do not reactivate a previously confirmed delisting just because the
        # independent lifecycle source is temporarily unavailable.
        reference_status = "stale_previous"
        reference_error = f"{type(error).__name__}: {error}"
        inactive_reasons.update(previous_reference_inactive_reasons(previous, today))
    for code in sorted(qmt_ordinary_codes):
        detail = details.get(code) or {}
        expires = parse_date(detail.get("ExpireDate"))
        status = int(detail.get("InstrumentStatus") or 0)
        if expires is not None and expires < today:
            inactive_reasons[code] = f"instrument_expired_{expires.strftime('%Y%m%d')}"
        elif code not in source_known_codes and status:
            inactive_reasons[code] = f"qmt_only_instrument_status_{status}"
    current_codes = qmt_ordinary_codes - set(inactive_reasons)
    if len(current_codes) < MIN_CURRENT_BONDS:
        raise RuntimeError(
            f"ordinary current-list quality gate failed: count={len(current_codes)}"
        )
    supplemental_codes = recent_supplemental_codes(universe, current_codes, today)
    add_qmt_known_rows(known_rows, qmt_ordinary_codes, details)
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    payload = build_payload(
        current_codes=current_codes,
        known_rows=known_rows,
        supplemental_codes=supplemental_codes,
        previous=previous,
        checked_at=checked_at,
        qmt_raw_count=len(raw_current_codes),
        excluded_non_public=excluded_non_public,
        qmt_ordinary_count=len(qmt_ordinary_codes),
        qmt_listed_codes=qmt_ordinary_codes,
        inactive_reasons=inactive_reasons,
        reference_status=reference_status,
        reference_count=reference_count,
        reference_error=reference_error,
    )
    write_json_atomic(args.output, payload)
    print(json.dumps({key: payload[key] for key in (
        "checkedAt", "qmtRawCount", "qmtOrdinaryCount", "qmtActiveCount",
        "excludedNonPublicCount", "excludedInactiveCount", "supplementalActiveCount",
        "referenceStatus", "referenceCount", "activeCount", "knownCount", "hiddenCount",
    )}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
