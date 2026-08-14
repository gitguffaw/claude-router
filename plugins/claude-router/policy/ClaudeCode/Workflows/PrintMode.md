# PrintMode Workflow

Use this workflow only when Codex needs non-interactive Claude output for another tool, script, or pipeline.

## Default Entry Point

Prefer the wrapper:

```bash
python3 scripts/claude_print.py "<task>"
```

Use raw `claude -p` only when the wrapper does not expose a needed flag.

## Steps

### 1. Choose the output contract first

- Use `json` for one final object.
- Use `stream-json` only for event consumers.
- Use `text` only for human-only output.
- Prefer a schema file when downstream parsing matters.

### 2. Run the smallest command that satisfies the contract

```bash
# Final JSON object
python3 scripts/claude_print.py \
  "List all HTTP routes in this repo"

# Schema-validated JSON
python3 scripts/claude_print.py \
  --schema-file schema.json \
  "Return every HTTP route as a JSON array"

# Realtime event stream
python3 scripts/claude_print.py \
  --output-format stream-json \
  --include-partial-messages \
  "Analyze this repo and stream progress updates"
```

### 3. Control ambient state explicitly

- Keep ordinary Claude behavior unless the task needs isolation.
- Add `--safe-mode` when an OAuth/subscription run should suppress customizations.
- Add `--bare` only for an API-key/provider run that should suppress ambient state; bare mode does not read OAuth or keychain credentials.
- Add `--permission-mode`, `--settings`, `--setting-sources`, `--mcp-config`, or `--plugin-dir` only when the task needs them.
- Pipe stdin when extra context exists; keep the prompt as the instruction.

### 4. Parse stdout by mode

- `json`: one final structured object.
- `stream-json`: event stream.
- `text`: human-only text.

## Raw CLI Fallbacks

```bash
# Raw print mode with normal Claude behavior
claude -p --output-format json --permission-mode default \
  "Generate a release summary from CHANGELOG.md"

# Lean OAuth/subscription print mode
claude -p --safe-mode --tools "Bash,Read" \
  --system-prompt "You are a concise expert coding assistant." \
  "Return a focused analysis"

# Lean API-key print mode
ANTHROPIC_API_KEY=... claude -p --bare --tools "Bash,Read" \
  --system-prompt "You are a concise expert coding assistant." \
  "Return a focused analysis"

# Streaming input plus streaming output
claude -p --input-format stream-json --output-format stream-json \
  "Consume the event stream and return normalized events"
```

## Notes

- `-p` skips the workspace trust dialog. Use it only in trusted directories.
- Print mode is not the default second-brain route for this skill.
- `--fallback-model`, `--max-budget-usd`, and `--no-session-persistence` are print-mode only.
