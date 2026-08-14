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

- Verified local binary during this audit: `claude 2.1.232 (Claude Code)`
- Verified on: `2026-08-14`
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

- Treat model selectors as an installed-CLI surface, not a policy-owned enum. Re-read `claude --help` and pass the selected value through unchanged.
- Moving aliases such as `fable`, `opus`, and `sonnet`, full model names, context suffixes, and provider-specific mappings may change without a Claude Router release.
- Use full model names or pinned `ANTHROPIC_DEFAULT_*_MODEL` environment variables when version stability matters more than convenience aliases.
- Use `claude_router_models` to read the current installed surface. It returns documented model examples, every discovered top-level CLI field, current effort and permission choices, and lean-profile availability.
- Claude help publishes model examples, not a guaranteed exhaustive registry. Do not infer that an unlisted selector is invalid or that a listed family has a fixed capability matrix.

## Effort Policy

- Treat effort values like model selectors: discover current choices from installed help and pass the requested value through.
- Values such as `low`, `medium`, `high`, `xhigh`, and `max` are examples from the audited CLI, not a router allowlist.
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
8. Use `--safe-mode` for minimal customizations while retaining subscription/OAuth. Use `--bare` only for API-key/provider paths because it skips OAuth and keychain reads.

## Availability Checks

- `claude --help`
- `claude -p --help`
- `claude auth status`
- `claude agents`
- `claude mcp list`
- `claude plugin list`
- Distinguish "documented by Anthropic" from "enabled and authenticated in this local environment."

## Parity Rules

- Do not use `--bare` on a subscription/OAuth route. Prefer router `--lean`/`--lean=oauth` or direct Claude `--safe-mode`.
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
