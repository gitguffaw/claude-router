---
name: ClaudeCode
description: Anthropic Claude second-surface skill for Codex. Use when Codex should invoke a real Claude Code session for independent reasoning, planning, long-context work, Claude-specific plugins or MCP, browser-backed research, subagents, or model and effort control. Use print mode only when the task specifically needs machine-readable Claude output.
---

# Claude CLI

Operate Anthropic's local `claude` CLI from Codex as a real second reasoning and coding surface. Default to ordinary Claude session behavior, not stripped-down RPC mode.

## Trigger Boundary

- Use when the user explicitly asks for Claude or Anthropic CLI behavior.
- Use when Codex should get an independent Claude pass on architecture, debugging, implementation strategy, or code generation.
- Use when the task benefits from Claude planning surfaces such as `--permission-mode plan`, built-in `Plan`, or `/ultraplan`.
- Use when the task benefits from Claude-specific plugins, MCP tools, hooks, slash commands, subagents, or session memory.
- Use when browser-backed web work, authenticated website access, or Claude-specific research tooling matters.
- Use when model choice, effort level, permission mode, or long-context selection matters. Use `claude_router_models` to discover available options.
- Use print mode only when the deliverable is structured Claude output for another tool or script.
- Do not use only to duplicate trivial work Codex can finish directly without any Claude-specific advantage.

## Baseline

- Verified local binary during Claude Router v2.2.3 audit: `claude 2.1.198 (Claude Code)`
- Verified on: `2026-07-02`
- Verified local environment: first-party Anthropic auth, `max` plan
- Official Anthropic docs: CLI reference, commands, model config, permission modes, MCP, sub-agents, plugins, skills, hooks, Chrome, ultrareview, remote control, gateway, and platform context windows
- Context7 may help discover Claude docs quickly, but official Anthropic docs win for volatile facts
- Local truth source: `claude --help`, `claude -p --help`, `claude auth status`, `claude agents`, `claude mcp list`, and `claude plugin list`
- Codex design sources: OpenAI Codex Skills, Non-interactive Mode, Speed, and Codex Prompting Guide

## Claude-First Defaults

- Treat Claude as a live second agent, not a JSON emitter.
- Prefer interactive `claude` for reasoning-heavy work, autonomous coding, planning, and tool use.
- Preserve ordinary Claude behavior unless the task explicitly needs isolation or structured output.
- For model, provider, plan, or context-window claims that could drift, re-check official Anthropic docs and the local CLI help before asserting them.
- Separate documented capability from live local availability. A feature can be documented but still be unavailable here because of auth, account, provider, or extension state.
- Use `scripts/claude_print.py` only for print-mode extraction or schema-constrained output.
- Prefer `QuickRef.md` and `references/cli-surface.json` over loading large prose into context.

## Model Policy

- `default`: clears any model override and reverts to the runtime default for the current account tier. It is not itself a model alias.
- `best`: most capable available route, currently equivalent to `opus`.
- `opus`: default high-capability Claude reasoning route. The backing version moves over time and can differ by provider.
- `opus[1m]`: preferred for very large codebases or long-context synthesis when 1M context is available on the current model and plan.
- `sonnet`: daily coding and faster execution.
- `sonnet[1m]`: long-context Sonnet route when speed matters more than maximum capability and the current plan supports it.
- `haiku`: fast lower-cost route. Do not assume it supports every higher-end feature.
- `opusplan`: uses `opus` in plan mode and `sonnet` in execution. Useful when the work splits cleanly into planning and execution. Do not assume 1M planning context here.
- Use full model names or pinned `ANTHROPIC_DEFAULT_*_MODEL` environment variables when version stability matters more than convenience aliases.
- Use `claude_router_models` to discover live model selectors and the current model catalog, including tier capabilities, effort levels, permission modes, and modifier flags. It returns:
  - `discovery`: live model discovery status, Claude CLI version, selectors, aliases, full names, and any discovery error
  - `models`: selectors accepted by the installed Claude CLI plus curated fallback selectors
  - `tiers`: known haiku, sonnet, opus metadata — with context window, long-context support, ultrathink support, and cost tier
  - `effort_levels`: low, medium, high, xhigh, max — with token budgets
  - `modifiers`: router controls and Claude session flags (`--long-context`, `--ultrathink`, `--chrome`, `--no-chrome`, `--bare`) — with tier compatibility. `--long-context` and `--ultrathink` are router-level conveniences, not native Claude CLI flags.
  - `permission_modes`: default, acceptEdits, auto, plan, dontAsk, bypassPermissions (requires `--allow-dangerous`)
  - `presets`: `--best` (resolves to opus)
  - Pass `capability` (long_context, ultrathink, chrome) to filter known tiers and selectors. Unknown values are rejected.

## Effort Policy

- `low`: short, latency-sensitive work.
- `medium`: cost-sensitive work that still needs real reasoning.
- `high`: minimum floor for intelligence-sensitive work.
- `xhigh`: best default on Opus 4.7 for demanding coding and agentic tasks. If unsupported, Claude falls back to the highest supported level at or below the requested level.
- `max`: deepest reasoning mode. This is the real "max think" control via `--effort max` or `/effort max`. It is session-only unless `CLAUDE_CODE_EFFORT_LEVEL` is set.
- Use `ultrathink` in the prompt for a one-turn deep-reasoning push without changing the session setting.

