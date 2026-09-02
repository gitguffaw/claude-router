# Claude Router

Current release: `v2.5.0`

Claude Router lets one coding agent delegate a bounded task to the Claude Code CLI already installed on your computer. Its primary host surfaces are the **Codex app/CLI** and **Google Antigravity/Antigravity CLI (`agy`)**. An optional Claude Code adapter exposes the same managed modes as slash commands, but Claude Code does not need this router to run its own native sessions or subagents.

The **host** is the agent you are talking to. The **runtime** is the local `claude` process that performs the delegated work.

```text
Your request in Codex or Antigravity
        ↓
Claude Router selects a task contract, permissions, and job settings
        ↓
Your locally installed Claude Code CLI performs the work
        ↓
Claude Router returns the result or stores it as a background job
```

Claude Router is a local task dispatcher, not a cloud proxy or model provider. It uses the Claude authentication and models already available on your machine.

> **Desktop naming:** the supported OpenAI desktop host is the **Codex app**. This repository does not ship a separate ChatGPT desktop app integration.

## Choose Your Host

| Host | Integration | Recommended use |
| --- | --- | --- |
| Codex app or Codex CLI | Packaged Codex plugin with `claude_router_*` MCP tools | Primary OpenAI-hosted workflow; ask Codex in plain English to delegate a task to Claude. |
| Antigravity IDE | Antigravity plugin/skill registration | Primary Google-hosted workflow; keep the repository checkout available to the skill. |
| Antigravity CLI (`agy`) | `.agy` plugin/skill registration | Use the same managed modes from the Antigravity command-line host. |
| Claude Code | Optional `/claude-router:*` command adapter | Use only when you specifically want the router's contracts, guardrails, or persistent job format inside Claude Code. |
| Shell or automation | Direct Node.js companion runtime | Development, debugging, or scripted use without a host plugin. |

The Codex, Antigravity, and Claude Code adapters all call the same companion runtime under `plugins/claude-router`. The host packaging differs; the task modes do not.

## Start Here

You normally do not need exact tool names. Ask the host agent to use Claude Router and describe the boundary you want:

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

For a long-running task:

```text
Use Claude Router to analyze this repository in the background.
Return the job ID immediately.
```

Then ask the same host:

```text
Show the Claude Router job status.
Get the Claude Router result when it finishes.
```

## Managed Modes

| Mode | Writes project files? | Purpose |
| --- | --- | --- |
| `analyze` | No | Facts, diagnosis, tradeoffs, recommendation, and next action |
| `plan` | No | Concrete implementation or migration plan |
| `exec` | Yes | Bounded implementation with verification summary |
| `review` | No | Findings-first code review without auto-fixes |
| `adversarial-review` | No | Challenge the approach, assumptions, and design tradeoffs |
| `ultrareview` | No | Wrapper around Claude's installed cloud-hosted `ultrareview` command |
| `status` | No | List jobs or inspect one job; optionally wait for a terminal state |
| `result` | No | Retrieve a stored job result |
| `cancel` | No | Cancel an active tracked job |
| `models` | No | Discover model examples, fields, choices, and lean profiles from the installed CLI |
| `surface` | No | Show the installed Claude version/help and router coverage |
| `help` | No | Show router help or installed Claude subcommand help |
| `version` | No | Show Claude Router and installed Claude CLI versions |
| `raw` / `cli` | Depends | Guarded passthrough for Claude CLI features outside the managed modes |

Read-only managed modes force Claude permission mode `plan`. They snapshot Git status before and after the call; if project files change anyway, the job becomes `completed-with-warnings`. `exec` defaults to Claude permission mode `acceptEdits`.

## Requirements

All hosts require:

- Node.js 18.18 or newer
- Claude Code CLI installed locally
- Claude Code already authenticated

Check the shared runtime basics:

```bash
node --version
claude --version
claude auth status
```

Host-specific requirements:

- Codex app or Codex CLI with plugin support
- Antigravity IDE or Antigravity CLI (`agy`) for the Google-hosted integration
- Claude Code with plugin support only if you want the optional Claude Code adapter

The setup command checks Node, Claude CLI availability, Claude authentication, Claude plugins, and Claude MCP configuration. It does not require every supported host to be installed.

## Install in Codex

This is the most complete packaged host integration: Codex installs the plugin runtime, skill instructions, and MCP server together.

```bash
codex plugin marketplace add gitguffaw/claude-router
codex plugin add claude-router@claude-router
```

Confirm Codex sees the plugin:

```bash
codex plugin list | grep claude-router
```

Start a new Codex task after installation. Plugins and MCP tools are loaded when a task starts, so an already-open task may not see a newly installed plugin.

