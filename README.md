# Claude Router for Codex

Use Anthropic Claude CLI from inside Codex with policy-backed routing, setup checks, background jobs, and stored results.

Claude Router vendors the local `ClaudeCode` policy docs and turns them into an executable Codex plugin surface. It favors reliable `claude -p` jobs for V1, while preserving Claude-specific controls such as model, effort, permissions, MCP config, plugins, settings, Chrome, resume, and fork flags.

## What You Get

- `claude-router` skill for Codex-side routing guidance
- MCP tools for setup, surface discovery, command help, raw Claude CLI passthrough, analyze, plan, exec, review, ultrareview, status, result, and cancel
- `scripts/claude-companion.mjs` for direct JSON CLI usage
- background job tracking with per-workspace state and logs
- context packs recording policy hashes and selected controls
- fake-Claude tests that do not consume model calls

## Requirements

- Node.js 18.18 or later
- Codex with plugin and MCP support
- Local `claude` CLI installed and authenticated for real runs

## Direct Runtime Usage

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs surface
node scripts/claude-companion.mjs help mcp add
node scripts/claude-companion.mjs raw -- mcp list
node scripts/claude-companion.mjs analyze "inspect the routing design"
node scripts/claude-companion.mjs plan --background "plan the migration"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result
node scripts/claude-companion.mjs cancel <job-id>
```

## Modes

- `analyze`: read-only Claude analysis through `claude -p`
- `plan`: read-only planning through `claude -p --permission-mode plan`
- `exec`: write-capable Claude execution; this is the only mode intended to edit files
- `review`: local structured review prompt through Claude
- `ultrareview`: wraps `claude ultrareview --json`
- `surface`: reports the installed Claude CLI version and top-level help
- `help`: shows installed Claude CLI help for a command path
- `raw`: executes a raw Claude CLI command without shell interpolation
- `status`, `result`, `cancel`: deterministic job controls

## Safety

Read-only modes record git status before and after Claude runs. If a read-only route changes files, the job is marked with warnings. Dangerous permission bypass flags are rejected unless explicitly allowed.

Claude failures are reported as Claude failures. Codex should not synthesize substitute implementation work when the delegated Claude run did not complete.

Raw Claude commands are intended for feature parity with the installed Claude CLI. Mutating commands such as MCP or plugin configuration changes are blocked unless explicitly run with `--allow-mutating`, and dangerous permission bypass is blocked unless explicitly run with `--allow-dangerous`.

## Development

```bash
npm test
npm run validate:plugin
```

## License

Apache-2.0. This project is independent and is not affiliated with Anthropic or OpenAI.
