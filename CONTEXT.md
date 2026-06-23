# Claude Router Plugin

This context defines the language for Claude Router as a Codex-hosted Claude CLI delegation contract.

## Language

**Claude Router Plugin**:
A Codex plugin bundle that invokes the local Claude CLI through policy-backed modes and deterministic job management.
Avoid: standalone Claude CLI, replacement for Claude Code, Claude Code plugin.

**Claude Router Core**:
The host-independent runtime contract for routing, executing, tracking, and retrieving Claude CLI work.
Avoid: Codex plugin UI, raw shell command.

**Codex Host Adapter**:
The Codex plugin layer that exposes Claude Router Core through Codex skills and MCP tools.
Avoid: Claude Router Core.

**Claude CLI**:
The local Anthropic `claude` command-line runtime invoked by the plugin.
Avoid: Codex model, Codex plugin runtime.

**Policy Docs**:
The vendored `ClaudeCode` skill files under `policy/ClaudeCode`, used as the readable source of truth for route selection and constraints.
Avoid: generated prompt only.

## Relationships

- The Claude Router Plugin is a Codex Host Adapter.
- The Codex Host Adapter invokes the Claude Router Core.
- The Claude Router Core invokes the Claude CLI.
- Policy Docs define routing intent; runtime code enforces deterministic behavior.
