# Claude Router

Current release: `v2.3.0`

Claude Router lets a host agent delegate work to the local Claude Code CLI through policy-backed modes for setup, analysis, planning, implementation, review, model and capability discovery, background jobs, result retrieval, and guarded access to installed Claude CLI features.

It ships as:

- a Claude Code plugin marketplace package under `.claude-plugin`
- a Codex plugin marketplace package under `plugins/claude-router`
- an AGY plugin/skill registration under `.agy`

Use it when you want Codex or AGY to route a specific task to Claude instead of merely talking about what Claude might do.

## Requirements

- Node.js 18.18 or newer
- Claude Code CLI installed locally
- Claude Code already authenticated
- For Claude Code: Claude Code CLI with plugin support
- For Codex: Codex CLI with plugin support
- For AGY: an AGY build that can install `.agy` plugins or ingest `.agy/skills`

Check the shared runtime basics:

```bash
node --version
claude --version
claude auth status
```

Check the host you plan to use:

```bash
codex --version
agy --version
```

`node scripts/claude-companion.mjs setup` checks Node, Claude, Claude auth, Claude plugins, and Claude MCP status. It does not require Codex or AGY to be installed.

## Install In Claude Code

Install Claude Router as a Claude Code plugin from this marketplace repo:

```bash
claude plugin marketplace add gitguffaw/claude-router
claude plugin install claude-router@claude-router
```

Confirm Claude Code sees the plugin:

```bash
claude plugin list | grep claude-router
claude plugin details claude-router
```

Then start a new Claude Code session, or run `/reload-plugins` in an existing session. Claude Code loads plugin commands under the plugin namespace, such as `/claude-router:models`.

For local development from a clone:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
claude plugin marketplace add "$(pwd)"
claude plugin install claude-router@claude-router
```

## Install In Codex

Install Claude Router as a Codex plugin from this marketplace repo:

```bash
codex plugin marketplace add gitguffaw/claude-router
codex plugin add claude-router@claude-router
```

Confirm Codex sees the plugin:

```bash
codex plugin list | grep claude-router
```

Then start a new Codex session. Plugins and their tools are loaded when a session starts, so an already-open thread may not see a newly installed plugin.

For local development from a clone:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
codex plugin marketplace add "$(pwd)"
codex plugin add claude-router@claude-router
```

Run the plugin setup check from a Codex chat after opening a new session:

```text
Use Claude Router to check my local setup.
```

## Install In AGY

Claude Router v2 includes AGY registration files:

- `.agy/plugin.json`
- `.agy/skills/claude-router/SKILL.md`

The AGY plugin root is `.agy`, not the repository root. Validate it before installing:

```bash
agy plugin validate .agy
```

Install from a local checkout:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
agy plugin install .agy
```

Keep the checkout if you want AGY to use the direct runtime commands documented below; AGY imports the skill registration from `.agy`, while the runtime scripts live under `plugins/claude-router`.

Confirm AGY imported it:

```bash
agy plugin list
```

Enable or disable the AGY plugin:

```bash
agy plugin enable claude-router
agy plugin disable claude-router
```

Uninstall the AGY plugin:

```bash
agy plugin uninstall claude-router
```

The AGY skill is intentionally scoped to `claude-router`. It does not install or invoke `codex-router`, and it does not route through `~/.codex/app-server.sock`.

When AGY can attach an MCP server, point it at the repository runtime:

```bash
node plugins/claude-router/scripts/claude-router-mcp.mjs
```

When AGY is using skill instructions instead of MCP tools, use the direct runtime commands from `plugins/claude-router`:

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs analyze --cwd /path/to/project "map the architecture"
node scripts/claude-companion.mjs plan --cwd /path/to/project "plan the change"
```

## Using In Codex

Claude Router is a plugin, not a slash command. In the Codex app, do not invoke it with `/claude-router` or `$claude-router`.

Ask Codex to use the plugin by name:

```text
Use Claude Router to analyze this repository. Do not edit files.
```

```text
Use Claude Router review on my current diff. Findings first, no auto-fixes.
```

If Codex does not pick the right tool automatically, name the exact tool:

```text
Use `claude_router_setup` and report the result.
```

