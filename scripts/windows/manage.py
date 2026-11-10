"""Manage only this installation's processes; never manage the QMT GUI."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import psutil

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "runtime/windows-services.json"
DEFAULTS = {"web_port": 5173, "api_port": 18890, "gateway_port": 18889,
            "relay_port": 15588, "relay_root": "qmt", "monitor_root": "monitor",
            "node": ".runtime/node/node.exe"}


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return {} if default is None else default


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def local_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def config():
    settings = {**DEFAULTS, **read_json(ROOT / "windows.local.json")}
    for key in ("web_port", "api_port", "gateway_port", "relay_port"):
        settings[key] = int(settings[key])
        if not 1024 <= settings[key] <= 65535:
            raise ValueError("Invalid port: " + key)
    if len({settings[key] for key in ("web_port", "api_port", "gateway_port", "relay_port")}) != 4:
        raise ValueError("Service ports must be different")
    return settings


def environment(settings):
    env = os.environ.copy()
    relay = read_json(local_path(settings["relay_root"]) / "finance-bigqmt-relay.json")
    account = str(relay.get("account_id") or "")
    if not account:
        raise RuntimeError("Missing QMT account configuration in qmt/finance-bigqmt-relay.json")
    bypass = [s for s in env.get("NO_PROXY", env.get("no_proxy", "")).split(",") if s]
    bypass.extend(["127.0.0.1", "localhost", "::1"])
    monitor = local_path(settings["monitor_root"])
    env.update({
        "NO_PROXY": ",".join(dict.fromkeys(bypass)), "no_proxy": ",".join(dict.fromkeys(bypass)),
        "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1",
        "MINIQMT_PYTHON": sys.executable, "PYTHON_BIN": sys.executable,
        "MINIQMT_MONITOR_ROOT": str(monitor), "MINIQMT_RUNTIME_ROOT": str(monitor / "runtime"),
        "FINANCE_NEW_BOND_UNIVERSE_PATH": str(ROOT / "runtime/new-bond-universe.json"),
        "MINIQMT_API_HOST": "127.0.0.1", "MINIQMT_API_PORT": str(settings["api_port"]),
        "MINIQMT_API_AUTOSTART": "0", "PORT": str(settings["web_port"]),
        "FINANCE_BIND_HOST": str(settings.get("web_bind_host") or "127.0.0.1"), "QMT_BRIDGE_HOST": "127.0.0.1",
        "QMT_BRIDGE_PORT": str(settings["gateway_port"]),
        "FINANCE_QMT_GATEWAY_HOST": "127.0.0.1", "FINANCE_QMT_GATEWAY_PORT": str(settings["gateway_port"]),
        "FINANCE_BIGQMT_ZMQ_ADDRESS": f"tcp://127.0.0.1:{settings['relay_port']}",
        "BIGQMT_ACCOUNT_ID": account, "FINANCE_QMT_MARKET_BACKEND": "bigqmt",
        "FINANCE_QMT_TRADING_BACKEND": "disabled", "FINANCE_BIGQMT_ORDER_METHODS_ENABLED": "0",
    })
    env["FINANCE_ALLOWED_REMOTE_ADDRESSES"] = ",".join(settings.get("web_allowed_remote_addresses", []))
    if settings.get("codex"):
        env["CB_AI_CODEX_PATH"] = str(local_path(settings["codex"]))
    # A Mac gateway key or a retired account channel must not leak into this local install.
    env.pop("QMT_BRIDGE_API_KEY", None)
    env["QMT_BRIDGE_ENV_FILE"] = str(ROOT / "windows.gateway.env")
    (ROOT / "windows.gateway.env").write_text("QMT_BRIDGE_API_KEY=\n", encoding="utf-8")
    return env


@contextmanager
def installation_lock():
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with (STATE.parent / "windows-services.lock").open("a+b") as stream:
        stream.write(b"0")
        stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def owned_process(record):
    if not record:
        return None
    try:
        process = psutil.Process(int(record["pid"]))
        if abs(process.create_time() - float(record["created"])) > 0.1:
            return None
        if process.cmdline() != record["argv"]:
            return None
        return process
    except (psutil.Error, KeyError, ValueError):
        return None


def listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def stop_record(record):
    process = owned_process(record)
    if process is None:
        return
    children = process.children(recursive=True)
    # Each child is a psutil Process with a creation-time identity check.
    for child in reversed(children):
        try:
            child.terminate()
        except psutil.NoSuchProcess:
            pass
    process.terminate()
    _, alive = psutil.wait_procs([process, *children], timeout=8)
    for child in alive:
        child.kill()
    psutil.wait_procs(alive, timeout=3)


def start_one(name, argv, env, records, port=None):
    existing = owned_process(records.get(name))
    if existing:
        if port and not listening(port):
            raise RuntimeError(name + " exists but is not listening; inspect logs before restarting")
        return False
    if port and listening(port):
        raise RuntimeError(f"Port {port} is already occupied; no existing process was stopped")
    logs = ROOT / "runtime/windows-logs"
    logs.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if os.name == "nt" else {"start_new_session": True}
    with (logs / f"{name}-{stamp}.log").open("ab") as log:
        child = subprocess.Popen(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=subprocess.STDOUT, **options)
    process = psutil.Process(child.pid)
    record = {"pid": child.pid, "created": process.create_time(), "argv": process.cmdline()}
    records[name] = record
    write_json(STATE, records)
    try:
        for _ in range(120):
            if child.poll() is not None:
                raise RuntimeError(name + " exited; see runtime/windows-logs")
            if port is None or listening(port):
                return True
            time.sleep(0.25)
        raise RuntimeError(name + " did not start within 30 seconds")
    except Exception:
        stop_record(record)
        records.pop(name, None)
        write_json(STATE, records)
        raise


def start(settings, records, env):
    node = local_path(settings["node"])
    if not node.is_file():
        raise RuntimeError("Node is missing; run 01-install.cmd first")
    if not (local_path(settings["monitor_root"]) / "shortline_monitor.py").is_file():
        raise RuntimeError("The bundled monitor source is missing")
    created = []
    relay_port = settings["relay_port"]
    try:
        if not listening(relay_port):
            relay = read_json(local_path(settings["relay_root"]) / "finance-bigqmt-relay.json")
            relay["bind_address"] = f"tcp://127.0.0.1:{relay_port}"
            generated = ROOT / "runtime/windows-relay.json"
            write_json(generated, relay)
            if start_one("relay", [sys.executable, str(ROOT / "scripts/qmt_pipe_zmq_relay.py"), "--config", str(generated)], env, records, relay_port):
                created.append("relay")
        commands = [
            ("gateway", [sys.executable, str(ROOT / "scripts/qmt_compat_gateway.py")], settings["gateway_port"]),
            ("api", [sys.executable, str(ROOT / "scripts/miniqmt-dashboard-api.py"), "--host", "127.0.0.1", "--port", str(settings["api_port"])], settings["api_port"]),
            ("web", [str(node), str(ROOT / "server.js")], settings["web_port"]),
        ]
        for name, argv, port in commands:
            if start_one(name, argv, env, records, port):
                created.append(name)
    except Exception:
        for name in reversed(created):
            stop_record(records.pop(name, None))
        write_json(STATE, records)
        raise
    print(json.dumps({"started": created, "url": f"http://localhost:{settings['web_port']}", "trading": "disabled"}))


def start_monitor(settings, records, env, smoke=False):
    root = local_path(settings["monitor_root"])
    output = root / ("smoke-runtime" if smoke else "runtime")
    output.mkdir(parents=True, exist_ok=True)
    argv = [sys.executable, str(root / "shortline_monitor.py"), "run", "--output-dir", str(output), "--no-tdx",
            "--supplemental-universe-file", str(ROOT / "runtime/new-bond-universe.json")]
    name = "monitor-smoke" if smoke else "monitor"
    if smoke:
        argv += ["--max-codes", "1", "--duration", "8", "--no-stop-after-close", "--no-indicator-backfill"]
    if start_one(name, argv, env, records):
        write_json(output / "service.json", {**records[name], "mode": "read_only", "started_at": datetime.now().isoformat()})
    print(json.dumps({"monitor": name, "pid": records[name]["pid"], "output": str(output)}))


def check(settings, offline=False):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    probes = [("home", settings["web_port"], "/", None),
              ("state", settings["web_port"], "/api/state", lambda d: isinstance(d.get("sectors"), list)),
              ("tags", settings["web_port"], "/api/miniqmt/tags", lambda d: len(d.get("rows", [])) > 0)]
    if not offline:
        probes += [
            ("quotes", settings["web_port"], "/api/miniqmt/quotes?codes=113042.SH", lambda d: any(float(q.get("price") or 0) > 0 for q in d.get("quotes", []))),
            ("daily", settings["web_port"], "/api/miniqmt/daily?code=113042&count=5", lambda d: len(d.get("rows", [])) >= 5),
        ]
    failed = 0
    for name, port, path, validate in probes:
        try:
            with opener.open(f"http://127.0.0.1:{port}{path}", timeout=40) as response:
                data = response.read()
            if validate and not validate(json.loads(data)):
                raise RuntimeError("response has no valid data")
            print(json.dumps({"check": name, "ok": True}))
        except Exception as error:
            failed += 1
            print(json.dumps({"check": name, "ok": False, "error": str(error)}))
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop", "status", "check", "monitor", "monitor-smoke"])
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    settings = config()
    if args.action == "check":
        return check(settings, args.offline)
    with installation_lock():
        records = read_json(STATE)
        if args.action == "status":
            print(json.dumps({name: {"pid": r.get("pid"), "alive": owned_process(r) is not None} for name, r in records.items()}))
        elif args.action == "stop":
            for name in ("monitor-smoke", "monitor", "web", "api", "gateway", "relay"):
                stop_record(records.pop(name, None))
            write_json(STATE, records)
            print("This installation stopped. QMT and external relays were left running.")
        elif args.action == "start":
            start(settings, records, environment(settings))
        else:
            start_monitor(settings, records, environment(settings), args.action == "monitor-smoke")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
