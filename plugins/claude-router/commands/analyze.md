---
description: Run a policy-backed read-only Claude analysis job
argument-hint: '[--background] [--model <selector>] [--effort low|medium|high|xhigh|max] [--chrome] [prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a Claude Router analyze job through the shared runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is read-only.
- Do not edit files, apply patches, or fix issues yourself.
- The companion runtime records the selected policy, mode, controls, and git state in a context pack.
- Preserve model, effort, plugin, MCP, settings, agent, tool, resume, and streaming flags exactly.
- Do not add `--search`; Claude Router intentionally does not expose a generic native web-search mode. Use `--chrome` or explicit MCP/docs tooling when the user asks for web-aware work.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" analyze "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is.
