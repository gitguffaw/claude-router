---
status: accepted
date: 2026-06-22
---

# Use Claude print mode as the first reliable runtime

The initial Claude Router runtime uses `claude -p` for controllable jobs. Interactive TUI automation is deferred because background execution, cancellation, structured output, and result storage are easier to make reliable through print mode.

## Consequences

- Interactive Claude remains available through generated resume or launch hints.
- The runtime can be tested with a fake `claude` binary.
- Future work can add richer interactive control after the core job contract is stable.
