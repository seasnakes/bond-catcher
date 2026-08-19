#!/usr/bin/env python3
"""Build a sidecar MiniQMT daily store and compare local formulas with TDX."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.convertible_bond_reference import (  # noqa: E402
    active_reference_rows,
    compact_date,
    fetch_reference_rows,
)
from lib.local_formula_engine import FORMULAS, evaluate_latest  # noqa: E402


DEFAULT_DATABASE = ROOT / "runtime" / "convertible-bond-market.sqlite3"
DEFAULT_OUTPUT = ROOT / "runtime" / "local-formula-demo.json"
DEFAULT_BENCHMARK = ROOT / "runtime" / "tdx-formula-selections.json"
DEFAULT_BRIDGE = "http://10.211.55.3:18888"
DEFAULT_BOARD = "http://127.0.0.1:5173"


def chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


class JsonClient:
    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(self, path: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        with self.opener.open(request, timeout=timeout or self.timeout) as response:
            payload = json.load(response)
        return payload if isinstance(payload, dict) else {}

    def post(self, path: str, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST",
        )
        with self.opener.open(request, timeout=timeout or self.timeout) as response:
            result = json.load(response)
        return result if isinstance(result, dict) else {}


def database_connection(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS instruments (
          code TEXT PRIMARY KEY,
          bare_code TEXT NOT NULL,
          secid TEXT NOT NULL,
          name TEXT NOT NULL,
          stock_code TEXT NOT NULL DEFAULT '',
          stock_name TEXT NOT NULL DEFAULT '',
          listing_date TEXT NOT NULL,
          delist_date TEXT NOT NULL DEFAULT '',
          expire_date TEXT NOT NULL DEFAULT '',
          issue_scale_billion REAL,
          rating TEXT NOT NULL DEFAULT '',
          reference_source TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS universe_membership (
          as_of TEXT NOT NULL,
          code TEXT NOT NULL REFERENCES instruments(code),
          lifecycle_status TEXT NOT NULL,
          in_miniqmt_list INTEGER NOT NULL,
          from_new_bond_flow INTEGER NOT NULL,
          data_status TEXT NOT NULL DEFAULT 'pending',
          bar_count INTEGER NOT NULL DEFAULT 0,
          first_bar_date TEXT NOT NULL DEFAULT '',
          last_bar_date TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (as_of, code)
        );
        CREATE TABLE IF NOT EXISTS daily_bars (
          code TEXT NOT NULL REFERENCES instruments(code),
          trade_date TEXT NOT NULL,
          adjustment TEXT NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL,
          amount REAL NOT NULL,
          pre_close REAL,
          suspend_flag INTEGER,
          source TEXT NOT NULL,
          ingested_at TEXT NOT NULL,
          PRIMARY KEY (code, trade_date, adjustment)
        );
        CREATE INDEX IF NOT EXISTS daily_bars_date_idx
          ON daily_bars(trade_date, code);
        CREATE TABLE IF NOT EXISTS formula_runs (
          run_id TEXT PRIMARY KEY,
          engine TEXT NOT NULL,
          engine_version TEXT NOT NULL,
          as_of TEXT NOT NULL,
          adjustment TEXT NOT NULL,
          history_count INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          universe_count INTEGER NOT NULL,
          ready_count INTEGER NOT NULL DEFAULT 0,
          benchmark_path TEXT NOT NULL DEFAULT '',
          summary_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS formula_signals (
          run_id TEXT NOT NULL REFERENCES formula_runs(run_id),
          formula_code TEXT NOT NULL,
          code TEXT NOT NULL REFERENCES instruments(code),
          trade_date TEXT NOT NULL,
          selected INTEGER NOT NULL,
          bar_count INTEGER NOT NULL,
          PRIMARY KEY (run_id, formula_code, code)
        );
        """
    )
    return connection


def upsert_instruments(connection: sqlite3.Connection, rows: list[dict[str, Any]], observed_at: str) -> None:
    connection.executemany(
        """
        INSERT INTO instruments (
          code, bare_code, secid, name, stock_code, stock_name, listing_date,
          delist_date, expire_date, issue_scale_billion, rating,
          reference_source, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name=excluded.name,
          stock_code=excluded.stock_code,
          stock_name=excluded.stock_name,
          listing_date=excluded.listing_date,
          delist_date=excluded.delist_date,
          expire_date=excluded.expire_date,
          issue_scale_billion=excluded.issue_scale_billion,
          rating=excluded.rating,
          reference_source=excluded.reference_source,
          last_seen_at=excluded.last_seen_at
        """,
        [
            (
                row["code"], row["bare_code"], row["secid"], row["name"],
                row.get("stock_code", ""), row.get("stock_name", ""),
                row["listing_date"], row.get("delist_date", ""),
                row.get("expire_date", ""), row.get("issue_scale_billion"),
                row.get("rating", ""), row.get("source", ""), observed_at, observed_at,
            )
            for row in rows
        ],
    )


