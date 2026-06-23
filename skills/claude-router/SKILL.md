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
- `claude_router_raw`
- `claude_router_analyze`
- `claude_router_plan`
- `claude_router_exec`
- `claude_router_review`
- `claude_router_ultrareview`
- `claude_router_status`
- `claude_router_result`
- `claude_router_cancel`

If the MCP tools are unavailable during local development, use exactly one direct runtime command:

```bash
node scripts/claude-companion.mjs <command> [args...]
```

Do not replace a failed Claude run with a Codex-generated substitute answer.

## Modes

- `surface`: report installed Claude version, top-level help, and router coverage
- `help`: show installed Claude help for a command path before using less-common features
- `raw`: run a raw Claude CLI command with mutation and dangerous-permission guardrails
- `analyze`: read-only facts, tradeoffs, recommendations, and next action
- `plan`: read-only implementation or migration plan
- `exec`: write-capable implementation; use only when the user wants Claude to make changes
- `review`: read-only local review; findings first and no auto-fixes
- `ultrareview`: wraps Claude's cloud-hosted `ultrareview` command

## Controls

- `--model <model>` passes through to Claude.
- `--best` maps to `opus`.
- `--sonnet`, `--opus`, and `--haiku` are convenience selectors.
- `--effort <low|medium|high|xhigh|max>` passes through to Claude.
- `--chrome`, `--plugin-dir`, `--plugin-url`, `--mcp-config`, `--settings`, `--add-dir`, agents, tools, allowlists, schemas, resume/session, and print-mode streaming controls are available when the user explicitly needs those Claude surfaces.
- `--background` returns a job id; use `status`, `result`, or `cancel` for follow-up.
- For Claude features that are not represented by a curated tool, call `surface` or `help` first, then use `raw` with exact Claude CLI args.

## Hard Rules

- Do not claim Claude has a native generic web-search command. Use Chrome, MCP, or explicit docs verification when needed.
- Do not use `--bare` by default.
- Do not use dangerous permission bypass unless the user explicitly asks for that risk.
- Do not use `raw` for mutating Claude configuration unless the user explicitly requested that action; pass the raw tool's mutation override only in that case.
- Do not edit files from `analyze`, `plan`, or `review`.
- Do not auto-fix review findings.
- Preserve Claude failure boundaries.
