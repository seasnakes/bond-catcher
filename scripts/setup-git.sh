#!/usr/bin/env bash
# One-time local Git setup for this clone: hooks, commit template and safe pull defaults.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/* scripts/check-commit-message.sh
git config core.hooksPath .githooks
git config commit.template .gitmessage
git config pull.ff only
git config fetch.prune true
git config push.autoSetupRemote true

echo "Git hooks: $(git config core.hooksPath)"
echo "Commit template: $(git config commit.template)"
