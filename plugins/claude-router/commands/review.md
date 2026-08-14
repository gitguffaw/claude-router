---
description: Run a read-only Claude Router code review job
argument-hint: '[--background] [--lean[=auto|oauth|api]] [--model <selector>] [--effort <value>] [live Claude flags] [focus ...]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a Claude Router review job through the shared runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Return Claude's output verbatim to the user.
- Keep the review framing focused on correctness, regressions, missing tests, and actionable findings.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" review --raw-arg-string "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is.
