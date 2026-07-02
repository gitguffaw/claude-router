---
description: Show Claude Router help or installed Claude CLI help for a command path
argument-hint: '[claude command path...] [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" help "$ARGUMENTS"`

Present the full command output to the user without summarizing it.