```text
Use `claude_router_exec` to implement the narrowest fix for the failing tests.
```

## Using In Claude Code

Claude Router exposes a `/claude-router:*` command palette when installed in Claude Code:

- `/claude-router:setup`: check local Claude readiness
- `/claude-router:version`: show Claude Router and Claude CLI versions
- `/claude-router:models`: show live model selectors and curated controls
- `/claude-router:surface`: show installed Claude CLI help plus router coverage
- `/claude-router:help`: show router help or Claude subcommand help
- `/claude-router:analyze`: run read-only analysis
- `/claude-router:plan`: run read-only planning
- `/claude-router:exec`: run write-capable execution
- `/claude-router:review`: run read-only review
- `/claude-router:adversarial-review`: challenge approach and assumptions without editing
- `/claude-router:ultrareview`: run Claude's cloud-hosted ultrareview
- `/claude-router:status`: list or inspect jobs
- `/claude-router:result`: fetch a stored job result
- `/claude-router:cancel`: cancel an active background job
- `/claude-router:raw` and `/claude-router:cli`: guarded raw Claude CLI passthrough

Examples:

```text
/claude-router:models
/claude-router:analyze --model fable inspect this repository
/claude-router:exec --background implement the narrow fix
/claude-router:adversarial-review challenge whether this cache design is worth it
/claude-router:cli plugin list
```

## Claude Code Parity Notes

Claude Router intentionally maps to Claude Code capabilities, not Codex Router internals one-for-one:

- Claude Code plugin commands are real plugin components, so Claude Router ships `/claude-router:*` commands for Claude Code in addition to Codex MCP tools.
- Claude Code plugins can ship skills, agents, hooks, MCP servers, LSP servers, monitors, default settings, and command files. Claude Router currently ships command files, plugin skills, and MCP tools; hooks and rescue agents are not enabled by default because they would create Claude-reviewing-Claude loops without a clear host boundary.
- Claude Code has `--model`, `--effort`, `--chrome`, `--agent`, `--agents`, plugin loading, MCP config, background sessions, remote control, gateway, ultrareview, and raw CLI subcommands. Claude Router exposes common delegation modes directly and keeps the rest behind guarded `raw` / `cli` passthrough.
- Claude Code has a documented `WebSearch` tool and `/deep-research` workflow inside sessions, but there is no verified `claude search` or `claude web-search` shell subcommand. Claude Router therefore rejects Codex-style `--search` and asks users to use `--chrome`, MCP/docs tooling, or explicit verification instead.
- Codex Router's stop-review gate and app-server broker are Codex-host mechanics. Claude Router uses process-backed Claude CLI jobs, so job status/result/cancel parity exists without copying that broker.

## What Gets Installed

The plugin exposes these Codex tools:

- `claude_router_setup`: check Node, Claude, auth, Claude plugins, and Claude MCP config
- `claude_router_surface`: report the installed Claude CLI version and top-level help
- `claude_router_help`: show Claude Router help, or help for an installed Claude subcommand when args are provided
- `claude_router_version`: show Claude Router and installed Claude CLI versions
- `claude_router_analyze`: read-only analysis
- `claude_router_plan`: read-only implementation or migration planning
- `claude_router_exec`: write-capable implementation
- `claude_router_review`: read-only code review
- `claude_router_adversarial_review`: read-only challenge review of approach and assumptions
- `claude_router_ultrareview`: run Claude's cloud-hosted `ultrareview`
- `claude_router_status`: list or inspect jobs
- `claude_router_result`: fetch a stored job result
- `claude_router_models`: return live Claude model selectors plus curated effort levels, permission modes, and modifier flags
- `claude_router_cancel`: cancel a background job
- `claude_router_raw`: run raw Claude CLI args with guardrails

## Common Uses

Ask Claude for read-only analysis:

```text
Use Claude Router to analyze the auth flow. Do not edit files.
```

Ask Claude for a plan:

