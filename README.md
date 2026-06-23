# Claude Router for Codex

Claude Router is a Codex plugin bundle that lets Codex delegate work to the local Claude Code CLI. It provides policy-backed modes for setup, analysis, planning, implementation, review, background jobs, result retrieval, and guarded access to installed Claude CLI features.

Use it when you want Codex to route a specific task to Claude instead of merely talking about what Claude might do.

## Requirements

- Node.js 18.18 or newer
- Codex CLI with plugin support
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

## What Gets Installed

The plugin exposes these Codex tools:

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

Claude Router has curated tools for common workflows, plus `help` and `raw` for Claude features that do not need a bespoke plugin tool.

Check local Claude support:

```bash
cd plugins/claude-router
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

## Uninstall

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

## Troubleshooting

If setup says `claude not found`, install Claude Code and make sure `claude` is on `PATH`.

If setup says auth is missing, run:

```bash
claude auth login
```

If Claude runs against the wrong project, pass `cwd` through the tool request or use `--cwd` with the direct CLI.

If `raw` refuses to run a command, it probably detected a Claude config mutation or dangerous permission mode. Use `--allow-mutating` or `--allow-dangerous` only when that is the explicit intent.

If Codex says it cannot find Claude Router after install, start a new Codex session.

## Development

Run tests from the repo root:

```bash
npm test
```

Validate the plugin manifest:

```bash
npm run validate:plugin
```

## License

Apache-2.0. This project is independent and is not affiliated with Anthropic or OpenAI.