## Planning Policy

- Local planning surfaces: `--permission-mode plan`, `/plan`, and the built-in `Plan` agent.
- Cloud planning surface: `/ultraplan`. This is a Claude Code on the web research-preview feature and requires a Claude Code on the web account plus a GitHub repository.
- If the task is mostly exploration, planning, or requirements work before edits, start in plan mode instead of a normal execution session.
- Do not treat `model` settings as enforcement. When hard model control matters, combine model selection with managed or policy settings.

## Research Policy

- Claude Code docs do not describe a native general-purpose `web search` command.
- For repo, codebase, and docs exploration inside Claude, prefer the built-in `Explore` agent via `/agents` or `--agent Explore` when `claude agents` confirms it is available.
- For browser-backed research, authenticated website work, or extracting data from pages, use `--chrome` or `/chrome` when available.
- For Claude-side tool discovery, use MCP Tool Search. This is for MCP tool discovery, not generic web search.
- For documentation or volatile product claims, verify against official Anthropic docs or the relevant primary source.
- Confirm live availability with `claude --help`, `claude auth status`, `claude agents`, `claude mcp list`, and `claude plugin list` before promising a Claude capability.

## Default Route

1. For planning-first tasks, start with `claude --permission-mode plan` or a normal session that uses the built-in `Plan` agent.
2. For second-brain execution or review, launch ordinary interactive `claude` with an explicit model and effort when needed.
3. Keep plugins, MCP, hooks, `CLAUDE.md`, slash commands, and session memory available by default.
4. For repo or docs exploration inside Claude, prefer the built-in `Explore` agent when it is available locally.
5. Use `--chrome` only for browser or web tasks and only when the direct Anthropic prerequisites are satisfied.
6. Use `--agent` or `--agents` when Claude subagents or specialized roles help.
7. Use `python3 scripts/claude_print.py` only for print-mode or machine-readable output.
8. Use `--bare` only when the goal is reproducibility, debugging hidden state, or stripping ambient behavior.

## Availability Checks

- `claude --help`
- `claude -p --help`
- `claude auth status`
- `claude agents`
- `claude mcp list`
- `claude plugin list`
- Distinguish "documented by Anthropic" from "enabled and authenticated in this local environment."

## Parity Rules

- Do not default to `--bare`.
- Do not default to `-p`.
- Treat Claude plugins, MCP servers, skills, subagents, slash commands, and session state as potentially live capabilities, but confirm auth and install state before promising them.
- Prefer `/model`, `/effort`, `/agents`, `/help`, `/hooks`, `/resume`, `/plugin`, `/mcp`, `/chrome`, `/plan`, and `/ultraplan` inside real sessions when parity matters.
- Do not imply a native Claude Code web-search command when the real surface is Chrome, MCP Tool Search, browser sessions, or docs verification.
- Use `--plugin-dir`, `--mcp-config`, and `--settings` to add or isolate behavior; do not assume they are fallback-only surfaces.

## Print-Mode Rules

- Default print-mode output can be `json`, but print mode is a specialized extraction workflow.
- Use `--schema-file` when downstream code needs stable fields.
- Use `stream-json` only when a consumer needs an event stream.
- If stdin is piped, treat it as extra context, not the instruction.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **ReasoningSurface** | Need Claude as a real independent reasoning, planning, browser, or coding surface with full session behavior | `Workflows/InteractiveSession.md` |
| **PrintMode** | Need non-interactive Claude output for scripts, pipelines, or schema-constrained responses | `Workflows/PrintMode.md` |
| **Extensibility** | Need plugins, MCP servers, hooks, settings files, browser or research enablement, or other Claude CLI capability shaping | `Workflows/Extensibility.md` |

## Files

- `scripts/claude_print.py`: print-mode helper, not the primary route
- `Workflows/InteractiveSession.md`: primary Claude second-surface workflow
- `Workflows/PrintMode.md`: print-mode and schema patterns
- `Workflows/Extensibility.md`: plugin, MCP, agent, browser, and settings work
- `QuickRef.md`: current CLI surface
- `references/cli-surface.json`: machine-readable reference including Codex-side design constraints and verified environment state

## Examples

**Example 1: Planning-first architecture pass**
```
Task: Have Claude plan a repo-wide auth redesign before making edits
-> Invoke ReasoningSurface
-> Run: claude --permission-mode plan --model opus "Analyze the authentication architecture, identify risks, and produce a migration plan."
```

**Example 2: Max-think execution session**
```
Task: Give Claude its deepest local reasoning mode for a hard debugging problem
-> Invoke ReasoningSurface
-> Run: claude --model opus --effort max "Debug the intermittent production-only failure and challenge weak assumptions."
```

**Example 3: Browser-backed research**
```
Task: Use Claude to inspect a live web flow or an authenticated product page
-> Invoke ReasoningSurface
-> Run: claude --chrome --model sonnet --effort high "Open the app, reproduce the issue, and summarize what the browser shows."
```

**Example 4: Structured extraction**
```
Task: Return machine-readable data from Claude to another tool
-> Invoke PrintMode
-> Run: python3 scripts/claude_print.py --schema-file schema.json "Extract project metadata from the repo"
```

## Quick Reference

See `QuickRef.md` for current command syntax and `references/cli-surface.json` for a machine-readable snapshot of the verified CLI surface.