```text
Use Claude Router to plan a migration from the current adapter to a fuller plugin surface.
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

Ask which models and effort levels are available:

```text
Use Claude Router models to show available Claude models and effort levels.
```

Filter to models that support a capability:

```text
Use Claude Router models filtered to ultrathink support.
```

## Model Catalog Reference

The `claude_router_models` tool and `models` companion mode query the installed Claude CLI help for accepted `--model` selectors, then merge those live selectors with curated metadata for stable controls such as effort levels, permission modes, presets, and known tier capabilities. For example, if the installed Claude CLI advertises `fable` and `claude-fable-5`, the model selector list includes them without a router release.

### Catalog Sections

- `discovery` — live model discovery status, Claude CLI version, selectors, aliases, full names, and any discovery error
- `models` — selectors accepted by the installed Claude CLI plus curated fallback selectors
- `tiers` — known tier metadata (haiku, sonnet, opus) with context windows, long-context support, ultrathink support, and cost tier
- `effort_levels` — reasoning depth controls (low, medium, high, xhigh, max) with token budgets
- `modifiers` — router controls and Claude session flags (`--long-context`, `--ultrathink`, `--chrome`, `--no-chrome`, `--bare`) with tier compatibility. `--long-context` and `--ultrathink` are router-level conveniences; `--chrome`, `--no-chrome`, and `--bare` pass through to Claude.
- `permission_modes` — Claude session permission controls (default, acceptEdits, auto, plan, dontAsk, bypassPermissions)
- `presets` — shortcut flags (`--best` resolves to opus)

### Permission Modes

| Mode | Flag Value | Description | Requires `--allow-dangerous` |
| --- | --- | --- | --- |
| default | `default` | Interactive approval for writes and commands | No |
| acceptEdits | `acceptEdits` | Accept file edits automatically under Claude's permission semantics | No |
| auto | `auto` | Claude's automatic permission mode | No |
| plan | `plan` | Read-only; no file writes or command execution | No |
| dontAsk | `dontAsk` | Avoid interactive asks according to Claude's permission semantics | No |
| bypassPermissions | `bypassPermissions` | Skip all permission checks | Yes |

### Capability Filtering

Pass `capability` to filter tiers. Valid values: `long_context`, `ultrathink`, `chrome`. Unknown values are rejected.

For the full rendered catalog, run `node scripts/claude-companion.mjs models` from the plugin directory. Use `--static` to skip live CLI help discovery.

## Coding And Documentation Workflows

For larger engineering work, ask Claude Router to plan first, then execute one bounded batch at a time. This keeps diffs easier to review and makes failures easier to recover from.

Plan a set of tasks:

```text
Use Claude Router plan on this repo. Do not edit files.

Break these tasks into implementation batches. For each batch include the goal,
likely files touched, acceptance criteria, tests to run, and ordering risks.

Tasks:
1. Replace the legacy adapter path.
2. Add result pagination.
3. Update README and architecture docs.
```

Implement one batch:

```text
Use Claude Router exec to implement Batch 1 only.

Keep the change scoped. Update tests and docs only when needed for this batch.
Run the relevant verification commands and summarize what changed.
```

Ask for documentation work:

```text
Use Claude Router analyze this repo. Do not edit files.

Check whether README.md, CONTEXT.md, and docs/ match the current implementation.
Report stale claims, missing setup steps, and places where examples are unclear.
```

```text
Use Claude Router exec to update README.md and docs/architecture.md from the analysis.

Keep the docs factual and grounded in the current code. Prefer practical examples
over marketing language.
```

Create an architecture document:

```text
Use Claude Router analyze this repo. Do not edit files.

Produce an architecture outline covering the main components, runtime flow,
extension points, data and state model, important constraints, and tradeoffs.
```

```text
Use Claude Router exec to create docs/architecture.md from that outline.

Include a concise runtime-flow diagram only if it clarifies the design.
```

Run a multi-agent review when available:

```text
Use Claude Router ultrareview on my current diff.

Findings first. No auto-fixes. Focus on correctness, architecture, security,
test gaps, and documentation drift.
```

Use a normal local review for a faster pass:

```text
Use Claude Router review on my current diff. Findings first, no auto-fixes.
```

## Direct Runtime Usage

You can run the companion runtime directly from a clone when developing or debugging the plugin:

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs --help
node scripts/claude-companion.mjs version
node scripts/claude-companion.mjs analyze --cwd /path/to/project "map the architecture"
node scripts/claude-companion.mjs plan --cwd /path/to/project --background "plan the migration"
node scripts/claude-companion.mjs status --cwd /path/to/project
node scripts/claude-companion.mjs result --cwd /path/to/project <job-id>
node scripts/claude-companion.mjs models
node scripts/claude-companion.mjs models --capability ultrathink
node scripts/claude-companion.mjs cancel --cwd /path/to/project <job-id>
```

