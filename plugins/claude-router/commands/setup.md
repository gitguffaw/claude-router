---
description: Check whether the local Claude CLI is ready for Claude Router
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" setup --raw-arg-string "$ARGUMENTS"`

Present the setup output as reported.
