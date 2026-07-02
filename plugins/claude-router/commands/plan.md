---
description: Run a policy-backed read-only Claude planning job
argument-hint: '[--background] [--model <selector>] [--effort low|medium|high|xhigh|max] [--chrome] [prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a Claude Router plan job through the shared runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is read-only.
- Do not edit files, apply patches, or fix issues yourself.
- Preserve model, effort, plugin, MCP, settings, agent, tool, resume, and streaming flags exactly.
- Do not convert the plan into implementation work in this Claude Code turn.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" plan "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is.
