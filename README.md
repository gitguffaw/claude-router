# Claude Router for Codex

Claude Router lets Codex call the local Claude Code CLI as a second coding runtime. It exposes Claude through MCP tools for analysis, planning, implementation, review, background jobs, status/result retrieval, and guarded access to the full installed Claude CLI.

Use it when you want Codex to delegate a specific task to Claude instead of merely talking about what Claude might do.

## Requirements

- Node.js 18.18 or newer
- Codex CLI with MCP support
- Claude Code CLI installed locally
- Claude Code already authenticated

Check the basics:

```bash
node --version
codex --version
claude --version
claude auth status
```

## Install

Clone the repo:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
```

No `npm install` is required; the runtime uses Node built-ins.

Run the local setup check:

```bash
node scripts/claude-companion.mjs setup
```

Register the MCP server with Codex:

```bash
node scripts/install-codex-mcp.mjs
```

Confirm Codex registered the MCP server:

```bash
codex mcp list
codex mcp get claude-router
```

You should see a row named `claude-router`. The stored command should use an absolute Node path, for example `/opt/homebrew/bin/node` or `/usr/local/bin/node`. This matters for Codex Desktop because GUI apps often do not inherit your terminal shell `PATH`.

The installer also starts the MCP server directly and checks that it can return the `claude_router_setup` tool. A successful install prints an `MCP server check: ok` line.

This does not appear in `codex plugin list`; that command only lists plugins from configured marketplaces.

Then start a new Codex session. MCP tools are loaded when a session starts, so an already-open Codex thread will not gain the `claude_router_*` tools until you start a new one.

Ask for Claude Router explicitly, for example:

```text
Use Claude Router to analyze this repository and identify the riskiest part of the architecture.
```

## Using In Codex

Claude Router is installed as an MCP server, not as a slash command, skill, or marketplace plugin.

That means you do not invoke it with `/claude-router`, `$claude-router`, or `@claude-router`. In a Codex chat, ask Codex to use it by name:

```text
Use Claude Router to check my local setup.
```

```text
Use claude-router to analyze this repository. Do not edit files.
```

```text
Use the `claude_router_review` MCP tool to review my current diff.
```

If Codex does not pick the tool automatically, name the exact MCP tool:

```text
Use `claude_router_setup` and report the result.
```

```text
Use `claude_router_exec` to implement the narrowest fix for the failing tests.
```

If Codex says it cannot find Claude Router after install, start a new Codex session. MCP servers are loaded when a session starts.

## What Gets Installed

The MCP server exposes these tools to Codex:

- `claude_router_setup`: check Node, Claude, auth, Claude plugins, and Claude MCP config
- `claude_router_surface`: report the installed Claude CLI version and top-level help
- `claude_router_help`: show help for an installed Claude subcommand
- `claude_router_analyze`: read-only analysis
- `claude_router_plan`: read-only implementation or migration planning
- `claude_router_exec`: write-capable implementation
- `claude_router_review`: read-only code review
- `claude_router_ultrareview`: run Claude's cloud-hosted `ultrareview`
- `claude_router_status`: list or inspect jobs
- `claude_router_result`: fetch a stored job result
- `claude_router_cancel`: cancel a background job
- `claude_router_raw`: run raw Claude CLI args with guardrails

## Common Uses

Ask Claude for read-only analysis:

```text
Use Claude Router to analyze the auth flow. Do not edit files.
```

Ask Claude for a plan:

```text
Use Claude Router to plan a migration from the current MCP adapter to a fuller plugin surface.
```

Ask Claude to implement:

```text
Use Claude Router exec to implement the narrowest fix for the failing tests.
```

Ask Claude to review:

```text
Use Claude Router review on my current diff. Findings first, no auto-fixes.
```

Run a long task in the background:

```text
Use Claude Router to run a background analysis of this repo's extension points.
```

Then ask:

```text
Show Claude Router job status.
Get the latest Claude Router result.
Cancel the running Claude Router job.
```

## Direct CLI Usage

You can use the runtime without Codex MCP. Pass `--cwd` when the target project is not the Claude Router repo.

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs analyze --cwd /path/to/project "map the architecture"
node scripts/claude-companion.mjs plan --cwd /path/to/project --background "plan the migration"
node scripts/claude-companion.mjs status --cwd /path/to/project
node scripts/claude-companion.mjs result --cwd /path/to/project <job-id>
node scripts/claude-companion.mjs cancel --cwd /path/to/project <job-id>
```

Claude controls pass through:

```bash
node scripts/claude-companion.mjs analyze --cwd /path/to/project --model opus --effort high "inspect performance risks"
node scripts/claude-companion.mjs plan --cwd /path/to/project --chrome "research and plan the browser workflow"
node scripts/claude-companion.mjs exec --cwd /path/to/project --allowed-tools "Read,Edit" "apply the requested fix"
```

