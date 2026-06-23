---
status: accepted
date: 2026-06-22
---

# Build Claude Router as a Codex host adapter

Claude Router is a Codex plugin that delegates to the local Claude CLI. It is not a Claude Code plugin and does not replace Claude Code. This direction mirrors Codex Router directionally: Codex is now the host and Claude is the delegated runtime.

## Consequences

- Codex plugin skills and MCP tools are the primary host surface.
- Claude Code slash-command files are not used.
- Claude CLI behavior is wrapped by a companion JSON runtime for testability.
