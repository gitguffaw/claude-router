---
name: claude-router
description: Use Claude Router from AGY to delegate work to the local Claude Code CLI through the repository runtime or MCP server.
---

# Claude Router For AGY

Use this skill when AGY should delegate work to the local Anthropic `claude` CLI through the `gitguffaw/claude-router` repository.

## Scope

- This is the AGY entrypoint for `claude-router` only.
- Do not install, clone, configure, or invoke `codex-router` from this skill.
- Do not route through `~/.codex/app-server.sock`; that socket is for Codex-hosted workflows, not Claude Router.
- Claude Router invokes the local `claude` command through the runtime under `plugins/claude-router`.

## AGY Plugin Commands

When installing or validating this plugin through the AGY CLI, use `.agy` as the plugin root:

```bash
agy plugin validate .agy
agy plugin install .agy
agy plugin list
agy plugin enable claude-router
agy plugin disable claude-router
agy plugin uninstall claude-router
```

Do not pass the repository root to `agy plugin validate` or `agy plugin install`; AGY expects `plugin.json` at the root of the path it is given.

AGY imports this skill registration from `.agy`. The runnable Claude Router scripts live in the surrounding repository checkout under `plugins/claude-router`, so keep or locate that checkout before invoking direct runtime commands.

## Runtime

From the repository root, use the companion runtime:

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs <mode> [arguments]
```

Available modes:

- `setup`: check Node, Claude CLI, auth, Claude plugins, and Claude MCP status
- `surface`: report installed Claude version, top-level help, and router coverage
- `help`: show installed Claude help for a command path
- `analyze`: read-only facts, tradeoffs, recommendations, and next action
- `plan`: read-only implementation or migration plan
- `exec`: write-capable implementation; use only when the user asks for edits
- `review`: read-only code review; findings first and no auto-fixes
- `ultrareview`: run Claude's cloud-hosted `ultrareview`
- `status`: list or inspect Claude Router jobs
- `result`: fetch a stored job result
- `cancel`: cancel a background job
- `version`: show Claude Router and installed Claude CLI versions
- `models`: return live Claude model selectors plus curated effort levels, permission modes, and modifier flags
- `raw`: run exact Claude CLI args with mutation and dangerous-permission guardrails

Examples:

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs help
node scripts/claude-companion.mjs version
node scripts/claude-companion.mjs analyze --cwd /path/to/project "map the architecture"
node scripts/claude-companion.mjs plan --cwd /path/to/project --background "plan the migration"
node scripts/claude-companion.mjs status --cwd /path/to/project
node scripts/claude-companion.mjs result --cwd /path/to/project <job-id>
node scripts/claude-companion.mjs models
node scripts/claude-companion.mjs models --capability ultrathink
```

## Model Catalog Output

The `models` mode queries the installed Claude CLI help for accepted `--model` selectors, then returns a structured catalog with these sections:

- **discovery**: Live model discovery status, Claude CLI version, selectors, aliases, full names, and any discovery error
- **models**: Selectors accepted by the installed Claude CLI plus curated fallback selectors
- **tiers**: Model tiers (haiku, sonnet, opus) with context window, long-context and ultrathink support, and cost tier
- **effort_levels**: Reasoning depth controls (low, medium, high, xhigh, max) with token budgets
- **modifiers**: Boolean session flags (`--long-context`, `--ultrathink`, `--chrome`, `--no-chrome`, `--bare`) with tier compatibility
- **permission_modes**: Session permission controls with activation rules
- **presets**: Shortcut flags (`--best` resolves to opus)

### Permission Modes

| Mode | Flag Value | Requires `--allow-dangerous` |
| --- | --- | --- |
| default | `default` | No |
| plan | `plan` | No |
| bypassPermissions | `bypassPermissions` | Yes |

### Capability Filter

Pass `--capability <value>` to filter known tiers and model selectors. Valid values: `long_context`, `ultrathink`, `chrome`. Unknown values are rejected with an error. Use `--static` to skip live CLI help discovery.

## MCP Server

If AGY can attach to a local MCP server for this plugin, start the server from the repository root with:

```bash
node plugins/claude-router/scripts/claude-router-mcp.mjs
```

The MCP server exposes the `claude_router_*` tools for setup, surface discovery, help, version, raw passthrough, analyze, plan, exec, review, ultrareview, models, status, result, and cancel.

## Routing Rules

- Use `models` to discover live model selectors, known model tiers, effort levels, permission modes, and modifiers before selecting Claude controls for a task.
- Run `setup` before the first delegated task when local Claude availability is unknown.
- Use `analyze`, `plan`, and `review` only for read-only work.
- Use `exec` only when the user explicitly wants Claude to edit files.
- Use `surface` or `help` before relying on less-common Claude CLI behavior.
- Use `raw` only for Claude CLI features not covered by curated modes.
- Do not use dangerous permission bypass unless the user explicitly accepts that risk.
- If Claude Router fails, report the failure and do not replace Claude's output with an invented result.

## Auth Notes

Claude Router depends on the local `claude` CLI being installed and authenticated. In the AGY desktop app, child processes should normally inherit the user's macOS GUI session. In detached or daemonized CLI sessions, `claude auth status` may fail if the process cannot access the same auth context. If that happens, report the auth failure and ask the user to run from the AGY desktop app or an interactive shell with working Claude auth.