## Full Claude CLI Access

Claude Router has curated tools for common workflows, plus `help` and `raw` for Claude features that do not deserve a bespoke MCP tool.

Check local Claude support:

```bash
node scripts/claude-companion.mjs surface
node scripts/claude-companion.mjs help mcp add
node scripts/claude-companion.mjs help plugin install
```

Run a non-mutating raw Claude command:

```bash
node scripts/claude-companion.mjs raw -- mcp list
node scripts/claude-companion.mjs raw -- plugin list
```

Mutating Claude configuration commands are blocked unless explicitly allowed:

```bash
node scripts/claude-companion.mjs raw --allow-mutating -- mcp add my-server -- node server.mjs
```

Dangerous permission bypass is also blocked unless explicitly allowed:

```bash
node scripts/claude-companion.mjs raw --allow-dangerous -- -p --permission-mode bypassPermissions "trusted sandbox task"
```

## Modes

| Mode | Writes files? | What it does |
| --- | --- | --- |
| `analyze` | No | Facts, tradeoffs, recommendations, next action |
| `plan` | No | Concrete implementation or migration plan |
| `exec` | Yes | Narrow implementation with summary and verification |
| `review` | No | Findings-first review without auto-fixes |
| `ultrareview` | No | Claude cloud-hosted multi-agent review |
| `surface` | No | Installed Claude version and top-level help |
| `help` | No | Help for a Claude command path |
| `raw` | Depends | Exact Claude CLI args with mutation and danger guardrails |

Read-only modes snapshot git status before and after Claude runs. If Claude changes files during `analyze`, `plan`, or `review`, the job is marked `completed-with-warnings`.

## Background Jobs

Use `--background` for long tasks:

```bash
node scripts/claude-companion.mjs analyze --cwd /path/to/project --background "inspect all extension points"
```

The command returns a job id. Use:

```bash
node scripts/claude-companion.mjs status --cwd /path/to/project
node scripts/claude-companion.mjs status --cwd /path/to/project <job-id>
node scripts/claude-companion.mjs result --cwd /path/to/project <job-id>
node scripts/claude-companion.mjs cancel --cwd /path/to/project <job-id>
```

Job state is stored outside the repo by default under `CLAUDE_ROUTER_DATA`, `CODEX_PLUGIN_DATA`, or the system temp directory.

## Codex Plugin Packaging

This repo includes Codex plugin metadata: `.codex-plugin/plugin.json` points at `skills/` and `.mcp.json`.

The reliable install path today is the global MCP registration shown above:

```bash
node scripts/install-codex-mcp.mjs
```

Do not run this and expect it to work:

```bash
codex plugin marketplace add gitguffaw/claude-router
```

Codex marketplace installs require a marketplace repository layout, usually with plugins under `plugins/<name>/` and a `.agents/plugins/marketplace.json` manifest. If you publish Claude Router through a marketplace, install it with:

```bash
codex plugin marketplace add <marketplace-repo-or-path>
codex plugin add claude-router@<marketplace-name>
```

## Troubleshooting

### `claude-router` does not show up in Codex

Check the MCP registry, not the plugin registry:

```bash
codex mcp list
codex mcp get claude-router
```

If there is no `claude-router` entry, register it again from the cloned repo:

```bash
node scripts/install-codex-mcp.mjs
```

If `codex mcp get claude-router` shows `command: node` instead of an absolute path, rerun `node scripts/install-codex-mcp.mjs`. A bare `node` command can work in Terminal and still fail when Codex Desktop starts the MCP server.

If `claude-router` appears in `codex mcp list` but the tools are not available in your current Codex thread, start a new Codex session. Existing sessions do not reload newly added MCP servers.

If `codex mcp list` shows `claude-router` but startup still fails, run:

```bash
node scripts/claude-companion.mjs setup
```

If setup says `claude not found`, install Claude Code and make sure `claude` is on `PATH`.

If setup says auth is missing, run:

```bash
claude auth login
```

If Claude runs against the wrong project, pass `cwd` through the MCP tool or use `--cwd` with the direct CLI.

If `raw` refuses to run a command, it probably detected a Claude config mutation or dangerous permission mode. Use `--allow-mutating` or `--allow-dangerous` only when that is the explicit intent.

If you need web/browser-backed work, use Claude's `--chrome` path. Claude Router does not claim Claude has a generic native web-search command.

## Development

Run tests:

```bash
npm test
```

Validate the plugin manifest:

```bash
npm run validate:plugin
```

## License

Apache-2.0. This project is independent and is not affiliated with Anthropic or OpenAI.
