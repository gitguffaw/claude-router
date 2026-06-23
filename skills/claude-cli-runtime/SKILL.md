---
name: claude-cli-runtime
description: Internal helper contract for invoking the claude-router companion runtime
user-invocable: false
---

# Claude CLI Runtime

Use the companion runtime instead of hand-rolled shell commands:

```bash
node scripts/claude-companion.mjs <command> [arguments]
```

The runtime is responsible for setup checks, context packs, job state, logging, cancellation, and output rendering.

Do not inspect the repository, summarize Claude output, or continue the task yourself when acting as a forwarding helper. Return the runtime output as-is.
