# Claude Router

Current release: `v2.5.2`

Claude Router lets a coding agent hand a task to the Claude CLI installed on your computer. It is built for Codex, both the app and the CLI, and for Google Antigravity, both the IDE and the `agy` CLI. An adapter for Claude Code offers the same modes as slash commands, though Claude Code runs its own sessions and subagents without it.

The host is the agent you are talking to. The Claude CLI is the `claude` command that ships with Claude Code, and it does the work.

```text
You ask Codex or Antigravity to use Claude Router
        ↓
Claude Router wraps the task in a contract and sets the permission mode
        ↓
The Claude CLI on your machine does the work
        ↓
Claude Router returns the result, or a job ID for a background job
```

Claude Router runs on your machine. It is not a cloud proxy and it provides no models. It starts `claude` with the login and models you already have.

On the desktop, the OpenAI host is the Codex app. This repository has no integration for the ChatGPT desktop app.

## Choose your host

| Host | How it connects | When to use it |
| --- | --- | --- |
| Codex app or Codex CLI | Codex plugin with `claude_router_*` MCP tools | You work in Codex. Ask it in plain English to give a task to Claude. |
| Antigravity IDE | Antigravity plugin that registers a skill | You work in Antigravity. Keep the repository checkout, because the skill runs the scripts from it. |
| Antigravity CLI (`agy`) | The same plugin, installed from `.agy` | You work in `agy`. The checkout rule is the same. |
| Claude Code | `/claude-router:*` slash commands | You want the router's contracts, checks, or job records inside Claude Code. Otherwise skip it. |
| Shell or scripts | The companion script, run with `node` | Development, debugging, and automation without a host. |

Every adapter calls the same script, `plugins/claude-router/scripts/claude-companion.mjs`. This README calls it the companion. The packaging differs by host. The modes do not.

## Start here

You don't need tool names. Ask the host to use Claude Router and say what Claude may and may not do:

```text
Use Claude Router to analyze the authentication flow in this repository.
Report where credentials enter, how they are stored, and where failures surface.
Do not edit files.
```

```text
Use Claude Router to plan the parser migration.
Include likely files, ordering risks, tests, and rollback considerations.
Do not implement it.
```

```text
Use Claude Router exec to fix the failing date-parser tests.
Keep the change limited to the parser and run the focused tests.
```

```text
Use Claude Router review on my current diff.
Findings first, no auto-fixes. Focus on correctness and missing tests.
```

```text
Use Claude Router adversarial review on the proposed cache layer.
Challenge whether the cache is necessary and identify invalidation assumptions.
```

For a long task:

```text
Use Claude Router to analyze this repository in the background.
Return the job ID immediately.
```

Then ask the same host:

```text
Show the Claude Router job status.
Get the Claude Router result when it finishes.
```

## Managed modes

| Command | Edits project files | What it does |
| --- | --- | --- |
| `analyze` | No | Reports facts, tradeoffs, a recommendation, and a next action |
| `plan` | No | Writes an implementation or migration plan |
| `exec` | Yes | Makes a narrow change and reports what it touched and how it checked it |
| `review` | No | Reviews code, findings first, no fixes |
| `adversarial-review` | No | Challenges the approach, the assumptions, and the design tradeoffs |
| `ultrareview` | No | Runs Claude's cloud-hosted `ultrareview` command |
| `status` | No | Lists jobs or shows one, and can wait for it to finish |
| `result` | No | Shows a stored job result |
| `cancel` | No | Cancels a running job |
| `models` | No | Lists the model examples, flags, effort levels, and lean profiles the installed CLI advertises |
| `setup` | No | Checks Node, the Claude CLI, and Claude login |
| `surface` | No | Shows the installed Claude version and help, and which parts the router covers |
| `help` | No | Shows router help, or Claude's help for a subcommand |
| `version` | No | Shows the Claude Router and Claude CLI versions |
| `raw` or `cli` | Depends | Passes any other Claude CLI command through a guard |

The first five rows are the job modes. Each one wraps your prompt in a contract, a few lines that tell Claude what to return and whether it may edit files. Each one creates a job record.

`analyze`, `plan`, `review`, and `adversarial-review` are read-only. The router runs them in Claude permission mode `plan` and rejects any other mode, even with `--allow-dangerous`. `exec` defaults to `acceptEdits`.

As a second check, the router compares `git status --short` before and after each read-only job. If the output changed, the job finishes as `completed-with-warnings`. The check misses a second edit to a file that was already modified, anything Git ignores, and any project that is not a Git repository.

