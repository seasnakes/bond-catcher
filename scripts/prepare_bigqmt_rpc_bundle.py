#!/usr/bin/env python3
"""Prepare and optionally deploy the pinned Big QMT ZMQ bridge bundle."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
from pathlib import Path


PINNED_VERSION = "0.3.74"
ENTRY_FILES = (
    "BIGQMT_ZMQ_DRYRUN.py",
    "BIGQMT_REDIS_DRYRUN.py",
    "bigqmt_signal_trader_strategy.py",
    "bigqmt_signal_trader_redis_rpc_runtime.py",
)
LOCAL_CONFIG = '''# coding: utf-8
"""Private finance-board Big QMT bridge config. Never commit this file."""

BIGQMT_ACCOUNT_ID = ""
BIGQMT_ACCOUNT_TYPE = "STOCK"

BIGQMT_REDIS_CONFIG = {
    "transport": "zmq",
    "redis_enabled": False,
    "rpc_allow_order_methods": False,
    "rpc_process_in_listener": True,
    "rpc_listener_methods": ("*",),
    "rpc_background_threads": False,
    "schedule_adjust": True,
    "schedule_adjust_interval": "100nMilliSecond",
    "download_jobs_enabled": False,
    "exec_events_enabled": False,
    "full_tick_cache_enabled": False,
    "zmq": {"bind_address": "tcp://0.0.0.0:15588", "port": 15588},
}
'''


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_source_root() -> Path:
    import bigqmt_signal_trader

    root = Path(bigqmt_signal_trader.__file__).resolve().parent.parent
    missing = [name for name in ENTRY_FILES if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"installed package is missing: {', '.join(missing)}")
    return root


def read_account_id(env_file: Path | None) -> str:
    values = dict(os.environ)
    if env_file and env_file.expanduser().is_file():
        for raw_line in env_file.expanduser().read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
                value = value[1:-1]
            values.setdefault(key.strip(), value)
    account_id = str(
        values.get("BIGQMT_ACCOUNT_ID")
        or values.get("QMT_BRIDGE_STOCK_ACCOUNT_ID")
        or ""
    ).strip()
    if account_id and not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", account_id):
        raise RuntimeError("the configured Big QMT account id has an unsafe format")
    return account_id


def prepare(destination: Path, account_id: str = "") -> dict:
    version = importlib.metadata.version("xtquant-big-convert")
    if version != PINNED_VERSION:
        raise RuntimeError(
            f"expected xtquant-big-convert {PINNED_VERSION}, installed {version}"
        )
    source_root = package_source_root()
    destination = destination.resolve()
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    shutil.copytree(
        source_root / "bigqmt_signal_trader",
        destination / "bigqmt_signal_trader",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )
    for name in ENTRY_FILES:
        shutil.copy2(source_root / name, destination / name)
    private_config = LOCAL_CONFIG.replace(
        'BIGQMT_ACCOUNT_ID = ""',
        "BIGQMT_ACCOUNT_ID = " + json.dumps(account_id),
        1,
    )
    (destination / "bigqmt_signal_trader_local_config.py").write_text(
        private_config, encoding="utf-8"
    )
    files = sorted(path for path in destination.rglob("*") if path.is_file())
    manifest = {
        "package": "xtquant-big-convert",
        "version": version,
        "entry": "BIGQMT_ZMQ_DRYRUN.py",
        "transport": "zmq",
        "port": 15588,
        "orders_enabled": False,
        "account_configured": bool(account_id),
        "files": {
            str(path.relative_to(destination)): {
                "size": path.stat().st_size,
                "sha256": file_sha256(path),
            }
            for path in files
        },
    }
    (destination / "finance-bigqmt-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def deploy_to_parallels(vm_name: str, mac_source: Path) -> None:
    home = Path.home().resolve()
    source = mac_source.resolve()
    try:
        relative = source.relative_to(home)
    except ValueError as error:
        raise RuntimeError("bundle must be under the macOS home shared folder") from error
    unc = "\\\\Mac\\Home\\" + "\\".join(relative.parts)
    project_root = Path(__file__).resolve().parents[1]
    script_path = project_root / "scripts" / "deploy_bigqmt_rpc.ps1"
    script_relative = script_path.relative_to(home)
    script_unc = "\\\\Mac\\Home\\" + "\\".join(script_relative.parts)
    completed = subprocess.run(
        [
            "prlctl",
            "exec",
            vm_name,
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_unc,
            "-Source",
            unc,
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    stdout = completed.stdout.decode("gb18030", errors="replace")
    stderr = completed.stderr.decode("gb18030", errors="replace")
    if completed.returncode != 0 or "BIGQMT_DEPLOY_OK" not in stdout:
        detail = (stderr or stdout).strip()
        raise RuntimeError(f"Parallels deployment failed: {detail[-1000:]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--destination",
        type=Path,
        default=Path("runtime/qmt-migration/bigqmt-python"),
    )
    parser.add_argument("--deploy-parallels", action="store_true")
    parser.add_argument("--vm-name", default="Windows 11")
    parser.add_argument(
        "--account-env-file",
        type=Path,
        default=Path.home() / ".codex" / ".env",
        help="private env file containing BIGQMT_ACCOUNT_ID or QMT_BRIDGE_STOCK_ACCOUNT_ID",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    account_id = read_account_id(args.account_env_file)
    manifest = prepare(args.destination, account_id=account_id)
    if args.deploy_parallels:
        deploy_to_parallels(args.vm_name, args.destination)
    print(
        json.dumps(
            {
                "ok": True,
                "version": manifest["version"],
                "files": len(manifest["files"]),
                "destination": str(args.destination.resolve()),
                "deployed": args.deploy_parallels,
                "orders_enabled": False,
                "account_configured": manifest["account_configured"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
