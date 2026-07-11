---
description: Cancel an active Claude Router background job
argument-hint: '<job-id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" cancel --raw-arg-string "$ARGUMENTS"`
