---
description: Check whether the local Claude CLI is ready for Claude Router
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" setup "$ARGUMENTS"`

Present the full setup output to the user. Preserve Claude availability, auth, plugin, MCP status, and next steps exactly as reported.
