# Changelog

All notable changes to Claude Router are documented here.

## [2.3.0] — 2026-07-11

### Added

- Workspace state lock (`state.lock`) serializing all state mutations across concurrent companion and MCP processes, with stale-lock recovery keyed to holder process identity and env-tunable timeouts (`CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS`, `CLAUDE_ROUTER_STATE_LOCK_STALE_MS`).
- Atomic conditional job transitions (`transitionJob`) that write the job index and per-job file together under the state lock.
- Process identity records (PID plus start time) with fail-closed PID-reuse verification for tracked jobs and lock holders.
- Cancel ownership protocol: cancellation atomically claims a job before any kill, releases ownership when a kill fails, and finalizes idempotently whether the runner or the canceller observes child exit first.
- Foreground jobs now track the Claude child process identity separately from the companion wrapper, so `cancel` terminates the Claude process tree rather than the wrapper.
- Graceful process-tree termination with SIGTERM to SIGKILL escalation and post-kill verification; active jobs whose recorded process is gone are marked failed as stale.
- MCP tool input validation returning JSON-RPC `-32602` invalid-params errors; read-only routed commands no longer advertise write-capable controls in their MCP schemas.

### Fixed

- Preserved explicit `--tools ""` (disable all built-in tools) through raw-string tokenization, routing, and MCP flag plumbing.
- Treated `--tmux` as a bare boolean flag so inline `--tmux=classic` no longer consumes the following token.

## [2.2.4] — 2026-07-09

### Fixed

- Centralized routed command and control metadata so companion CLI parsing, MCP tool schemas, and command-surface validation no longer duplicate the same flag lists.
- Scoped MCP input schemas by command type so setup, raw, status, result, cancel, models, and ultrareview no longer advertise routed controls they ignore.
- Preserved raw Claude passthrough flags that resemble routed controls, such as `--resume` and `--allowed-tools`, instead of consuming them before `--`.
- Rejected unsupported routed `--timeout`, `--base`, and `--scope` usage clearly instead of silently treating them as ineffective routed controls.
- Preserved numeric `0` timeout values for raw and status wait paths while continuing to reject invalid negative or non-numeric timeouts.
- Hardened MCP JSON-RPC tests to handle newline-delimited responses split across stdout chunks.

## [2.2.3] — 2026-07-02

### Fixed

- Fixed background cancellation so the worker process group also owns the live Claude child process, preventing detached Claude children from surviving after `cancel`.
- Added a default bounded timeout for managed routed Claude print jobs, plus `--timeout-ms` / `timeout_ms` override support.
- Made `cancel` fail closed when hard-kill verification still sees the process alive instead of falsely marking the job `cancelled`.
- Updated the model catalog and docs for current Claude permission modes: `default`, `acceptEdits`, `auto`, `plan`, `dontAsk`, and `bypassPermissions`.
- Clarified that `--long-context` and `--ultrathink` are Claude Router convenience controls, not native Claude CLI flags.

## [2.2.2] — 2026-07-02

### Fixed

- Added PID identity records with process start time for background jobs so cancellation does not signal a reused PID.
- Added stale active-job detection during `status` and `result`, marking unverifiable/stale process records failed instead of leaving them running forever.
- Added SIGTERM-to-SIGKILL process-group escalation primitives with bounded polling for background job cancellation and process cleanup.

## [2.2.1] — 2026-07-02

### Fixed

- Hardened raw Claude CLI guardrails so global flags, literal `help` arguments, `--help=false`, and `--dry-run=false` cannot hide mutating commands.
- Blocked routed dangerous permission bypasses through `--permission-mode bypassPermissions` and `--allow-dangerously-skip-permissions` unless `--allow-dangerous` is explicitly supplied.
- Preserved repeated routed values and inline values containing `=`, including tool allowlists and prompt/system-prompt controls.
- Required `cancel` to target an active job and made state/job writes atomic to avoid partial JSON reads during background job races.

## [2.2.0] — 2026-07-02

### Added

- Claude Code plugin marketplace metadata and plugin manifest for installing Claude Router directly into Claude Code.
- `/claude-router:*` command palette files for setup, version, models, surface, help, analyze, plan, exec, review, adversarial-review, ultrareview, status, result, cancel, raw, and cli.
- `adversarial-review` routed mode for read-only challenge reviews of approach, assumptions, and design tradeoffs.

## [2.1.1] — 2026-07-02

### Added

- Live model selector discovery from installed `claude --help`, including new aliases such as `fable` and full names such as `claude-fable-5` when the local Claude CLI advertises them.
- `claude_router_version` MCP tool and companion `version` / `-v` / `--version` command reporting both Claude Router and Claude CLI versions.
- Router-aware `help` / `-h` / `--help` output with command summaries, model controls, and examples.

### Changed

- `claude_router_models` now returns `discovery` and `models` sections in addition to curated tiers, effort levels, modifiers, permission modes, and presets.

## [2.1.0] — 2026-07-01

### Added

- `claude_router_models` MCP tool and `models` companion mode for discovering available Claude model tiers, effort levels, modifiers, permission modes, and presets.
- Optional `capability` filter parameter (long_context, ultrathink, chrome) to narrow the catalog to tiers supporting a specific capability. Unknown values are rejected.
- Permission modes exposed in the catalog: default (interactive approval), plan (read-only), bypassPermissions (requires `--allow-dangerous`).
- Presets section in the catalog (`--best` resolves to opus).
- `models-output.schema.json` for validating catalog output.
- `renderModelCatalog()` renderer producing markdown tables for the companion CLI.
- 18 new tests covering catalog structure, capability filtering, schema validation, MCP tool integration, rendering, and permission mode guards (63 total).
- Model Catalog Language section in CONTEXT.md defining terms: Model Catalog, Model Tier, Effort Level, Modifier, Permission Mode, Capability Filter, Preset.
- Model Catalog Reference section in README.md with permission modes table, capability filtering docs, and catalog section descriptions.
- Model Catalog Output section in AGY SKILL.md with permission modes table and capability filter docs.
- Expanded `claude_router_models` documentation in Codex SKILL.md with full catalog structure breakdown.
- AGY install and uninstall documentation in README.md.

## [2.0.0] — 2026-06-25

### Added

- AGY host adapter: `.agy/plugin.json` and `.agy/skills/claude-router/SKILL.md` for AGY plugin registration.
- AGY install, uninstall, enable, and disable commands in README.md.
- `validate:manifests` script for cross-host version alignment checks.
- `ultrareview` mode for Claude cloud-hosted multi-agent review.

### Changed

- README rewritten for dual-host (Codex + AGY) audience.

### Fixed

- Background job result wait handling.

## [1.0.0] — 2026-06-23

### Added

- Initial Claude Router plugin for Codex.
- Policy-backed modes: setup, surface, help, analyze, plan, exec, review, raw.
- MCP server (`claude-router-mcp.mjs`) exposing `claude_router_*` tools over JSON-RPC stdio.
- Companion CLI (`claude-companion.mjs`) for direct runtime usage.
- Background job tracking with status, result retrieval, and cancellation.
- Read-only mode git status snapshots with `completed-with-warnings` on unexpected file changes.
- Mutation and dangerous-permission guardrails on `raw` mode.
- Plugin validation script.
- Context and terminology definitions in CONTEXT.md.
- 45 tests covering MCP protocol, companion CLI, job lifecycle, and rendering.
