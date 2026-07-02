---
description: Show Claude Router and installed Claude CLI versions
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" version "$ARGUMENTS"`

Present the full command output to the user without summarizing it.
