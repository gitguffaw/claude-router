---
description: Show the stored final output for a finished Claude Router job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" result --raw-arg-string "$ARGUMENTS"`

Present the command output. Keep a resume hint when the output includes one.
