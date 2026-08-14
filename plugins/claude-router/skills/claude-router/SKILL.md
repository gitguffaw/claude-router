---
name: claude-router
description: Route Codex work through the local Claude CLI with setup checks, explicit modes, model and effort controls, full-surface help/raw passthrough, background jobs, status, result, and cancel. Use when Codex should delegate planning, analysis, execution, review, browser-backed work, MCP/plugin-aware work, or long-context reasoning to Claude.
---

# Claude Router

Use this skill when Codex should invoke a real local `claude` CLI run instead of answering with Codex alone.

## Preferred Surface

Prefer the plugin MCP tools when available:

- `claude_router_setup`
- `claude_router_surface`
- `claude_router_help`
- `claude_router_version`
- `claude_router_raw`
- `claude_router_analyze`
- `claude_router_plan`
- `claude_router_exec`
- `claude_router_review`
- `claude_router_adversarial_review`
- `claude_router_ultrareview`
- `claude_router_status`
- `claude_router_result`
- `claude_router_cancel`
- `claude_router_models`

In Claude Code itself, the plugin also exposes `/claude-router:*` commands for setup, version, models, surface, help, analyze, plan, exec, review, adversarial-review, ultrareview, status, result, cancel, raw, and cli.

If the MCP tools are unavailable during local development, use exactly one direct runtime command:

```bash
node scripts/claude-companion.mjs <command> [args...]
```

Do not replace a failed Claude run with a Codex-generated substitute answer.

## Modes

- `surface`: report installed Claude version, top-level help, and router coverage
- `help`: show Claude Router help, or installed Claude help when a command path is provided
- `version`: report Claude Router and installed Claude CLI versions
- `models`: read the installed CLI and report documented model examples, live fields and choices, and lean-profile availability
- `raw`: run a raw Claude CLI command with mutation and dangerous-permission guardrails
- `analyze`: read-only facts, tradeoffs, recommendations, and next action
- `plan`: read-only implementation or migration plan
- `exec`: write-capable implementation; use only when the user wants Claude to make changes
- `review`: read-only local review; findings first and no auto-fixes
- `adversarial-review`: read-only challenge review of approach, assumptions, and design tradeoffs
- `ultrareview`: wraps Claude's cloud-hosted `ultrareview` command

## Controls

- `--model <model>` passes through to Claude. Use `claude_router_models` or `models` to discover live selectors from the installed Claude CLI.
- `--effort <value>` passes through without a router allowlist. Use live discovery for current choices.
- `--lean[=auto|oauth|api]` creates a minimal-context run. Auto detects auth; OAuth uses Claude `--safe-mode`; API uses `--bare`.
- Lean defaults are `Bash,Read` for read-only modes and `Bash,Read,Edit,Write` for `exec`, plus a concise core system prompt. Explicit `--tools` and `--system-prompt` override them.
- `--best`, tier shorthands, `--long-context`, and `--ultrathink` are legacy compatibility conveniences. Prefer explicit live model selectors and native fields.
- Native Claude fields are discovered from installed help and added to the routed surface dynamically. Use `surface` or `help` to inspect exact local behavior.
- `--timeout-ms <milliseconds>` bounds managed routed Claude print jobs; `0` disables the managed timeout.
- `--background` returns a job id; use `status`, `result`, or `cancel` for follow-up.
- For Claude commands that are not represented by a managed tool, call `surface` or `help` first, then use `raw` with exact Claude CLI args.

## Hard Rules

- Do not claim Claude has a native generic web-search command. Use Chrome, MCP, or explicit docs verification when needed.
- Do not use `--bare` on an OAuth/subscription path; it does not read OAuth or keychain credentials. Use `--lean` or `--lean=oauth` instead.
- Do not use dangerous permission bypass unless the user explicitly asks for that risk.
- Do not use `raw` for mutating Claude configuration unless the user explicitly requested that action; pass the raw tool's mutation override only in that case.
- Do not edit files from `analyze`, `plan`, `review`, or `adversarial-review`.
- Do not auto-fix review findings.
- Preserve Claude failure boundaries.