Claude controls pass through:

```bash
node scripts/claude-companion.mjs analyze --cwd /path/to/project --model opus --effort high "inspect performance risks"
node scripts/claude-companion.mjs plan --cwd /path/to/project --chrome "research and plan the browser workflow"
node scripts/claude-companion.mjs exec --cwd /path/to/project --allowed-tools "Read,Edit" "apply the requested fix"
```

## Full Claude CLI Access

Claude Router has curated tools for common workflows, plus `help` and `raw` for Claude features that do not need a bespoke plugin tool.

Check local Claude support:

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs help
node scripts/claude-companion.mjs version
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
| `adversarial-review` | No | Challenge approach, assumptions, and tradeoffs without editing |
| `ultrareview` | No | Claude cloud-hosted multi-agent review |
| `status` | No | List recent jobs; pass `--all` to show the full retained history |
| `result` | No | Show a stored job result |
| `cancel` | No | Cancel an active background job |
| `surface` | No | Installed Claude version and top-level help |
| `help` | No | Help for a Claude command path |
| `version` | No | Claude Router version plus installed Claude CLI version |
| `models` | No | Available Claude models, effort levels, permission modes, and modifier flags |
| `raw` | Depends | Exact Claude CLI args with mutation and danger guardrails |
| `cli` | Depends | Alias for guarded raw Claude CLI passthrough |

Read-only routed modes snapshot git status before and after Claude runs. If Claude changes files during `analyze`, `plan`, `review`, or `adversarial-review`, the job is marked `completed-with-warnings`.

Managed routed jobs have a default 30 minute process timeout. Pass `--timeout-ms <milliseconds>` to override it, or `--timeout-ms 0` to disable the managed timeout for a specific routed job.

## Uninstall

### Uninstall From Claude Code

Remove the Claude Code plugin:

```bash
claude plugin uninstall claude-router
```

Remove the marketplace entry if you no longer want Claude Code to list it:

```bash
claude plugin marketplace remove claude-router
```

### Uninstall From Codex

Remove the plugin:

```bash
codex plugin remove claude-router@claude-router
```

Remove the marketplace entry if you no longer want Codex to list it:

```bash
codex plugin marketplace remove claude-router
```

If you previously followed the old standalone MCP instructions, remove that legacy registration too:

```bash
codex mcp remove claude-router
```

### Uninstall From AGY

Disable the AGY plugin without removing it:

```bash
agy plugin disable claude-router
```

Remove the AGY plugin registration:

```bash
agy plugin uninstall claude-router
```

Confirm it is gone:

```bash
agy plugin list
```

This removes AGY's imported plugin registration. It does not delete your local `claude-router` checkout.

## Troubleshooting

If setup says `claude not found`, install Claude Code and make sure `claude` is on `PATH`.

If setup says auth is missing, run:

```bash
claude auth login
```

If setup says the Claude Router plugin or MCP server is missing, reinstall the relevant host integration and rerun setup.

If Claude runs against the wrong project, pass `cwd` through the tool request or use `--cwd` with the direct CLI.

If `raw` refuses to run a command, it probably detected a Claude config mutation or dangerous permission mode. Use `--allow-mutating` or `--allow-dangerous` only when that is the explicit intent.

If Codex says it cannot find Claude Router after install, start a new Codex session.

If AGY says `missing plugin.json`, pass the `.agy` directory to AGY instead of the repository root:

```bash
agy plugin validate .agy
agy plugin install .agy
```

If AGY cannot find Claude Router after install, check the imported plugin list and enable it:

```bash
agy plugin list
agy plugin enable claude-router
```

## Development

Run tests from the repo root:

```bash
npm test
```

Validate the Codex plugin manifest and cross-host version alignment:

```bash
npm run validate
```

## License

Apache-2.0. This project is independent and is not affiliated with Anthropic or OpenAI.
