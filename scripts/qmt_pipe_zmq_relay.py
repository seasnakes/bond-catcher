#!/usr/bin/env python3
"""Expose the existing finance ZMQ endpoint from outside the QMT strategy.

Run on the same Windows host as the single-file named-pipe strategy. The
strategy uses its local pipe; this separate process owns the network socket.
Trading and arbitrary code execution are not forwarded.
"""

import argparse
import json
import signal
import threading

from bigqmt_signal_trader.redis_rpc import METHOD_ALIASES, READ_METHODS
from bigqmt_signal_trader.transports.pipe_transport import NamedPipeTransport
from bigqmt_signal_trader.transports.zmq_transport import ZmqTransport


DATA_DOWNLOAD_METHODS = frozenset((
    "download_history_data", "download_history_data2",
    "submit_download_history_data", "submit_download_history_data2",
    "wait_download",
))
ALLOWED_METHODS = frozenset(
    method for method in READ_METHODS
    if method.startswith(("get_", "query_", "is_")) or method == "ping"
) | DATA_DOWNLOAD_METHODS


class ReadOnlyPipeRelay(object):
    def __init__(self, account_id, transport, timeout_seconds=12):
        self.account_id = str(account_id)
        self.transport = transport
        self.timeout_seconds = float(timeout_seconds)

    def forward(self, request):
        method = str(request.get("method") or "")
        canonical = METHOD_ALIASES.get(method, method)
        if str(request.get("account_id") or "") != self.account_id:
            raise PermissionError("relay account mismatch")
        if canonical not in ALLOWED_METHODS:
            raise PermissionError("method is not enabled on the read-only relay")
        # Peer/socket routing hints belong to ZMQ and cannot be JSON encoded
        # into the QMT-side pipe. Preserve the public request envelope.
        payload = {key: value for key, value in request.items()
                   if not key.startswith("_")}
        response = self.transport.send_request(payload, self.timeout_seconds)
        if not isinstance(response, dict) or response.get("request_id") != request.get("request_id"):
            raise RuntimeError("pipe reply does not match the request")
        return response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    with open(args.config, "r") as source:
        config = json.load(source)
    account_id = str(config["account_id"])
    pipe = NamedPipeTransport(
        account_id=account_id, pipe_name=config.get("pipe_name", "finance_bigqmt_rpc"),
        connect_timeout_seconds=2,
    )
    relay = ReadOnlyPipeRelay(account_id, pipe, config.get("timeout_seconds", 12))
    server = ZmqTransport(
        account_id=account_id,
        bind_address=config.get("bind_address", "tcp://0.0.0.0:15588"),
    )
    stopped = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_args: stopped.set())
    try:
        server.start_receiving(relay.forward, background_threads=True)
        print("FINANCE_QMT_PIPE_RELAY_READY orders_enabled=False", flush=True)
        stopped.wait()
    finally:
        server.stop()
        pipe.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
