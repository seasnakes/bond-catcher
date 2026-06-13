# AGENTS.md

This repository is a local finance board app, usually worked on at
`/Users/seasnake/code/snake/finance` on macOS.

## Workflow

- Keep source changes focused on the requested behavior.
- Prefer a development branch and pull request for larger fixes.
- Direct `main` commits are acceptable when the user explicitly asks to update the remote version.
- Treat `data/board-state.json` as application state: do not commit it by default, but do commit it when the user says the local board data should become the shared/default data.

## Commit Scope

- Commit source files that belong to the task.
- Avoid committing local logs, temporary scripts, generated artifacts, or recovered snapshots.
- Preserve user-edited board data unless the user explicitly asks to restore or replace it.

## Validation

Before committing JavaScript changes, run:

```bash
node --check server.js
node --check app.js
git diff --check -- app.js server.js
```

For server/API changes, smoke test the local app:

```bash
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/state
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/indices
```

## Local Service

The macOS LaunchAgent is usually:

```text
~/Library/LaunchAgents/com.seasnake.finance-board.plist
```

Useful commands:

```bash
launchctl print gui/$(id -u)/com.seasnake.finance-board | rg 'state =|pid =|last exit code'
launchctl kickstart -k gui/$(id -u)/com.seasnake.finance-board
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

## GitHub

- Remote: `https://github.com/seasnakes/finance-board.git`
- Default branch: `main`
- When publishing changes, stage explicit paths so unrelated local edits are not included accidentally.
