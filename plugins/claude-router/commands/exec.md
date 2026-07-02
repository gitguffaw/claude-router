---
description: Run a policy-backed write-capable Claude execution job
argument-hint: '[--background] [--model <selector>] [--effort low|medium|high|xhigh|max] [--chrome] [prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a Claude Router exec job through the shared runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This is the command that intentionally starts write-capable Claude work.
- Keep all user prompt text inside the companion runtime arguments; do not reinterpret or implement it in this outer Claude Code turn.
- Preserve model, effort, plugin, MCP, settings, agent, tool, resume, and streaming flags exactly.
- Dangerous permission bypass remains blocked by the companion runtime unless the user explicitly requested and supplied the required override.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" exec "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is.
