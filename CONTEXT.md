# Claude Router

This context defines the language for Claude Router as a Codex-hosted MCP delegation contract for the local Claude CLI.

## Language

**Claude Router**:
A Codex-facing MCP server and companion runtime that invokes the local Claude CLI through policy-backed modes and deterministic job management.
Avoid: standalone Claude CLI, replacement for Claude Code, Claude Code plugin, slash command, skill-only package.

**Claude Router MCP Server**:
The stdio MCP server exposed by `scripts/claude-router-mcp.mjs`, registered with Codex through `codex mcp add`, and surfaced to Codex as `claude_router_*` tools.
Avoid: Codex marketplace plugin, `/` command, `$` skill trigger.

**Claude Router Core**:
The host-independent runtime contract for routing, executing, tracking, and retrieving Claude CLI work.
Avoid: Codex UI, raw shell command.

**Codex Host Adapter**:
The Codex-facing adapter that exposes Claude Router Core primarily through MCP tools. The `.codex-plugin/plugin.json` manifest is metadata/scaffolding unless the repo is later packaged as a real Codex marketplace plugin.
Avoid: Claude Router Core.

**Claude CLI**:
The local Anthropic `claude` command-line runtime invoked by Claude Router.
Avoid: Codex model, Codex plugin runtime.

**Policy Docs**:
The vendored `ClaudeCode` skill files under `policy/ClaudeCode`, used as the readable source of truth for route selection and constraints.
Avoid: generated prompt only.

## Relationships

- Claude Router is currently distributed and installed as an MCP server, not as a Codex marketplace plugin.
- The Claude Router MCP Server is the active Codex Host Adapter.
- The Codex Host Adapter invokes the Claude Router Core.
- The Claude Router Core invokes the Claude CLI.
- Policy Docs define routing intent; runtime code enforces deterministic behavior.
- Codex plugin metadata may exist in the repo, but it is not the validated user install path unless marketplace packaging is added.
