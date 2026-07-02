# Changelog

All notable changes to Claude Router are documented here.

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
