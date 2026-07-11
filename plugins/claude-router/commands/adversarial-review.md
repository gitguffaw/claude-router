---
description: Run a read-only Claude Router review that challenges approach and assumptions
argument-hint: '[--background] [--timeout-ms <ms>] [--model <selector>] [--effort low|medium|high|xhigh|max] [focus ...]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run an adversarial Claude Router review through the shared runtime.
Position it as a challenge review that challenges implementation approach, design choices, tradeoffs, and assumptions.
It is not just a stricter pass over implementation defects.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Return Claude's output verbatim to the user.
- Keep the framing focused on whether the current approach is the right one, what assumptions it depends on, and where the design could fail under real-world conditions.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" adversarial-review --raw-arg-string "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is.
