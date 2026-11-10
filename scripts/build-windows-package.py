#!/usr/bin/env python3
"""Snapshot the working tree and make online SQLite backups for a private move."""
from __future__ import annotations
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MONITOR = Path("/Users/seasnake/Documents/Codex/2026-07-27/miniqmt/outputs/miniqmt_cb_shortline_monitor")
SOURCE_DIRS = {"lib", "src", "scripts", "tests", "docs", "web", "formula", "data"}
SOURCE_EXTENSIONS = {".js", ".py", ".html", ".css", ".json", ".md", ".txt", ".ps1", ".cmd", ".svg", ".png", ".jpg", ".jpeg", ".mmd", ".toml", ".yaml", ".yml"}
RUNTIME_ITEMS = ["active-index-universes.json", "auction-series-history", "auction-series.json",
                 "board-quote-snapshot.json", "board-spark-samples.sqlite3", "cb-ai", "cb-paper-account.json",
                 "cb-portfolio-cache", "convertible-bond-lifecycle.json", "convertible-bond-market.sqlite3",
                 "intraday-backfill-cache", "limit-ladder-board.json", "limit-ladder-pools-v2",
                 "local-formula-demo.json", "new-bond-universe.json", "sw-industry-map.json", "tdx-formula-selections.json"]
MONITOR_ITEMS = ["data", "reports", "board-spark-samples.sqlite3", "bond-redeem-status-history.json"]


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def snapshot_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix in {".sqlite3", ".sqlite", ".db"}:
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)) as origin:
            with closing(sqlite3.connect(target)) as backup:
                origin.backup(backup, pages=4096, sleep=0.05)
                result = backup.execute("PRAGMA quick_check").fetchone()[0]
                if result != "ok":
                    raise RuntimeError(f"SQLite backup verification failed: {source.name}")
    else:
        shutil.copy2(source, target)


def copy_item(source, target):
    if not source.exists():
        return
    files = source.rglob("*") if source.is_dir() else [source]
    for item in files:
        if not item.is_file() or item.is_symlink() or item.name.startswith("."):
            continue
        if item.name.endswith(("-wal", "-shm", ".tmp", ".log", ".pyc")):
            continue
        destination = target / item.relative_to(source) if source.is_dir() else target
        snapshot_file(item, destination)


def archive(staging, output, kind):
    files = sorted(p for p in staging.rglob("*") if p.is_file())
    manifest = {
        "kind": kind, "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "local working tree including uncommitted changes",
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "files": {p.relative_to(staging).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)} for p in files},
    }
    manifest_path = staging / f"release-{kind}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3) as bundle:
        for file in [*files, manifest_path]:
            bundle.write(file, "finance-windows/" + file.relative_to(staging).as_posix())
    with zipfile.ZipFile(output) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError("ZIP verification failed")
    checksum = digest(output)
    output.with_suffix(output.suffix + ".sha256").write_text(f"{checksum}  {output.name}\n", encoding="ascii")
    print(json.dumps({"archive": str(output), "files": len(files), "bytes": output.stat().st_size, "sha256": checksum}), flush=True)


def program(staging, monitor, qmt):
    for item in ROOT.iterdir():
        if item.is_file() and not item.name.startswith(".") and item.suffix in {".js", ".html", ".css", ".json", ".md"}:
            shutil.copy2(item, staging / item.name)
    for directory in SOURCE_DIRS:
        for file in (ROOT / directory).rglob("*"):
            if not file.is_file() or file.is_symlink() or file.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            rel = file.relative_to(ROOT)
            if any(part.startswith(".") or part in {"node_modules", "__pycache__", "runtime"} for part in rel.parts):
                continue
            destination = staging / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)
    copy_item(monitor / "shortline_monitor.py", staging / "monitor/shortline_monitor.py")
    copy_item(monitor / "README.md", staging / "monitor/ORIGINAL-README.md")
    for name in ["FINANCE_BIGQMT_READONLY_PIPE.py", "finance-bigqmt-relay.json"]:
        source = qmt / name
        if not source.is_file():
            raise FileNotFoundError(source)
        copy_item(source, staging / "qmt" / name)
    config_path = staging / "qmt/finance-bigqmt-relay.json"
    settings = json.loads(config_path.read_text())
    settings["bind_address"] = "tcp://127.0.0.1:15588"
    config_path.write_text(json.dumps(settings), encoding="utf-8")
    commands = {"01-install": None, "02-start": "start", "03-check": "check", "04-monitor": "monitor", "05-stop": "stop", "06-status": "status"}
    for name, action in commands.items():
        script = "setup.ps1" if action is None else "run.ps1"
        argument = "" if action is None else " -Action " + action
        content = '@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\windows\\' + script + '"' + argument + '\r\nset "result=%errorlevel%"\r\npause\r\nexit /b %result%\r\n'
        (staging / (name + ".cmd")).write_bytes(content.encode("ascii"))
    shutil.copy2(ROOT / "docs/runbooks/windows-migration.md", staging / "Windows-使用说明.md")
    shutil.copy2(ROOT / "docs/runbooks/windows-codex-handoff.md", staging / "WINDOWS_CODEX_HANDOFF.md")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--monitor-root", type=Path, default=MONITOR)
    parser.add_argument("--qmt-bundle", type=Path, default=ROOT / "runtime/qmt-migration/upgrade-20261027/pipe-bundle")
    parser.add_argument("--only", choices=["program", "data", "all"], default="all")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for kind in (["program", "data"] if args.only == "all" else [args.only]):
        with tempfile.TemporaryDirectory(prefix="finance-windows-", dir=args.output) as temporary:
            staging = Path(temporary)
            if kind == "program":
                program(staging, args.monitor_root, args.qmt_bundle)
            else:
                for name in RUNTIME_ITEMS:
                    copy_item(ROOT / "runtime" / name, staging / "runtime" / name)
                for name in MONITOR_ITEMS:
                    copy_item(args.monitor_root / "runtime" / name, staging / "monitor/runtime" / name)
            archive(staging, args.output / f"finance-windows-{kind}.zip", kind)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
