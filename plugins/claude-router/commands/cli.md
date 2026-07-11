---
description: Alias for guarded raw Claude CLI passthrough
argument-hint: '<claude args...>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a raw Claude CLI command through the shared companion runtime.
This is an alias for `/claude-router:raw`, included for command-palette parity with router plugins that call the raw escape hatch `cli`.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" raw --raw-arg-string "$ARGUMENTS"
```

Return stdout and stderr verbatim, exactly as-is.
