---
description: Show installed Claude CLI help plus Claude Router coverage
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" surface --raw-arg-string "$ARGUMENTS"`

Present the full command output to the user without summarizing it.
