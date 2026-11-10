#!/usr/bin/env python3
"""Repair one trading day's saved previous-close baselines from live QMT.

Only ``previous_close`` is updated. Prices, timestamps, amounts and volumes are
left untouched. The database is backed up before any write unless ``--dry-run``
is used.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def fetch_previous_closes(
    gateway: str,
    codes: list[str],
    *,
    batch_size: int = 100,
) -> dict[str, float]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    result: dict[str, float] = {}
    for index in range(0, len(codes), batch_size):
        group = codes[index : index + batch_size]
        query = urllib.parse.urlencode({"stocks": ",".join(group)})
        request = urllib.request.Request(
            f"{gateway.rstrip('/')}/api/market/full_tick?{query}",
            headers={"Accept": "application/json"},
        )
        with opener.open(request, timeout=30) as response:
            payload: Any = json.load(response)
        ticks = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(ticks, dict):
            raise RuntimeError("QMT full_tick response does not contain data")
        for code in group:
            tick = ticks.get(code)
            if not isinstance(tick, dict):
                continue
            try:
                previous_close = float(tick.get("lastClose"))
            except (TypeError, ValueError):
                continue
            if previous_close > 0:
                result[code] = previous_close
    return result


def changed_row_count(
    connection: sqlite3.Connection,
    trading_date: str,
    closes: dict[str, float],
) -> tuple[int, int]:
    rows = 0
    codes = 0
    for code, previous_close in closes.items():
        count = connection.execute(
            """
            SELECT COUNT(*)
              FROM board_spark_samples
             WHERE trading_date = ?
               AND code = ?
               AND (
                    previous_close IS NULL
                    OR ABS(previous_close - ?) > 0.0000001
               )
            """,
            (trading_date, code, previous_close),
        ).fetchone()[0]
        if count:
            rows += int(count)
            codes += 1
    return rows, codes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument(
        "--date",
        default=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime(
            "%Y%m%d"
        ),
    )
    parser.add_argument("--gateway", default="http://127.0.0.1:18889")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    database = args.database.expanduser().resolve()
    if not database.is_file():
        raise SystemExit(f"database not found: {database}")

    connection = sqlite3.connect(database, timeout=30)
    try:
        codes = [
            str(row[0])
            for row in connection.execute(
                """
                SELECT DISTINCT code
                  FROM board_spark_samples
                 WHERE trading_date = ?
                 ORDER BY code
                """,
                (args.date,),
            )
        ]
        if not codes:
            raise SystemExit(f"no samples found for trading date {args.date}")
        closes = fetch_previous_closes(args.gateway, codes)
        changed_rows, changed_codes = changed_row_count(
            connection, args.date, closes
        )
        print(
            json.dumps(
                {
                    "date": args.date,
                    "sample_codes": len(codes),
                    "resolved_codes": len(closes),
                    "changed_codes": changed_codes,
                    "changed_rows": changed_rows,
                    "dry_run": args.dry_run,
                },
                ensure_ascii=False,
            )
        )
        if args.dry_run or not changed_rows:
            return 0

        timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = database.with_name(
            f"{database.stem}.backup-{timestamp}{database.suffix}"
        )
        backup_connection = sqlite3.connect(backup)
        try:
            connection.backup(backup_connection)
        finally:
            backup_connection.close()

        connection.execute("BEGIN IMMEDIATE")
        for code, previous_close in closes.items():
            connection.execute(
                """
                UPDATE board_spark_samples
                   SET previous_close = ?
                 WHERE trading_date = ?
                   AND code = ?
                   AND (
                        previous_close IS NULL
                        OR ABS(previous_close - ?) > 0.0000001
                   )
                """,
                (previous_close, args.date, code, previous_close),
            )
        connection.commit()
        print(json.dumps({"backup": str(backup)}, ensure_ascii=False))
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
