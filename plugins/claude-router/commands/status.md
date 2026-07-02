---
description: Show active and recent Claude Router jobs for this repository
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID, keep the output compact and preserve the job table fields. If the user did pass a job ID, present the full command output.