For local development from a clone:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
codex plugin marketplace add "$(pwd)"
codex plugin add claude-router@claude-router
```

### Use in Codex

Claude Router is a plugin, not a Codex slash command. In the Codex app, do not invoke it with `/claude-router` or `$claude-router`.

Ask Codex in plain English:

```text
Use Claude Router to check my local setup.
```

```text
Use Claude Router analyze to map this repository. Do not edit files.
```

If automatic tool selection is ambiguous, name the exact MCP tool:

```text
Use `claude_router_setup` and report the result.
```

```text
Use `claude_router_exec` to implement the narrowest fix for the failing tests.
```

### Codex tools

- `claude_router_setup`
- `claude_router_surface`
- `claude_router_help`
- `claude_router_version`
- `claude_router_models`
- `claude_router_analyze`
- `claude_router_plan`
- `claude_router_exec`
- `claude_router_review`
- `claude_router_adversarial_review`
- `claude_router_ultrareview`
- `claude_router_status`
- `claude_router_result`
- `claude_router_cancel`
- `claude_router_raw`

## Install in Antigravity

Antigravity loads custom plugins from `.agents/plugins/` in a workspace or `~/.gemini/config/plugins/` globally. Claude Router's Antigravity-compatible plugin root is `.agy`, not the repository root.

The current Antigravity adapter registers the skill but does **not** copy the companion runtime into `.agy`. Keep the repository checkout after installation so Antigravity can run `plugins/claude-router/scripts/claude-companion.mjs` from that checkout.

Clone to a stable location:

```bash
git clone https://github.com/gitguffaw/claude-router.git "$HOME/.local/share/claude-router"
```

For a global Antigravity installation, place a copy of the `.agy` plugin root in Antigravity's global plugin directory:

```bash
mkdir -p "$HOME/.gemini/config/plugins"
cp -R "$HOME/.local/share/claude-router/.agy" \
  "$HOME/.gemini/config/plugins/claude-router"
```

Those copy commands assume `claude-router` is not already present in the target directory. After installing, start a new Antigravity conversation and ask:

```text
Use Claude Router from ~/.local/share/claude-router to check my local setup.
```

```text
Use Claude Router from ~/.local/share/claude-router to review my current project.
Findings first and do not edit files.
```

See Google's [Antigravity plugin documentation](https://antigravity.google/docs/ide/plugins) for global and workspace plugin locations.

### Install in Antigravity CLI (`agy`)

From a retained checkout:

```bash
git clone https://github.com/gitguffaw/claude-router.git
cd claude-router
agy plugin validate .agy
agy plugin install .agy
```

Confirm and enable the registration:

```bash
agy plugin list
agy plugin enable claude-router
```

The Antigravity CLI imports the skill registration from `.agy`; the runnable scripts remain in the surrounding checkout. If the host cannot locate them automatically, include the checkout path in the request or invoke the direct runtime with an absolute path.

```bash
node "$HOME/.local/share/claude-router/plugins/claude-router/scripts/claude-companion.mjs" \
  analyze --cwd /path/to/project "map the architecture"
