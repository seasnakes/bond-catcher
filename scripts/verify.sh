#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VERIFY_PORT="${VERIFY_PORT:-15173}"

export NO_PROXY="${NO_PROXY:+${NO_PROXY},}127.0.0.1,localhost,::1"
export no_proxy="${no_proxy:+${no_proxy},}127.0.0.1,localhost,::1"

while IFS= read -r -d '' file; do
  node --check "$file"
done < <(
  find "$REPO_ROOT" -maxdepth 1 -type f -name '*.js' -print0
  find "$REPO_ROOT/src" "$REPO_ROOT/scripts" "$REPO_ROOT/tests" \
    -type f -name '*.js' -print0
)

while IFS= read -r -d '' file; do
  "$PYTHON_BIN" -m py_compile "$file"
done < <(find "$REPO_ROOT/scripts" -maxdepth 1 -type f -name '*.py' -print0)

node --test "$REPO_ROOT"/tests/*.js
"$PYTHON_BIN" -m unittest discover -s "$REPO_ROOT/tests" -p 'test_*.py' -v

SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/finance-board-verify.XXXXXX.log")"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

(
  cd "$REPO_ROOT"
  PORT="$VERIFY_PORT" \
  MINIQMT_API_AUTOSTART=0 \
  TDX_OPEN_ENABLED=0 \
  NEW_BOND_AUTO_SCAN_START=99:00:00 \
  NEW_BOND_AUTO_SCAN_END=99:00:01 \
  node server.js >"$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl --noproxy '*' --max-time 2 --silent --fail \
    "http://127.0.0.1:${VERIFY_PORT}/" >/dev/null; then
    break
  fi
  sleep 0.2
done

for endpoint in / /tdx-formulas.html /api/state /api/indices /api/tdx-formula-selections; do
  if ! curl --noproxy '*' --max-time 25 --silent --fail \
    "http://127.0.0.1:${VERIFY_PORT}${endpoint}" >/dev/null; then
    sed -n '1,240p' "$SERVER_LOG"
    exit 1
  fi
done

echo "Repository verification passed."
