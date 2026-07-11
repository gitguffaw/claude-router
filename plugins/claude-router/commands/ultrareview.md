---
description: Run Claude's cloud-hosted ultrareview command
argument-hint: '[--timeout <minutes>] [target]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" ultrareview --raw-arg-string "$ARGUMENTS"`

Present the full ultrareview output to the user without summarizing it.
