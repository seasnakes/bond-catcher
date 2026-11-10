#!/usr/bin/env python3
"""Build a local A-share Shenwan industry lookup from QMT sector membership."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


SECTOR_PATTERN = re.compile(r"^SW([123])(.+)$")
ROMAN_SUFFIX_PATTERN = re.compile(r"[ⅠⅡⅢ]+$")


def fetch_json(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    path: str,
    params: dict[str, str] | None = None,
    timeout: float = 20.0,
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url)
    with opener.open(request, timeout=timeout) as response:
        payload = json.load(response)
    return payload if isinstance(payload, dict) else {}


def canonical_names(tags_path: Path) -> dict[int, dict[str, str]]:
    try:
        payload = json.loads(tags_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {1: {}, 2: {}, 3: {}}

    rows = payload.get("rows") if isinstance(payload, dict) else []
    counters: dict[int, dict[str, Counter[str]]] = {
        1: defaultdict(Counter),
        2: defaultdict(Counter),
        3: defaultdict(Counter),
    }
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        for level in (1, 2, 3):
            value = str(row.get(f"industry{level}") or "").strip()
            if not value or value in {"待分类", "新上市转债"}:
                continue
            counters[level][ROMAN_SUFFIX_PATTERN.sub("", value)][value] += 1
    return {
        level: {
            raw: counts.most_common(1)[0][0]
            for raw, counts in counters[level].items()
        }
        for level in (1, 2, 3)
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="同步申万一至三级行业映射")
    parser.add_argument(
        "--host",
        default=os.environ.get("QMT_BRIDGE_HOST", "127.0.0.1"),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("QMT_BRIDGE_PORT", "18889")),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "runtime" / "sw-industry-map.json",
    )
    parser.add_argument(
        "--tags",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "convertible-bond-tags.json",
    )
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    base_url = f"http://{args.host}:{args.port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    sector_payload = fetch_json(opener, base_url, "/api/sector/list")
    sector_names = sector_payload.get("sectors") or []
    sectors: list[tuple[str, int, str]] = []
    for raw_name in sector_names if isinstance(sector_names, list) else []:
        name = str(raw_name or "").strip()
        match = SECTOR_PATTERN.fullmatch(name)
        if not match or name.endswith("加权"):
            continue
        sectors.append((name, int(match.group(1)), match.group(2)))

    if not sectors:
        raise RuntimeError("QMT未返回可用的SW1/SW2/SW3行业板块")

    canonical = canonical_names(args.tags)
    memberships: dict[str, dict[int, set[str]]] = defaultdict(
        lambda: {1: set(), 2: set(), 3: set()}
    )
    failures: list[dict[str, str]] = []

    def load_sector(item: tuple[str, int, str]) -> tuple[int, str, list[str]]:
        name, level, industry = item
        payload = fetch_json(
            opener,
            base_url,
            "/api/sector_stocks",
            {"sector": name},
        )
        stocks = payload.get("stocks") or []
        return level, canonical[level].get(industry, industry), [
            str(code or "").strip().upper()
            for code in stocks if code
        ]

    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 32))) as pool:
        futures = {pool.submit(load_sector, sector): sector[0] for sector in sectors}
        for future in as_completed(futures):
            sector_name = futures[future]
            try:
                level, industry, stocks = future.result()
            except Exception as error:  # noqa: BLE001 - preserve partial diagnostics
                failures.append({"sector": sector_name, "error": type(error).__name__})
                continue
            for stock in stocks:
                if re.fullmatch(r"\d{6}\.(SH|SZ|BJ)", stock):
                    memberships[stock][level].add(industry)

    if failures:
        raise RuntimeError(
            f"申万行业同步不完整：{len(failures)}/{len(sectors)} 个板块读取失败"
        )

    stocks: dict[str, dict[str, str]] = {}
    conflicts: dict[str, dict[str, list[str]]] = {}
    for code, levels in sorted(memberships.items()):
        row: dict[str, str] = {}
        row_conflicts: dict[str, list[str]] = {}
        for level in (1, 2, 3):
            values = sorted(levels[level])
            if len(values) == 1:
                row[f"industry{level}"] = values[0]
            if len(values) > 1:
                row_conflicts[f"industry{level}"] = values
        stocks[code] = row
        if row_conflicts:
            conflicts[code] = row_conflicts

    now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    complete_count = sum(
        1 for row in stocks.values()
        if all(row.get(f"industry{level}") for level in (1, 2, 3))
    )
    payload = {
        "schemaVersion": 1,
        "updatedAt": now,
        "source": "QMT Bridge SW1/SW2/SW3 sector memberships",
        "sectorCount": len(sectors),
        "stockCount": len(stocks),
        "completeCount": complete_count,
        "conflictCount": len(conflicts),
        "conflicts": conflicts,
        "stocks": stocks,
    }
    write_json_atomic(args.output, payload)
    print(json.dumps({
        "ok": True,
        "output": str(args.output),
        "sectorCount": len(sectors),
        "stockCount": len(stocks),
        "completeCount": complete_count,
        "conflictCount": len(conflicts),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