def normalize_bar(raw: dict[str, Any]) -> dict[str, Any] | None:
    trade_date = compact_date(raw.get("index") or raw.get("time"))
    try:
        values = {key: float(raw.get(key)) for key in ("open", "high", "low", "close", "volume", "amount")}
    except (TypeError, ValueError):
        return None
    if len(trade_date) != 8 or any(values[key] <= 0 for key in ("open", "high", "low", "close")):
        return None
    return {
        "trade_date": trade_date,
        **values,
        "pre_close": raw.get("preClose"),
        "suspend_flag": raw.get("suspendFlag"),
    }


def store_bars(
    connection: sqlite3.Connection,
    code: str,
    rows: list[dict[str, Any]],
    adjustment: str,
    ingested_at: str,
) -> list[dict[str, Any]]:
    normalized = [bar for raw in rows if (bar := normalize_bar(raw))]
    connection.executemany(
        """
        INSERT INTO daily_bars (
          code, trade_date, adjustment, open, high, low, close, volume,
          amount, pre_close, suspend_flag, source, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MiniQMT:market_data_ex', ?)
        ON CONFLICT(code, trade_date, adjustment) DO UPDATE SET
          open=excluded.open, high=excluded.high, low=excluded.low,
          close=excluded.close, volume=excluded.volume, amount=excluded.amount,
          pre_close=excluded.pre_close, suspend_flag=excluded.suspend_flag,
          source=excluded.source, ingested_at=excluded.ingested_at
        """,
        [
            (
                code, bar["trade_date"], adjustment, bar["open"], bar["high"],
                bar["low"], bar["close"], bar["volume"], bar["amount"],
                bar["pre_close"], bar["suspend_flag"], ingested_at,
            )
            for bar in normalized
        ],
    )
    return normalized