`ultrareview` is a thin wrapper around `claude ultrareview`. It takes a target and `--timeout`. It keeps no job record and has no background mode, permission mode, or `--timeout-ms`.

## Requirements

Every host needs:

- Node.js 18.18 or newer
- The Claude CLI, installed and logged in

Check both:

```bash
node --version
claude --version
claude auth status
```

You also need a host:

- Codex app or Codex CLI, with plugin support
- Antigravity IDE or `agy`
- Claude Code with plugin support, if you want the Claude Code adapter

`setup` checks Node, the Claude CLI, and Claude login, and reports `ready` when all three pass. It does not check which hosts you have.

## Install in Codex

One install gives Codex the scripts, the skill, and the MCP server.

```bash
codex plugin marketplace add gitguffaw/claude-router
codex plugin add claude-router@claude-router
```

Check that Codex sees it:

```bash
codex plugin list | grep claude-router
```

Then start a new Codex task. Codex loads plugins and MCP tools when a task starts, so a task that was already open may not see the plugin.

To install from a local clone:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
codex plugin marketplace add "$(pwd)"
codex plugin add claude-router@claude-router
```

### Use in Codex

Claude Router is a plugin, not a slash command. In the Codex app, don't type `/claude-router` or `$claude-router`. Ask in plain English:

```text
Use Claude Router to check my local setup.
```

```text
Use Claude Router analyze to map this repository. Do not edit files.
```

If Codex picks the wrong tool, name the one you want:

```text
Use `claude_router_setup` and report the result.
```

```text
Use `claude_router_exec` to implement the narrowest fix for the failing tests.
```

### Codex tools

The MCP server has 15 tools, one per command in the table above. A tool's name is `claude_router_` plus the command name with hyphens as underscores, so `adversarial-review` is `claude_router_adversarial_review`. `cli` has no tool of its own. Use `claude_router_raw`.

Every tool takes a `cwd`. Without one, Claude runs in the plugin's install directory and not in your project.

## Install in Antigravity

Antigravity loads plugins from `.agents/plugins/` in a workspace, or from `~/.gemini/config/plugins/` for every workspace. The plugin root for Antigravity is the `.agy` directory, not the repository root.

`.agy` holds a manifest and the skill, and nothing else. The scripts stay in the checkout, so keep the checkout after you install. Antigravity runs `plugins/claude-router/scripts/claude-companion.mjs` from it.

Clone to a place you won't move:

```bash
git clone https://github.com/gitguffaw/claude-router.git "$HOME/.local/share/claude-router"
```

For a global install, copy `.agy` into Antigravity's global plugin directory:

```bash
mkdir -p "$HOME/.gemini/config/plugins"
cp -R "$HOME/.local/share/claude-router/.agy" \
  "$HOME/.gemini/config/plugins/claude-router"
```

If `~/.gemini/config/plugins/claude-router` already exists, `cp -R` puts `.agy` inside it and does not replace it. Remove the old directory first.

Start a new Antigravity conversation and ask:

```text
Use Claude Router from ~/.local/share/claude-router to check my local setup.
```

```text
Use Claude Router from ~/.local/share/claude-router to review my current project.
Findings first and do not edit files.
```

Google's [Antigravity plugin documentation](https://antigravity.google/docs/ide/plugins) covers the global and workspace plugin locations.

### Install in Antigravity CLI (`agy`)

From a checkout you plan to keep:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
agy plugin validate .agy
agy plugin install .agy
```

Check that it registered, then enable it:

```bash
agy plugin list
agy plugin enable claude-router
```

`agy` imports the skill from `.agy`. The scripts stay in the checkout. If the host can't find them, put the checkout path in your request, or run the companion by absolute path:

```bash
node "$HOME/.local/share/claude-router/plugins/claude-router/scripts/claude-companion.mjs" \
  analyze --cwd /path/to/project "map the architecture"
```

If your Antigravity host can attach a local MCP server over stdio, give it this command, run from the checkout:

```bash
node plugins/claude-router/scripts/claude-router-mcp.mjs
```

## Optional: install in Claude Code

Claude Code already runs its own sessions and subagents, so most people don't need this. Install it if you want the router's contracts, read-only enforcement, guarded `raw` access, or job records inside Claude Code.

```bash
claude plugin marketplace add gitguffaw/claude-router
claude plugin install claude-router@claude-router
```

