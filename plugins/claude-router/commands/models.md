---
description: Show current model examples, choices, and fields from the installed Claude CLI
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" models --raw-arg-string "$ARGUMENTS"`

Present the full model catalog output to the user. Preserve:
- live discovery status and Claude CLI version
- the `documented-examples` completeness limit for model selectors
- discovered selectors, aliases, and full names such as `fable` and `claude-fable-5`
- live CLI fields, effort and permission choices, and lean-profile availability
- any discovery warning or error