def read_stored_rows(
    connection: sqlite3.Connection, code: str, adjustment: str, history_count: int
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT trade_date, open, high, low, close, volume, amount, pre_close, suspend_flag
        FROM daily_bars
        WHERE code=? AND adjustment=?
        ORDER BY trade_date DESC LIMIT ?
        """,
        (code, adjustment, history_count),
    ).fetchall()
    return [dict(row) for row in reversed(rows)]


def source_hashes() -> dict[str, str]:
    result = {}
    for formula in FORMULAS:
        path = ROOT / "formula" / f"{formula}.md"
        result[formula] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""
    return result


def benchmark_as_of(path: Path) -> str:
    if not path.exists():
        return ""
    payload = json.loads(path.read_text(encoding="utf-8"))
    dates = [compact_date(row.get("asOf")) for row in payload.get("formulas") or []]
    return max((value for value in dates if value), default="")


def fetch_market_rows(
    bridge: JsonClient,
    codes: list[str],
    start_date: str,
    end_date: str,
    adjustment: str,
    timeout: float,
) -> dict[str, list[dict[str, Any]]]:
    if not codes:
        return {}
    payload = bridge.get(
        "/api/market/market_data_ex",
        {
            "stocks": ",".join(codes),
            "period": "1d",
            "start_time": start_date,
            "end_time": end_date,
            "count": -1,
            "dividend_type": adjustment,
            "fill_data": "false",
        },
        timeout=timeout,
    )
    data = payload.get("data") or {}
    return {code: list(data.get(code) or []) for code in codes}


def stored_universe(connection: sqlite3.Connection, as_of: str) -> list[dict[str, Any]]:
    snapshot_row = connection.execute(
        "SELECT MAX(as_of) FROM universe_membership WHERE as_of<=?",
        (as_of,),
    ).fetchone()
    snapshot_date = str(snapshot_row[0] or "") if snapshot_row else ""
    if not snapshot_date:
        return []
    rows = connection.execute(
        """
        SELECT i.code, i.bare_code, i.secid, i.name, i.stock_code,
               i.stock_name, i.listing_date, i.delist_date, i.expire_date,
               i.issue_scale_billion, i.rating, i.reference_source AS source
        FROM universe_membership u
        JOIN instruments i USING(code)
        WHERE u.as_of=? AND u.lifecycle_status='active'
        ORDER BY i.code
        """,
        (snapshot_date,),
    ).fetchall()
    return [dict(row) for row in rows]


def compare_with_tdx(
    benchmark_path: Path,
    local_selected: dict[str, set[str]],
    local_ready_codes: set[str],
) -> dict[str, Any]:
    if not benchmark_path.exists():
        return {"available": False, "reason": "benchmark_missing"}
    benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))
    comparisons = []
    for formula in benchmark.get("formulas") or []:
        name = str(formula.get("code") or "")
        if name not in local_selected:
            continue
        tdx_positive = {str(row.get("code") or "") for row in formula.get("selected") or []}
        evaluated = set(formula.get("evaluatedCodes") or [])
        if not evaluated:
            evaluated = set(local_ready_codes)
        compared = evaluated & local_ready_codes
        local_positive = local_selected[name] & compared
        tdx_positive &= compared
        true_positive = local_positive & tdx_positive
        false_positive = local_positive - tdx_positive
        false_negative = tdx_positive - local_positive
        true_negative_count = len(compared - local_positive - tdx_positive)
        agreement = (
            (len(true_positive) + true_negative_count) / len(compared)
            if compared else 0.0
        )
        comparisons.append(
            {
                "formula": name,
                "compared_count": len(compared),
                "tdx_selected_count": len(tdx_positive),
                "local_selected_count": len(local_positive),
                "true_positive": sorted(true_positive),
                "false_positive": sorted(false_positive),
                "false_negative": sorted(false_negative),
                "exact_selected_set": not false_positive and not false_negative,
                "agreement_rate": round(agreement, 6),
            }
        )
    return {
        "available": True,
        "benchmark_as_of": max(
            (compact_date(row.get("asOf")) for row in benchmark.get("formulas") or []),
            default="",
        ),
        "comparisons": comparisons,
    }


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", default="", help="Trading date YYYYMMDD; defaults to TDX snapshot")
    parser.add_argument("--start", default="20250101", help="Initial history start date")
    parser.add_argument("--history-count", type=int, default=250)
    parser.add_argument("--adjustment", default="front", choices=("none", "front", "back", "front_ratio", "back_ratio"))
    parser.add_argument("--download", action="store_true", help="Download MiniQMT history before reading")
    parser.add_argument("--download-batch-size", type=int, default=25)
    parser.add_argument("--read-batch-size", type=int, default=40)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE)
    parser.add_argument("--board", default=DEFAULT_BOARD)
    parser.add_argument("--new-bond-target-date", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    as_of = compact_date(args.as_of) or benchmark_as_of(args.benchmark)
    if len(as_of) != 8:
        raise SystemExit("Cannot resolve as-of date; pass --as-of YYYYMMDD")
    started_at = datetime.now().astimezone().isoformat(timespec="seconds")
    run_id = f"local-{as_of}-{uuid.uuid4().hex[:10]}"
    bridge = JsonClient(args.bridge, timeout=60)
    board = JsonClient(args.board, timeout=30)
    connection = database_connection(args.database)

    reference_error = ""
    try:
        reference_rows = fetch_reference_rows()
        universe = active_reference_rows(reference_rows, as_of)
        reference_source = "eastmoney_live"
    except Exception as error:
        reference_error = f"{type(error).__name__}: {error}"
        reference_rows = []
        universe = stored_universe(connection, as_of)
        reference_source = "local_membership_fallback"
        if not universe:
            connection.close()
            raise
    try:
        qmt_codes = set(bridge.get("/api/cb/list", timeout=15).get("stocks") or [])
    except Exception:
        qmt_codes = {
            str(row["code"])
            for row in connection.execute(
                "SELECT code FROM universe_membership WHERE as_of=? AND in_miniqmt_list=1",
                (as_of,),
            )
        }
    new_flow_candidates: dict[str, dict[str, Any]] = {}
    try:
        params = {"date": args.new_bond_target_date} if args.new_bond_target_date else None
        new_payload = board.get("/api/new-bond-second-day", params=params, timeout=30)
        new_flow_candidates = {
            str(row.get("market_code") or ""): row
            for row in new_payload.get("candidates") or []
            if row.get("market_code")
        }
    except Exception as error:
        new_payload = {"ok": False, "error": str(error), "candidates": []}

    universe_by_code = {row["code"]: row for row in universe}
    for code, candidate in new_flow_candidates.items():
        listing_date = compact_date(candidate.get("listing_date"))
        if len(listing_date) != 8 or listing_date > as_of or code in universe_by_code:
            continue
        bare_code = code.split(".", 1)[0]
        universe_by_code[code] = {
            "code": code,
            "bare_code": bare_code,
            "secid": str(candidate.get("secid") or ""),
            "name": str(candidate.get("name") or bare_code),
            "stock_code": str(candidate.get("stock_code") or ""),
            "stock_name": str(candidate.get("stock_name") or ""),
            "listing_date": listing_date,
            "delist_date": "",
            "expire_date": "",
            "issue_scale_billion": candidate.get("issue_scale_billion"),
            "rating": str(candidate.get("rating") or ""),
            "source": "finance:/api/new-bond-second-day",
        }
    universe = sorted(universe_by_code.values(), key=lambda row: str(row["code"]))
    if args.limit > 0:
        universe = universe[: args.limit]
        universe_by_code = {row["code"]: row for row in universe}

    observed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with connection:
        upsert_instruments(connection, universe, observed_at)
        connection.executemany(
            """
            INSERT INTO universe_membership (
              as_of, code, lifecycle_status, in_miniqmt_list,
              from_new_bond_flow, data_status
            ) VALUES (?, ?, 'active', ?, ?, 'pending')
            ON CONFLICT(as_of, code) DO UPDATE SET
              lifecycle_status=excluded.lifecycle_status,
              in_miniqmt_list=excluded.in_miniqmt_list,
              from_new_bond_flow=excluded.from_new_bond_flow
            """,
            [
                (
                    as_of,
                    code,
                    int(code in qmt_codes),
                    int(code in new_flow_candidates),
                )
                for code in universe_by_code
            ],
        )
        connection.execute(
            """
            INSERT INTO formula_runs (
              run_id, engine, engine_version, as_of, adjustment, history_count,
              started_at, universe_count, benchmark_path
            ) VALUES (?, 'finance-local-python', 'demo-v1', ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id, as_of, args.adjustment, args.history_count, started_at,
                len(universe), str(args.benchmark),
            ),
        )

    codes = list(universe_by_code)
    start_date = compact_date(args.start)
    fetched: dict[str, list[dict[str, Any]]] = {}
    batches = list(chunks(codes, max(1, args.read_batch_size)))
    for batch_index, batch in enumerate(batches, 1):
        fetched.update(
            fetch_market_rows(
                bridge, batch, start_date, as_of, args.adjustment,
                timeout=max(60, len(batch) * 2),
            )
        )
        print(f"preflight {batch_index}/{len(batches)}: {len(batch)} bonds", flush=True)

    download_results: dict[str, str] = {}
    if args.download:
        needs_download = [
            code
            for code in codes
            if not fetched.get(code)
            or compact_date(fetched[code][-1].get("index")) < as_of
        ]
        for index, code in enumerate(needs_download, 1):
            try:
                response = bridge.post(
                    "/api/download/history_data2",
                    {
                        "stocks": [code],
                        "period": "1d",
                        "start_time": start_date,
                        "end_time": as_of,
                    },
                    timeout=120,
                )
                endpoint_result = str((response.get("result") or {}).get(code) or "unknown")
                verified = False
                for _attempt in range(4):
                    time.sleep(0.5)
                    refreshed = fetch_market_rows(
                        bridge, [code], start_date, as_of, args.adjustment, timeout=20
                    ).get(code) or []
                    if refreshed:
                        fetched[code] = refreshed
                    if refreshed and compact_date(refreshed[-1].get("index")) >= as_of:
                        verified = True
                        break
                download_results[code] = (
                    "verified" if verified else f"unverified:{endpoint_result}"
                )
            except Exception as error:
                download_results[code] = f"error:{type(error).__name__}:{error}"
            if index % max(1, args.download_batch_size) == 0 or index == len(needs_download):
                print(
                    f"download+verify {index}/{len(needs_download)}: "
                    f"{sum(value == 'verified' for value in download_results.values())} verified",
                    flush=True,
                )

        # One final bulk read prevents a successful download from being hidden
        # by a short cache-visibility delay.
        for batch_index, batch in enumerate(batches, 1):
            fetched.update(
                fetch_market_rows(
                    bridge, batch, start_date, as_of, args.adjustment,
                    timeout=max(60, len(batch) * 2),
                )
            )
            print(f"final read {batch_index}/{len(batches)}: {len(batch)} bonds", flush=True)

    local_selected: dict[str, set[str]] = {name: set() for name in FORMULAS}
    ready_codes: set[str] = set()
    comparable_codes: set[str] = set()
    data_status_counts: dict[str, int] = {}
    total_rows = 0
    min_date = ""
    max_date = ""
    ingested_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with connection:
        for code in codes:
            stored = store_bars(connection, code, fetched.get(code) or [], args.adjustment, ingested_at)
            rows = read_stored_rows(connection, code, args.adjustment, args.history_count)
            bar_count = len(rows)
            first_date = str(rows[0]["trade_date"]) if rows else ""
            last_date = str(rows[-1]["trade_date"]) if rows else ""
            status = (
                "missing" if not rows
                else "stale" if last_date < as_of
                else "insufficient" if bar_count < 3
                else "ready"
            )
            data_status_counts[status] = data_status_counts.get(status, 0) + 1
            if rows and last_date >= as_of:
                comparable_codes.add(code)
            if status == "ready":
                ready_codes.add(code)
                signals = evaluate_latest(rows)
            elif status == "insufficient":
                # TDX still returns a current-date zero for very short new-bond
                # histories.  Evaluate the available bars so those true zeros
                # can participate in parity without calling the data complete.
                signals = evaluate_latest(rows)
            else:
                signals = {name: False for name in FORMULAS}
            for formula, selected in signals.items():
                if selected:
                    local_selected[formula].add(code)
                connection.execute(
                    """
                    INSERT INTO formula_signals (
                      run_id, formula_code, code, trade_date, selected, bar_count
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (run_id, formula, code, last_date, int(selected), bar_count),
                )
            connection.execute(
                """
                UPDATE universe_membership
                SET data_status=?, bar_count=?, first_bar_date=?, last_bar_date=?
                WHERE as_of=? AND code=?
                """,
                (status, bar_count, first_date, last_date, as_of, code),
            )
            total_rows += len(stored)
            if stored:
                row_min, row_max = stored[0]["trade_date"], stored[-1]["trade_date"]
                min_date = row_min if not min_date else min(min_date, row_min)
                max_date = max(max_date, row_max)

        comparison = compare_with_tdx(args.benchmark, local_selected, comparable_codes)
        completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
        summary = {
            "run_id": run_id,
            "status": "complete",
            "as_of": as_of,
            "started_at": started_at,
            "completed_at": completed_at,
            "source": {
                "universe": "eastmoney:RPT_BOND_CB_LIST point-in-time lifecycle",
                "bars": "MiniQMT market_data_ex",
                "adjustment": args.adjustment,
                "new_bond_flow": "/api/new-bond-second-day",
            },
            "universe": {
                "reference_records": len(reference_rows),
                "reference_refresh": reference_source,
                "reference_error": reference_error,
                "active_count": len(universe),
                "in_miniqmt_list": sum(1 for code in codes if code in qmt_codes),
                "outside_miniqmt_list": sorted(code for code in codes if code not in qmt_codes),
                "new_bond_flow_codes": sorted(code for code in codes if code in new_flow_candidates),
            },
            "data": {
                "database": str(args.database),
                "history_count_for_formula": args.history_count,
                "stored_rows_seen_this_run": total_rows,
                "first_date": min_date,
                "last_date": max_date,
                "status_counts": data_status_counts,
                "formula_comparable_count": len(comparable_codes),
                "database_bytes": args.database.stat().st_size if args.database.exists() else 0,
            },
            "formulas": [
                {
                    "code": name,
                    "source_path": str(ROOT / "formula" / f"{name}.md"),
                    "source_sha256": source_hashes()[name],
                    "selected_count": len(local_selected[name]),
                    "selected": [
                        {
                            "code": code,
                            "name": universe_by_code[code]["name"],
                            "date": as_of,
                        }
                        for code in sorted(local_selected[name])
                    ],
                }
                for name in FORMULAS
            ],
            "tdx_comparison": comparison,
            "download": {
                "requested": bool(args.download),
                "needed_count": len(download_results),
                "verified_count": sum(1 for value in download_results.values() if value == "verified"),
                "result_count": len(download_results),
                "failed": {key: value for key, value in download_results.items() if value != "verified"},
            },
            "new_bond_flow": new_payload,
        }
        connection.execute(
            """
            UPDATE formula_runs
            SET completed_at=?, ready_count=?, summary_json=?
            WHERE run_id=?
            """,
            (completed_at, len(comparable_codes), json.dumps(summary, ensure_ascii=False), run_id),
        )
    connection.close()
    summary["data"]["database_bytes"] = args.database.stat().st_size
    atomic_json(args.output, summary)
    print(json.dumps({
        "output": str(args.output),
        "database": str(args.database),
        "universe": len(universe),
        "ready": len(ready_codes),
        "comparable": len(comparable_codes),
        "selected": {name: len(values) for name, values in local_selected.items()},
        "comparison": comparison,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