Check that Claude Code sees it:

```bash
claude plugin list | grep claude-router
claude plugin details claude-router
```

Start a new Claude Code session or run `/reload-plugins`. Every command in the modes table becomes a slash command under `/claude-router:`, for example `/claude-router:models` and `/claude-router:adversarial-review`. Both `/claude-router:raw` and `/claude-router:cli` exist.

```text
/claude-router:analyze inspect this repository
/claude-router:exec --background implement the narrow fix
/claude-router:status <job-id> --wait
```

## Background jobs and session state

Ask the host for a background job, or pass `--background` to the companion. The five job modes accept it. The call returns a job ID and Claude keeps working in a detached process.

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs analyze --background "map the extension points"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs status <job-id> --wait
node scripts/claude-companion.mjs result <job-id>
node scripts/claude-companion.mjs cancel <job-id>
```

These examples run against the current directory. The router stores jobs per project, so `status`, `result`, and `cancel` find a job only when they get the same `--cwd` it started with.

`status <job-id> --wait` polls until the job completes, fails, or is cancelled. Each poll also checks that the job's process is still alive. If it died, the router marks the job `failed` with phase `stale-process` and returns, so you don't wait out the clock. The wait gives up after 240 seconds unless you pass `--timeout-ms`.

A job times out after 30 minutes. `--timeout-ms`, or `timeout_ms` in an MCP call, changes that, and `0` turns the timeout off for that job. Three minutes is enough for a smoke test and nothing else. A job with several items, medium effort or higher, or subagents needs more, and a job the router kills at the timeout returns no answer.

The MCP server also stops any tool call after 35 minutes, or after `timeout_ms` plus one minute if that is longer. `timeout_ms: 0` does not lift this limit. `CLAUDE_ROUTER_MCP_OUTER_TIMEOUT_MS` in the server's environment changes the 35 minutes. Your host may cut a call off sooner, so run long work in the background.

A failed job says why in `failureKind`:

| `failureKind` | What happened |
| --- | --- |
| `killed-in-progress` | The router killed Claude at the timeout after Claude had started a session or written output |
| `timed-out-empty` | The timeout hit before Claude started a session or wrote anything |
| `auth-failed` | Claude is not logged in |
| `claude-error` | Claude returned an error result |
| `empty` | Claude exited without a session or any output |

For `killed-in-progress`, the companion's `result` prints the job log path and, when a session exists, the session file and a `claude --resume` command. A foreground job that fails exits with status 1.

Job records are files under `CLAUDE_ROUTER_DATA` if it is set, then `CODEX_PLUGIN_DATA`, then a `claude-router` folder in the OS temp directory. The OS can clear its temp directory, so set `CLAUDE_ROUTER_DATA` if results need to last. The router keeps the 50 most recent finished jobs per project and drops the rest.

## Models, controls, and lean profiles

Claude Router keeps no allowlist of models, effort levels, or Claude flags. `models` reads `claude --help` on every call, and the MCP tool schemas for the job modes include the flags it finds there. The router passes `model` and `effort` to Claude unchecked, so Claude is what rejects a bad value.

`claude --help` names a few models as examples. That is not a full list, and the catalog says so by reporting its completeness as `documented-examples`. A model that isn't listed can still work.

Ask a host:

```text
Use Claude Router models to show the model examples, effort levels,
and lean profiles advertised on this machine.
```

Lean mode starts Claude without most of your customizations and with a short tool list. Use it for a narrow task that stands alone. Skip it when the work depends on `CLAUDE.md`, plugins, hooks, MCP servers, or skills.

| Say to the host | Companion flag | What Claude gets |
| --- | --- | --- |
| `lean` | `--lean` or `--lean=auto` | `--bare` when the environment has `ANTHROPIC_API_KEY` or a Bedrock, Vertex, or Foundry setting. Otherwise `--safe-mode`. |
| `lean OAuth` | `--lean=oauth` | `--safe-mode`, which keeps your subscription login |
| `lean API` | `--lean=api` | `--bare`, which needs API or provider credentials |

Every lean profile also sets a default tool list and a one-line system prompt. The read-only modes get `Bash,Read`. `exec` gets `Bash,Read,Edit,Write`. `--tools` and `--system-prompt` override those defaults.

```text
Use Claude Router analyze in lean OAuth mode with model fable and max effort.
Find the smallest safe fix for this parser bug. Do not edit files.
```

Don't pass `--safe-mode` and `--bare` together. They are different login paths and the router rejects the pair.

[Claude Router Capabilities](plugins/claude-router/docs/capabilities.md) has more detail on each mode and more companion examples.

## Direct runtime usage

Run the companion from the plugin directory:

```bash
cd plugins/claude-router
node scripts/claude-companion.mjs --help
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs version
node scripts/claude-companion.mjs analyze --cwd /path/to/project "map the architecture"
node scripts/claude-companion.mjs plan --cwd /path/to/project "plan the migration"
node scripts/claude-companion.mjs exec --cwd /path/to/project "implement the narrow fix"
node scripts/claude-companion.mjs review --cwd /path/to/project "review the current diff"
```

`--cwd` sets the project. Without it, the companion uses the current directory. If that directory is inside a Git repository, Claude runs at the repository root.

Flags that `claude` accepts pass through:

```bash
node scripts/claude-companion.mjs analyze --model opus --effort high "inspect performance risks"
node scripts/claude-companion.mjs plan --chrome "research and plan the browser workflow"
node scripts/claude-companion.mjs exec --allowed-tools "Read,Edit" "apply the requested fix"
node scripts/claude-companion.mjs analyze --lean --model fable --effort max "find the narrowest fix"
```

A flag the installed CLI does not list is not an error. The companion treats it as the start of the prompt, so check your spelling.

The router puts `--` before the prompt when it calls `claude`. A flag that takes several values, such as `--add-dir`, can't swallow the prompt.

## Guarded Claude CLI access

`raw`, or its alias `cli`, runs any other `claude` command. Put the Claude arguments after `--`. From `plugins/claude-router`:

```bash
node scripts/claude-companion.mjs raw -- mcp list
node scripts/claude-companion.mjs raw -- plugin list
node scripts/claude-companion.mjs help mcp add
```

The last line prints Claude's own help for `mcp add`.

`raw` runs commands it knows are read-only, such as `mcp list`, `plugin list`, `doctor`, and `auth status`. It refuses three kinds of command until you add a flag:

- A command that changes Claude or project configuration, such as `mcp add`. Add `--allow-mutating`.
- A command the router has not classified, such as `agents` or `plugin marketplace list`. These need `--allow-mutating` too, even when they only read.
- A permission bypass, such as `--permission-mode bypassPermissions`. Add `--allow-dangerous`.

```bash
node scripts/claude-companion.mjs raw --allow-mutating -- \
  mcp add my-server -- node server.mjs

