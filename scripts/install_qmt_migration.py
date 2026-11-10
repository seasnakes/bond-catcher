#!/usr/bin/env python3
"""Install the local QMT gateway and route finance consumers through it."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import plistlib
import shutil
import subprocess
import time
from pathlib import Path


LABEL = "com.seasnake.finance-qmt-gateway"
FINANCE_LABEL = "com.seasnake.finance-board"
MONITOR_LABEL = "com.seasnake.miniqmt-shortline"


def load_plist(path: Path) -> dict:
    with path.open("rb") as source:
        return plistlib.load(source)


def save_plist(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as destination:
        plistlib.dump(payload, destination, sort_keys=False)


def backup(path: Path, directory: Path, stamp: str) -> None:
    if path.exists():
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, directory / f"{path.name}.{stamp}.bak")


def route_consumer(path: Path) -> bool:
    payload = load_plist(path)
    original = plistlib.dumps(payload, sort_keys=False)
    environment = dict(payload.get("EnvironmentVariables") or {})
    environment.update(
        {
            "QMT_BRIDGE_HOST": "127.0.0.1",
            "QMT_BRIDGE_PORT": "18889",
            "NO_PROXY": "127.0.0.1,localhost,::1,10.211.55.3",
            "no_proxy": "127.0.0.1,localhost,::1,10.211.55.3",
        }
    )
    payload["EnvironmentVariables"] = environment
    save_plist(path, payload)
    return plistlib.dumps(payload, sort_keys=False) != original


def gateway_plist(project_root: Path, python: Path) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(python),
            str(project_root / "scripts" / "qmt_compat_gateway.py"),
            "--host",
            "127.0.0.1",
            "--port",
            "18889",
            "--env-file",
            str(Path.home() / ".codex" / ".env"),
        ],
        "WorkingDirectory": str(project_root),
        "EnvironmentVariables": {
            "FINANCE_QMT_MARKET_BACKEND": "bigqmt",
            "FINANCE_QMT_TRADING_BACKEND": "disabled",
            "FINANCE_BIGQMT_ZMQ_ADDRESS": "tcp://10.211.55.3:15588",
            "FINANCE_BIGQMT_FORMULA_HOST": "10.211.55.3",
            "FINANCE_BIGQMT_FORMULA_PORT": "58600",
            "FINANCE_BIGQMT_ORDER_METHODS_ENABLED": "0",
            "FINANCE_BIGQMT_PROBE_TIMEOUT_SECONDS": "4",
            "NO_PROXY": "127.0.0.1,localhost,::1,10.211.55.3",
            "no_proxy": "127.0.0.1,localhost,::1,10.211.55.3",
        },
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardOutPath": str(project_root / "runtime" / "qmt-gateway.log"),
        "StandardErrorPath": str(project_root / "runtime" / "qmt-gateway.log"),
    }


def launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["launchctl", *arguments], text=True, capture_output=True, check=check
    )


def reload_agent(domain: str, label: str, path: Path, *, kickstart: bool) -> None:
    launchctl("bootout", f"{domain}/{label}", check=False)
    for _unused in range(20):
        if not service_loaded(domain, label):
            break
        time.sleep(0.25)
    result = None
    for _unused in range(5):
        result = launchctl("bootstrap", domain, str(path), check=False)
        if result.returncode == 0:
            break
        # A KeepAlive job can still be leaving its old launchd transaction.
        time.sleep(1.0)
    assert result is not None
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"could not bootstrap {label}: {detail}")
    if kickstart:
        launchctl("kickstart", "-k", f"{domain}/{label}")


def service_loaded(domain: str, label: str) -> bool:
    result = launchctl("print", f"{domain}/{label}", check=False)
    return result.returncode == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--python", type=Path, default=Path("/Users/seasnake/miniconda3/bin/python3")
    )
    parser.add_argument("--skip-restart", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    agents = Path.home() / "Library" / "LaunchAgents"
    gateway_path = agents / f"{LABEL}.plist"
    finance_path = agents / f"{FINANCE_LABEL}.plist"
    monitor_path = agents / f"{MONITOR_LABEL}.plist"
    required = [args.python, finance_path, monitor_path]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("missing required paths: " + ", ".join(missing))

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = project_root / "runtime" / "qmt-migration" / "launchagent-backups"
    for path in (gateway_path, finance_path, monitor_path):
        backup(path, backup_dir, stamp)
    finance_changed = route_consumer(finance_path)
    monitor_changed = route_consumer(monitor_path)
    save_plist(gateway_path, gateway_plist(project_root, args.python))

    if not args.skip_restart:
        domain = f"gui/{os.getuid()}"
        reload_agent(domain, LABEL, gateway_path, kickstart=True)
        if finance_changed or not service_loaded(domain, FINANCE_LABEL):
            reload_agent(domain, FINANCE_LABEL, finance_path, kickstart=True)
        # Bootstrap the scheduled monitor definition, but do not force a new
        # monitor run outside its own calendar/session checks.
        if monitor_changed or not service_loaded(domain, MONITOR_LABEL):
            reload_agent(domain, MONITOR_LABEL, monitor_path, kickstart=False)

    print(
        "QMT migration installed: gateway=127.0.0.1:18889 "
        "market=auto trading=miniqmt bigqmt_orders=disabled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
