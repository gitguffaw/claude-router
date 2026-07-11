---
description: Show live Claude model selectors plus curated effort and permission controls
argument-hint: '[--capability long_context|ultrathink|chrome] [--static] [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" models --raw-arg-string "$ARGUMENTS"`

Present the full model catalog output to the user. Preserve:
- live discovery status and Claude CLI version
- discovered selectors, aliases, and full names such as `fable` and `claude-fable-5`
- curated tiers, effort levels, modifiers, permission modes, and presets
- any discovery warning or error
