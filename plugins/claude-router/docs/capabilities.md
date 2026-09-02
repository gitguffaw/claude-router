# Claude Router Capabilities

Claude Router has five distinct capability groups. Choose the narrowest one that matches the job.

## 1. Managed Work Modes

Managed modes wrap Claude print mode with a task contract, permission boundary, job record, timeout, and result handling.

| Capability | Use it for | Boundary | Example request to a host agent |
| --- | --- | --- | --- |
| `analyze` | Facts, diagnosis, tradeoffs, and recommendations | Read-only; Claude permission mode is forced to `plan` | “Use Claude Router analyze to trace this race. Do not edit.” |
| `plan` | Implementation or migration sequencing | Read-only; returns a plan, not changes | “Use Claude Router plan for the database migration.” |
| `exec` | A bounded implementation | Write-capable; defaults to Claude `acceptEdits` | “Use Claude Router exec to implement the parser fix and run tests.” |
| `review` | Findings-first code review | Read-only; never auto-fixes | “Use Claude Router review on the current diff.” |
| `adversarial-review` | Challenge an approach or design | Read-only; emphasizes assumptions and alternatives | “Use adversarial review to challenge this cache design.” |
| `ultrareview` | Claude’s cloud-hosted multi-agent review | Read-only router wrapper around the installed `ultrareview` command | “Run Claude Router ultrareview on this branch.” |

Use `--background` for a managed job that should return immediately. Follow it with `status`, `result`, or `cancel`.

## 2. Live CLI Discovery

Claude’s models and flags change independently of Claude Router. The installed `claude` binary is therefore the runtime authority.

- `models` reads `claude --help` every time. It reports model examples, current field choices such as effort and permission modes, every discovered top-level flag, and lean-profile availability.
- `surface` returns the installed Claude version, top-level help, and the router coverage boundary.
- `help <command path>` asks the installed CLI for command-specific help.
- Managed MCP schemas are rebuilt from live help, so a newly added Claude flag can appear and route without a Claude Router release. MCP `tools/call` forwards one JSON request to the companion on stdin; it does not rebuild companion argv.
- `--model` and `--effort` values are opaque pass-through strings. Claude Router does not keep an allowlist.

Claude currently documents model examples in `--help`; it does not expose a guaranteed exhaustive model registry. The catalog labels this limit as `documented-examples` instead of claiming completeness.

```bash
node scripts/claude-companion.mjs models
node scripts/claude-companion.mjs surface
node scripts/claude-companion.mjs help plugin install
```

## 3. Lean Profiles

A lean profile reduces two different kinds of context:

1. **Ambient context**: project instructions, plugins, skills, hooks, MCP servers, memory, and other customizations.
2. **Tool schemas**: descriptions of tools Claude can call. Fewer schemas leave more attention for the task itself.

`--lean` configures both. It supplies a concise core system prompt and a small tool set unless the caller provides explicit `--system-prompt` or `--tools` values.

| Router option | Claude flag | Authentication | Default tools |
| --- | --- | --- | --- |
| `--lean` or `--lean=auto` | Detected at runtime | Uses the active path | Read-only: `Bash,Read`; exec: `Bash,Read,Edit,Write` |
| `--lean=oauth` | `--safe-mode` | Subscription/OAuth remains available | Same defaults |
| `--lean=api` | `--bare` | Requires `ANTHROPIC_API_KEY`, `apiKeyHelper`, or supported provider credentials | Same defaults |

`--safe-mode` and `--bare` are not synonyms. Safe mode disables customizations but keeps normal authentication behavior. Bare mode skips OAuth and keychain reads. Anthropic documents bare mode for scripted calls and requires API credentials or `apiKeyHelper`; see [programmatic usage](https://code.claude.com/docs/en/headless) and [authentication precedence](https://code.claude.com/docs/en/authentication).

Examples:

```bash
# OAuth/subscription: Fable with minimal ambient context and tools
node scripts/claude-companion.mjs analyze \
  --lean=oauth --model fable --effort max \
  "Find the smallest safe fix for this parser bug"

# Override the lean defaults with a specialized core prompt and tool list
node scripts/claude-companion.mjs exec \
  --lean --model fable --effort max \
  --system-prompt "You are a terse Rust expert." \
  --tools "Bash,Read,Edit" \
  "Remove the unnecessary allocation and run the focused tests"

# API-key path: Claude bare mode
ANTHROPIC_API_KEY=... node scripts/claude-companion.mjs analyze \
  --lean=api --model fable --effort max \
  "Explain this module in five bullets"
```

Do not combine `--safe-mode` and `--bare`. To disable every built-in tool, pass the deliberate empty value `--tools ""`.

## 4. Job Lifecycle

- `status` lists jobs or inspects one job.
- `result` retrieves the stored final result and Claude session id when present.
- `cancel` terminates an active tracked process tree.
- Managed modes store the request, selected controls, policy hash, git snapshots, logs, and result under the workspace’s router state.

```bash
node scripts/claude-companion.mjs analyze --background "map the extension points"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result <job-id>
node scripts/claude-companion.mjs cancel <job-id>
```

## 5. Guarded Full-Surface Access

Use `raw` or its `cli` alias when the installed Claude feature is not a managed work mode. Pass Claude arguments exactly after `--`.

```bash
node scripts/claude-companion.mjs raw -- mcp list
node scripts/claude-companion.mjs raw -- plugin details claude-router
```

Configuration mutations require `--allow-mutating`. Dangerous permission bypass requires `--allow-dangerous`. Commands discovered in a future Claude release default to the guarded path until the router can classify them as read-only.
