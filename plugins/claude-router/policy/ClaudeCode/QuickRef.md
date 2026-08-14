# Claude Code CLI Quick Reference

Working snapshot for the local Anthropic `claude` CLI. It is explanatory, never an allowlist. Re-read `claude --help` for models, choices, and flags before routing.

## Current Local Environment

- Auth: logged in with first-party `claude.ai`
- Subscription: `max`
- Built-in/plugin agents and connected MCP servers are local-install dependent; confirm with `claude agents`, `claude plugin list`, and `claude mcp list` before promising availability.
- Plugin, MCP, agent, and model availability is machine-local and must be read live before use.

## Codex Interop Defaults

- Preferred second-brain route: interactive `claude`
- Preferred planning route: `claude --permission-mode plan`
- Preferred machine-readable entrypoint: `python3 scripts/claude_print.py`
- Preferred lean OAuth behavior: `--safe-mode`
- Preferred lean API-key behavior: `--bare`
- Preferred print-mode schema input: file via `--schema-file`

## Model Selectors

Run `claude --help` or Claude Router `models`. Pass the selected value through unchanged. Moving aliases, full names, suffixes, and provider mappings can change independently of this file.

## Effort Levels

Read the current `--effort` choices from `claude --help`. Claude Router treats them as opaque strings so future values work without a router update.

## Planning And Research Surfaces

| Surface | How | Notes |
|---------|-----|-------|
| Local plan mode | `claude --permission-mode plan` or `/plan` | Read and analyze before edits; separate caveats apply to `auto` mode and `/ultraplan`, not local plan mode itself |
| Built-in planning agent | `Plan` via `/agents` | Present in the local runtime |
| Repo and docs exploration | `Explore` via `/agents` or `--agent Explore` when available | Prefer for Claude-led exploration inside the repo or doc set |
| Ultraplan | `/ultraplan` | Cloud review surface; research preview; requires Claude Code on the web plus GitHub; Anthropic first-party only |
| Browser-backed web work | `claude --chrome` or `/chrome` | Documented browser automation; beta; requires Chrome or Edge, Claude in Chrome extension, and a direct Anthropic plan |
| MCP Tool Search | Default on first-party hosts; use settings or `ENABLE_TOOL_SEARCH` only to override behavior | MCP tool discovery, not generic web search; requires Sonnet 4+ or Opus 4+; Haiku does not support it |
| Research agents | `claude agents` or `/agents` | Use built-in `Explore` and installed research agents when available |

## Primary Modes

| Mode | Entry | Best Use |
|------|-------|----------|
| Interactive | `claude [prompt]` | Second-brain reasoning, planning, live tool use, slash commands, browser work, session reuse |
| Print | `claude -p [prompt]` | CI, shell pipelines, JSON output, schema-validated extraction |

## Print-Mode Flags

| Flag | Meaning |
|------|---------|
| `-p`, `--print` | Print response and exit |
| `--output-format <text|json|stream-json>` | Control output shape |
| `--input-format <text|stream-json>` | Control input shape for print mode |
| `--json-schema <schema>` | Enforce a JSON output contract |
| `--include-partial-messages` | Include partial chunks in `stream-json` mode |
| `--include-hook-events` | Include hook lifecycle events in `stream-json` mode |
| `--replay-user-messages` | Re-emit user messages in stream mode |
| `--max-budget-usd <amount>` | Cap API spend for print mode |
| `--no-session-persistence` | Disable saved sessions in print mode |

## Session And Policy Flags

| Flag | Meaning |
|------|---------|
| `--permission-mode <mode>` | Set the permission policy; read current choices from installed help |
| `--tools <tools...>` | Set the built-in tool list |
| `--allowed-tools <tools...>` | Explicitly allow tool patterns |
| `--disallowed-tools <tools...>` | Explicitly deny tool patterns |
| `--agent <agent>` | Select one configured agent |
| `--agents <json>` | Define custom agents inline |
| `--model <model>` | Select the model |
| `--effort <value>` | Select an effort value accepted by the installed CLI |
| `--chrome` | Enable Claude in Chrome integration |
| `--add-dir <directories...>` | Add tool-access directories |
| `--safe-mode` | Disable customizations while retaining normal OAuth/auth behavior |
| `--bare` | Minimal API/provider mode; skips OAuth and keychain reads |
| `--settings <file-or-json>` | Load extra settings from a file or JSON string |
| `--setting-sources <sources>` | Limit settings sources to `user`, `project`, and `local` |
| `--mcp-config <configs...>` | Load MCP config from JSON files or strings |
| `--strict-mcp-config` | Ignore all MCP config except `--mcp-config` |
| `--plugin-dir <path>` | Load plugins for this session only |