node scripts/claude-companion.mjs raw --allow-dangerous -- \
  -p --permission-mode bypassPermissions "trusted sandbox task"
```

## Uninstall

### Codex

```bash
codex plugin remove claude-router@claude-router
codex plugin marketplace remove claude-router
```

If you once followed the older standalone MCP instructions, remove that server too:

```bash
codex mcp remove claude-router
```

### Antigravity IDE

Delete the `claude-router` directory from the plugin location you used, global or workspace. The checkout is separate. Delete it too if you are done with it.

### Antigravity CLI (`agy`)

```bash
agy plugin disable claude-router
agy plugin uninstall claude-router
agy plugin list
```

This leaves the checkout in place.

### Claude Code

```bash
claude plugin uninstall claude-router
claude plugin marketplace remove claude-router
```

## Troubleshooting

If `setup` tells you to install Claude Code, the companion could not find `claude`. Install it and check that `claude` is on your `PATH`.

If `setup` tells you to log in:

```bash
claude auth login
```

If Claude runs in the wrong project, ask the host to pass your project path as `cwd`. With the companion, pass `--cwd`.

If `status` or `result` reports no jobs, pass the `--cwd` the job started with.

If `raw` refuses a command, the error names the flag that allows it. Add `--allow-mutating` or `--allow-dangerous` only if you meant to run that command.

If Codex cannot find Claude Router after you install it, start a new Codex task.

If Antigravity cannot find the skill, check that the plugin is at `<workspace>/.agents/plugins/claude-router` or `~/.gemini/config/plugins/claude-router`, then start a new conversation.

If `agy` says it found no `plugin.json`, you gave it the repository root. Give it `.agy`:

```bash
agy plugin validate .agy
agy plugin install .agy
```

## Development

From the repository root:

```bash
npm test
npm run validate
```

`npm run validate` checks the plugin manifests, that every host adapter has the same version, and that this README still contains a few required host commands.

## License

Apache-2.0. This project is not affiliated with Anthropic, Google, or OpenAI.
