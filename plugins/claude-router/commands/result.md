---
description: Show the stored final output for a finished Claude Router job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" result --raw-arg-string "$ARGUMENTS"`

Present the full command output to the user. Preserve job ID, status, context pack, resume hint, full result payload, warnings, and errors.
