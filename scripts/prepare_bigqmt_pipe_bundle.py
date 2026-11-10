#!/usr/bin/env python3
"""Build a read-only single-file QMT strategy using the upstream flat builder."""

import argparse
import ast
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from prepare_bigqmt_rpc_bundle import file_sha256, prepare, read_account_id


def configure_entry(source, account_id):
    settings = {
        "BIGQMT_ACCOUNT_ID": account_id,
        "BIGQMT_ACCOUNT_TYPE": "STOCK",
        "BIGQMT_REDIS_CONFIG": {
            "transport": "pipe", "pipe": {"pipe_name": "finance_bigqmt_rpc"},
            "redis_enabled": False, "native_xtdata_enabled": False,
            "rpc_allow_order_methods": False, "rpc_process_in_listener": True,
            "rpc_listener_methods": ("*",), "rpc_background_threads": False,
            "schedule_adjust": True, "schedule_adjust_interval": "100nMilliSecond",
            "download_jobs_enabled": False, "exec_events_enabled": False,
            "full_tick_cache_enabled": False, "quote_push": {"enabled": False},
        },
    }
    lines = source.splitlines(keepends=True)
    edits = []
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in settings:
                edits.append((node.lineno - 1, node.end_lineno,
                              target.id + " = " + repr(settings.pop(target.id)) + "\n"))
    if settings:
        raise RuntimeError("upstream flat config block changed")
    for start, end, text in sorted(edits, reverse=True):
        lines[start:end] = [text]
    source = "".join(lines)
    # Use the package's current API-global capture list, as the upstream 0.3.76
    # builder fix does. The 0.3.74 wheel's template omitted download functions.
    start = source.index("try:\n    qmt_extra = {}\n    for function_name in (")
    end = source.index("    _runtime.bind_runtime_api(", start)
    source = (source[:start] + "try:\n    qmt_extra = _strategy.capture_qmt_injected_funcs(globals())\n"
              + source[end:])
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--builder", type=Path, required=True,
                        help="upstream tools/build_pipe_single_file_flat.py; sibling builders required")
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--account-env-file", type=Path,
                        default=Path.home() / ".codex/.env")
    args = parser.parse_args()
    account_id = read_account_id(args.account_env_file)
    if not account_id:
        raise RuntimeError("a configured account is required")
    manifest = prepare(args.destination, account_id)
    entry = args.destination.resolve() / "FINANCE_BIGQMT_READONLY_PIPE.py"
    subprocess.run([sys.executable, str(args.builder.resolve())],
                   env=dict(os.environ, BIGQMT_BUILD_OUT=str(entry)), check=True)
    entry.write_text(configure_entry(entry.read_text(encoding="gbk"), account_id),
                     encoding="gbk", newline="\n")
    config = {
        "account_id": account_id, "pipe_name": "finance_bigqmt_rpc",
        "bind_address": "tcp://0.0.0.0:15588", "timeout_seconds": 12,
    }
    (args.destination / "finance-bigqmt-relay.json").write_text(json.dumps(config))
    shutil.copy2(Path(__file__).with_name("qmt_pipe_zmq_relay.py"), args.destination)
    manifest.update(entry=entry.name, transport="pipe", relay_transport="zmq")
    manifest["files"] = {
        str(path.relative_to(args.destination)): {
            "size": path.stat().st_size, "sha256": file_sha256(path),
        }
        for path in sorted(args.destination.rglob("*"))
        if path.is_file() and path.name != "finance-bigqmt-manifest.json"
    }
    (args.destination / "finance-bigqmt-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"version": manifest["version"], "entry": entry.name,
                      "orders_enabled": False, "transport": "pipe"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
