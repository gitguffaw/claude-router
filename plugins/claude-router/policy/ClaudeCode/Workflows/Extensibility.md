# Extensibility Workflow

Use this workflow when Codex needs to shape what Claude can see or do, not merely run Claude once.

## When to Use

- Add or validate a Claude plugin
- Define reusable skills, commands, or custom agents
- Configure project or user settings
- Add, inspect, or isolate MCP servers
- Enable browser-backed web work or research surfaces
- Debug hook, plugin, or tool-discovery behavior
- Make Claude sessions richer, not just more isolated

## Verify Before You Promise

Use the local runtime to confirm what is actually live:

```bash
claude auth status
claude agents
claude plugin list
claude mcp list
claude --help
```

Examples:

- A plugin can be documented but disabled locally.
- An MCP server can be configured but still require authentication.
- Browser automation can be documented but unavailable without the Chrome extension and a direct Anthropic plan.

## Choose The Smallest Useful Surface

| Need | Preferred Surface |
|------|-------------------|
| One session with custom behavior | CLI flags such as `--settings`, `--mcp-config`, `--agents`, or `--plugin-dir` |
| Shared user defaults | `~/.claude/settings.json` |
| Shared project MCP configuration | `.mcp.json` |
| Reusable extension bundle | Plugin directory with `.claude-plugin/plugin.json` |
| Planning without edits | `--permission-mode plan` or `/plan` |
| Cloud-reviewed planning | `/ultraplan` |
| Browser-backed web work | `--chrome` or `/chrome` |
| MCP tool discovery | Tool Search via MCP settings and supported models |

## Core Commands

```bash
claude agents
claude plugin list
claude plugin validate /path/to/plugin
claude mcp list
claude mcp get sentry
```

## Use These Surfaces As First-Class Capabilities

- Plugins can provide skills, agents, hooks, MCP, and toolchain behavior.
- Claude agents and subagents are part of the reasoning topology, not just metadata.
- MCP is part of Claude's live tool surface, not only a configuration detail.
- Settings control model defaults, available models, environment variables, and persistent session behavior.
- Browser automation is a documented Claude surface through `--chrome`, but it is distinct from generic web search.

## MCP Tool Search

- Tool Search is for discovering MCP tools on demand, not for searching the open web.
- It is enabled by default on first-party Anthropic hosts.
- When `ANTHROPIC_BASE_URL` is non-first-party, Tool Search is disabled by default unless `ENABLE_TOOL_SEARCH` is set explicitly.
- Haiku does not support Tool Search.

Example:

```bash
ENABLE_TOOL_SEARCH=auto:5 claude
```

## MCP Examples

```bash
# HTTP server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Stdio server
claude mcp add -e API_KEY=xxx my-server -- npx my-mcp-server
```

## Agent And Plugin Constraints

- Plugin-shipped agents do not support `hooks`, `mcpServers`, or `permissionMode`.
- If you need those fields, move the agent definition into `.claude/agents/` or `~/.claude/agents/`.
- Project subagents are discovered by walking up from the current working directory. Directories added through `--add-dir` are not scanned for subagents.

## Isolation Rules

- Use `--plugin-dir` for session-scoped plugin loading.
- Use `--mcp-config` plus `--strict-mcp-config` to isolate MCP behavior.
- Use `--bare` when hidden Claude state is part of the bug, not as the default.
- `claude mcp list` and `claude mcp get` can spawn stdio servers from `.mcp.json`; use them only in trusted directories.

## Notes

- `claude plugin` also accepts the alias `claude plugins`.
- Do not claim a native Claude Code web-search primitive when the actual surface is browser automation, MCP Tool Search, or explicit docs research.
