---
description: Run arbitrary Claude CLI args through guarded Claude Router passthrough
argument-hint: '<claude args...>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a raw Claude CLI command through the shared companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Use this for installed Claude CLI features that are not first-class `claude-router` commands, such as:
- `mcp list`
- `plugin list`
- `project purge --dry-run`
- `auth status`
- `doctor`
- `respawn <id>`
- `stop <id>`

Do not use this command for normal delegated analyze/plan/exec/review work when a first-class `/claude-router:*` command exists.
Do not launch a bare interactive Claude TUI unless the user explicitly asks for it and understands it may not return cleanly through Claude Code's command runner.
Mutating Claude configuration commands and dangerous permission bypasses are blocked by default by the companion runtime.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" raw "$ARGUMENTS"
```

Return stdout and stderr verbatim, exactly as-is.
