#!/bin/zsh
set -eu

TASK_ROOT="${FINANCE_ROOT_PATH:-${0:A:h:h}}"
TASK_LOG="$TASK_ROOT/finance-board.log"
TASK_NODE="${FINANCE_NODE_PATH:-/Users/seasnake/.nvm/versions/node/v22.22.1/bin/node}"
TASK_MAX_LOG_BYTES="${FINANCE_MAX_LOG_BYTES:-$((100 * 1024 * 1024))}"
TASK_LOG_BACKUPS="${FINANCE_LOG_BACKUPS:-5}"

if [[ -f "$TASK_LOG" ]] && (( $(stat -f %z "$TASK_LOG") >= TASK_MAX_LOG_BYTES )); then
  TASK_ARCHIVE="$TASK_ROOT/finance-board-$(date +%Y%m%d-%H%M%S).log"
  mv -- "$TASK_LOG" "$TASK_ARCHIVE"
  TASK_ARCHIVES=("$TASK_ROOT"/finance-board-*.log(N.om))
  if (( ${#TASK_ARCHIVES} > TASK_LOG_BACKUPS )); then
    for TASK_EXPIRED in ${TASK_ARCHIVES[$((TASK_LOG_BACKUPS + 1)),-1]}; do
      rm -f -- "$TASK_EXPIRED"
    done
  fi
fi

if [[ "${FINANCE_ROTATE_ONLY:-0}" == "1" ]]; then
  exit 0
fi

exec "$TASK_NODE" "$TASK_ROOT/server.js" >>"$TASK_LOG" 2>&1
