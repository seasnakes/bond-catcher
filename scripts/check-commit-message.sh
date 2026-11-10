#!/usr/bin/env bash
# Validate Conventional Commit subjects.
#   check-commit-message.sh <message-file>     (commit-msg hook)
#   check-commit-message.sh --range <a>..<b>   (CI on pull requests)

set -euo pipefail

TYPES="feat|fix|perf|refactor|test|docs|chore|ci|build|revert|style"
# History up to this commit predates the convention and is not rechecked.
BASELINE="d8c0753e1609ccbd25c4e0543377758bf31f2378"
PATTERN="^(${TYPES})(\([a-z0-9._/-]+\))?!?: [^ ].{0,71}$"

check_subject() {
  local subject="$1"
  case "$subject" in
    "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "*) return 0 ;;
  esac
  if [[ "$subject" =~ $PATTERN ]]; then
    return 0
  fi
  echo "Invalid commit subject: $subject" >&2
  echo "Expected: <type>(<scope>): <summary>  types: ${TYPES//|/, }; summary <= 72 chars" >&2
  return 1
}

if [[ "${1:-}" == "--range" ]]; then
  exclude=()
  if git cat-file -e "${BASELINE}^{commit}" 2>/dev/null; then
    exclude=("^${BASELINE}")
  fi
  status=0
  while IFS= read -r subject; do
    check_subject "$subject" || status=1
  done < <(git log --no-merges --format=%s "$2" ${exclude[@]+"${exclude[@]}"})
  exit "$status"
fi

subject="$(grep -v '^#' "$1" | sed '/^[[:space:]]*$/d' | head -n 1)"
check_subject "$subject"