## Second-Brain Session Patterns

```bash
# Planning-first session
claude --permission-mode plan --model opus

# Highest-capability reasoning
claude --model opus --effort xhigh

# Deepest local reasoning
claude --model opus --effort max

# Long-context analysis
claude --model opus[1m] --effort xhigh

# Browser-backed web work
claude --chrome --model sonnet --effort high
```

## Session Control Flags

| Flag | Meaning |
|------|---------|
| `-c`, `--continue` | Continue the most recent conversation in the current directory |
| `-r`, `--resume [value]` | Resume by session ID or open picker |
| `--fork-session` | Fork when resuming instead of reusing the same session |
| `-w`, `--worktree [name]` | Create a git worktree for the session |
| `--ide` | Auto-connect to a single detected IDE |
| `-n`, `--name <name>` | Set the session display name |

## Top-Level Commands

| Command | Purpose |
|---------|---------|
| `claude` | Start an interactive session |
| `claude agents` | List configured agents |
| `claude auth` | Manage authentication |
| `claude auto-mode` | Inspect auto-mode classifier configuration |
| `claude doctor` | Check updater health |
| `claude install` | Install native build |
| `claude mcp` | Configure and manage MCP servers |
| `claude plugin` / `claude plugins` | Manage Claude Code plugins |
| `claude setup-token` | Set up a long-lived authentication token |
| `claude update` / `claude upgrade` | Check for and install updates |

## High-Value MCP And Plugin Commands

```bash
# List MCP servers
claude mcp list

# Add an HTTP MCP server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Add a stdio MCP server
claude mcp add -e API_KEY=xxx my-server -- npx my-mcp-server

# List plugins
claude plugin list

# Validate a plugin
claude plugin validate /path/to/plugin
```

## High-Value Session Commands

These should be re-checked when CLI builds change.

| Command | Purpose |
|---------|---------|
| `/model` | Switch model or `[1m]` variant |
| `/effort` | Adjust reasoning depth |
| `/agents` | Inspect and manage agents |
| `/plan` | Keep Claude in planning mode for read and analysis work |
| `/ultraplan` | Hand planning to Claude Code on the web for cloud review |
| `/chrome` | Inspect or enable browser automation state |
| `/mcp` | Inspect MCP connection and auth state |
| `/resume` | Reopen prior Claude sessions |
| `/plugin` | Inspect plugin state when available |
| `/help` | Show help and available commands |
| `/hooks` | Inspect hook configuration |

## Config Files And Paths

| Path | Format | Scope | Purpose |
|------|--------|-------|---------|
| `~/.claude/settings.json` | JSON | User | Shared CLI and extension settings |
| `.mcp.json` | JSON | Project | Project MCP server definitions |
| `.claude/agents/*.md` | Markdown | Project | Project-scoped subagents |
| `~/.claude/agents/*.md` | Markdown | User | User-scoped subagents |
| `.claude-plugin/plugin.json` | JSON | Plugin | Plugin manifest |
| `hooks/hooks.json` | JSON | Plugin | Hook configuration |
| `commands/*.md` | Markdown | Plugin | Custom slash-command files |
| `agents/*.md` | Markdown | Plugin | Custom agent definitions |
| `skills/<SkillName>/SKILL.md` | Markdown | Plugin | Skill entrypoint |
| `output-styles/*.md` | Markdown | Plugin | Output style definitions |
| `bin/*` | Executable | Plugin | Helper executables on `PATH` |

## Official Plugin Layout

```text
plugin-root/
├── .claude-plugin/plugin.json
├── skills/<skill>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── settings.json
├── .mcp.json
├── output-styles/*.md
├── bin/*
└── scripts/*
```

## Caveats

- There is no documented native Claude Code `web search` command.
- Browser-backed research is a Chrome integration feature, not a generic CLI search primitive.
- MCP Tool Search is about deferring and discovering MCP tools, not searching the open web.
- `model` is an initial selection, not enforcement. Use allowlists and pinned defaults when you need stricter control.
- 1M context depends on the model, plan, and provider. If the picker does not show `[1m]`, restart the session or verify account support.