```

When an Antigravity host can attach a local MCP server, start the shared server from the repository checkout:

```bash
node plugins/claude-router/scripts/claude-router-mcp.mjs
```

## Optional: Install in Claude Code

This adapter is secondary. Claude Code already manages its own native sessions, agents, and subagents. Install Claude Router in Claude Code only when you want the same named task contracts, permission enforcement, guarded passthrough, or persistent router job records used by the other hosts.

```bash
claude plugin marketplace add gitguffaw/claude-router
claude plugin install claude-router@claude-router
```

Confirm the plugin is visible:

```bash
claude plugin list | grep claude-router
claude plugin details claude-router
```

Start a new Claude Code session or run `/reload-plugins`. The optional adapter exposes:

- `/claude-router:setup`
- `/claude-router:version`
- `/claude-router:models`
- `/claude-router:surface`
- `/claude-router:help`
- `/claude-router:analyze`
- `/claude-router:plan`
- `/claude-router:exec`
- `/claude-router:review`
- `/claude-router:adversarial-review`
- `/claude-router:ultrareview`
- `/claude-router:status`
- `/claude-router:result`
- `/claude-router:cancel`
- `/claude-router:raw` and `/claude-router:cli`

Examples:

```text
/claude-router:analyze inspect this repository
/claude-router:exec --background implement the narrow fix
/claude-router:status <job-id> --wait
```

## Background Jobs and Session State

Add `background` in a host request or `--background` in the direct runtime. The call returns a job ID instead of waiting for Claude to finish.

```bash
node plugins/claude-router/scripts/claude-companion.mjs analyze --background "map the extension points"
node plugins/claude-router/scripts/claude-companion.mjs status
node plugins/claude-router/scripts/claude-companion.mjs status <job-id> --wait
node plugins/claude-router/scripts/claude-companion.mjs result <job-id>
node plugins/claude-router/scripts/claude-companion.mjs cancel <job-id>
```

`status --wait` rechecks the recorded worker and foreground companion on every polling cycle. It returns when the job completes, fails, is cancelled, or its tracked process is no longer active; a dead process is recorded as `failed` with phase `stale-process` instead of being reported as a wait timeout.

The default `status --wait` deadline is 240 seconds. Use `--timeout-ms` to change it. The managed Claude process timeout defaults to 30 minutes; a host or MCP client may impose an additional deadline, so background mode is recommended for long work.

## Models, Controls, and Lean Profiles

Claude Router does not freeze a list of model names, effort levels, permission modes, or native Claude flags. `models` reads the installed Claude CLI help on every call, and managed MCP schemas incorporate the live fields that the installed CLI advertises. Explicit `model` and `effort` values pass through for Claude itself to validate.

Claude help provides documented model examples rather than a guaranteed exhaustive registry. The catalog labels that boundary as `documented-examples`.

Ask a host:

```text
Use Claude Router models to show the model examples, effort levels,
permission choices, and lean profiles advertised on this machine.
```

Lean mode removes most project customizations and supplies a small default tool set. It is useful for narrow, self-contained tasks, but not for work that depends on project instructions, memory, plugins, hooks, MCP servers, or specialized skills.

| Router option | Authentication path | Default tools |
| --- | --- | --- |
| `lean` / `--lean=auto` | Detect from current credentials | Read-only: `Bash,Read`; exec: `Bash,Read,Edit,Write` |
| `lean OAuth` / `--lean=oauth` | Claude `--safe-mode`; keeps subscription/OAuth authentication | Same defaults |
| `lean API` / `--lean=api` | Claude `--bare`; requires API/provider credentials | Same defaults |

Example host request:

```text
Use Claude Router analyze in lean OAuth mode with model fable and max effort.
Find the smallest safe fix for this parser bug. Do not edit files.
```

Explicit `tools` and `system-prompt` values override the lean defaults. Do not combine Claude `--safe-mode` and `--bare`; they are different authentication paths.

See [Claude Router Capabilities](plugins/claude-router/docs/capabilities.md) for the complete capability boundaries and direct-runtime examples.

## Direct Runtime Usage

Use the companion runtime directly from the plugin directory:

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

Claude controls pass through:

```bash
node scripts/claude-companion.mjs analyze --model opus --effort high "inspect performance risks"
node scripts/claude-companion.mjs plan --chrome "research and plan the browser workflow"
node scripts/claude-companion.mjs exec --allowed-tools "Read,Edit" "apply the requested fix"
node scripts/claude-companion.mjs analyze --lean --model fable --effort max "find the narrowest fix"
```

## Guarded Claude CLI Access

Use `raw` or its `cli` alias for installed Claude features that do not have a managed mode. Pass the Claude arguments after `--`:

```bash
node scripts/claude-companion.mjs raw -- mcp list
node scripts/claude-companion.mjs raw -- plugin list
node scripts/claude-companion.mjs help mcp add
```

Mutating Claude configuration is blocked unless explicitly allowed:

```bash
node scripts/claude-companion.mjs raw --allow-mutating -- \
  mcp add my-server -- node server.mjs
```

Dangerous permission bypass is blocked unless explicitly allowed:

```bash
node scripts/claude-companion.mjs raw --allow-dangerous -- \
  -p --permission-mode bypassPermissions "trusted sandbox task"
```

## Uninstall

### Codex

```bash
codex plugin remove claude-router@claude-router
codex plugin marketplace remove claude-router
```

If you previously followed the legacy standalone MCP instructions:

```bash
codex mcp remove claude-router
```

### Antigravity IDE

Remove the `claude-router` plugin directory from the Antigravity global or workspace plugin location you selected. That removes the registration; delete the retained repository checkout separately only if you no longer need it.

### Antigravity CLI (`agy`)

```bash
agy plugin disable claude-router
agy plugin uninstall claude-router
agy plugin list
```

Uninstalling the registration does not delete the retained repository checkout.

### Claude Code

```bash
claude plugin uninstall claude-router
claude plugin marketplace remove claude-router
```

## Troubleshooting

If setup reports `claude not found`, install Claude Code and make sure `claude` is on `PATH`.

If setup reports missing authentication:

```bash
claude auth login
```

If Claude runs against the wrong project, provide `cwd` in the MCP tool request or pass `--cwd` to the direct runtime.

If `raw` refuses a command, it detected a Claude configuration mutation or dangerous permission request. Use `--allow-mutating` or `--allow-dangerous` only when that action is explicitly intended.

If Codex cannot find Claude Router after installation, start a new Codex task.

If Antigravity cannot find the skill, confirm the plugin is under `<workspace>/.agents/plugins/claude-router` or `~/.gemini/config/plugins/claude-router`, then start a new conversation.

If Antigravity CLI reports `missing plugin.json`, pass `.agy`, not the repository root:

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

`npm run validate` checks the plugin manifest and cross-host version alignment.

## License

Apache-2.0. This project is independent and is not affiliated with Anthropic, Google, or OpenAI.
