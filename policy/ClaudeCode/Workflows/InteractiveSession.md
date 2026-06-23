# ReasoningSurface Workflow

Use interactive `claude` as the primary route when Codex wants Claude to act as a real second reasoning, planning, browser, or coding surface.

## When to Use

- Get an independent Claude pass on architecture, debugging, or implementation strategy
- Plan safely before making edits
- Use Claude with its normal plugins, MCP servers, hooks, skills, slash commands, and session behavior
- Run a long-context Claude session
- Use built-in `Explore` for repo or docs exploration inside Claude
- Use Claude subagents or custom agents
- Resume or fork existing Claude sessions
- Use browser-backed research or authenticated website access through Claude

## 1. Choose The Work Shape First

```bash
# Planning-first session
claude --permission-mode plan --model opus

# Highest-capability reasoning
claude --model opus --effort xhigh

# Deepest local reasoning
claude --model opus --effort max

# Long-context reasoning
claude --model opus[1m] --effort xhigh

# Faster execution-oriented session
claude --model sonnet --effort high

# Hybrid plan and execute
claude --model opusplan --permission-mode plan

# Browser-backed web work
claude --chrome --model sonnet --effort high
```

Guidance:

- Use `--permission-mode plan` or `/plan` when the task is mostly analysis, requirements work, or migration planning.
- Use built-in `Explore` via `/agents` or `--agent Explore` when the goal is Claude-led repo or docs exploration instead of browser automation.
- Use `--effort max` when the user wants the deepest Claude reasoning. This is the real "max think" control.
- Use `[1m]` variants only when the current plan and model support them.
- Use `--chrome` only when browser automation is actually the right surface. Claude Code docs do not describe a native generic web-search command.

## 2. Preserve Normal Claude Behavior

- Do not add `--bare` unless the task specifically requires isolation.
- Let Claude see its ordinary plugins, MCP servers, hooks, `CLAUDE.md`, slash commands, and saved sessions.
- Use `--agent` or `--agents` when a specialized Claude subagent topology helps.

```bash
# Named agent
claude --agent reviewer

# Inline agents
claude --agents '{"reviewer":{"description":"Critical reviewer","prompt":"Challenge the plan and find weak assumptions."}}'
```

## 3. Confirm Live Capabilities Before Delegating

```bash
claude auth status
claude agents
claude mcp list
claude plugin list
claude --help
```

Use these checks to separate:

- documented capability from Anthropic docs
- locally enabled capability in this account and machine state

## 4. Use Claude Session Features Directly

```bash
claude --continue
claude --resume 123e4567-e89b-12d3-a456-426614174000
claude --resume 123e4567-e89b-12d3-a456-426614174000 --fork-session
```

Useful session commands:

- `/model`: switch models or `[1m]` variants
- `/effort`: adjust reasoning depth
- `/agents`: inspect and manage agents
- `Explore`: preferred built-in agent for repo and docs exploration when available
- `/plan`: keep the session in planning mode
- `/ultraplan`: move planning into Claude Code on the web when cloud review is desired
- `/chrome`: inspect or enable browser automation state
- `/mcp`: inspect server status and authentication
- `/help`: inspect available commands
- `/hooks`: inspect hook configuration
- `/branch`: branch the conversation
- `/plugin`: inspect plugin state when available

## Notes

- Interactive mode is the default when `-p` is absent.
- `--bare` disables convenience layers and ambient Claude state. It is a debugging tool, not the default second-brain route.
- `max` is session-only unless `CLAUDE_CODE_EFFORT_LEVEL` is set.
- Chrome integration is beta and requires Chrome or Edge plus the Claude in Chrome extension and a direct Anthropic plan.
- `opusplan` is the plan and execute alias, but do not assume 1M plan-mode context there.
