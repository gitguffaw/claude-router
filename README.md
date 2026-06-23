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
CLAUDE_ROUTER_DIR="$(pwd)"
codex mcp add claude-router -- node "$CLAUDE_ROUTER_DIR/scripts/claude-router-mcp.mjs"
```

Confirm Codex can see it:

```bash
codex mcp list
```

Then start a new Codex session and ask for Claude Router explicitly, for example:

```text
Use Claude Router to analyze this repository and identify the riskiest part of the architecture.
```

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

This repo is shaped as a Codex plugin: `.codex-plugin/plugin.json` points at `skills/` and `.mcp.json`.

The reliable install path today is the MCP registration shown above. Do not run this and expect it to work:

```bash
codex plugin marketplace add gitguffaw/claude-router
```

Codex marketplace installs require a marketplace repository layout, usually with plugins under `plugins/<name>/` and a `.agents/plugins/marketplace.json` manifest. If you publish Claude Router through a marketplace, install it with:

```bash
codex plugin marketplace add <marketplace-repo-or-path>
codex plugin add claude-router@<marketplace-name>
```

## Troubleshooting

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
