# Claude Router Plugin

This context defines the language for Claude Router as a host-adapted Claude CLI delegation contract.

## Language

**Claude Router Plugin**:
A plugin bundle that invokes the local Claude CLI through policy-backed modes and deterministic job management.
Avoid: standalone Claude CLI, replacement for Claude Code, Claude Code plugin.

**Claude Router Core**:
The host-independent runtime contract for routing, executing, tracking, and retrieving Claude CLI work.
Avoid: Codex plugin UI, raw shell command.

**Codex Host Adapter**:
The Codex plugin layer that exposes Claude Router Core through Codex skills and MCP tools.
Avoid: Claude Router Core.

**AGY Host Adapter**:
The `.agy` plugin and skill layer that exposes Claude Router instructions to AGY.
Avoid: Codex Host Adapter, Codex socket bridge.

**Claude CLI**:
The local Anthropic `claude` command-line runtime invoked by the plugin.
Avoid: Codex model, Codex plugin runtime.

**Policy Docs**:
The vendored `ClaudeCode` skill files under `policy/ClaudeCode`, used as the readable source of truth for route selection and constraints.
Avoid: generated prompt only.

## Relationships

- The Claude Router Plugin includes Codex and AGY host adapters.
- The Codex Host Adapter invokes the Claude Router Core.
- The AGY Host Adapter instructs AGY to invoke the Claude Router Core.
- The Claude Router Core invokes the Claude CLI.
- Policy Docs define routing intent; runtime code enforces deterministic behavior.
- The Model Catalog combines live model selector discovery from the installed Claude CLI with curated metadata for stable controls exposed by host adapters.

## Model Catalog Language

**Model Catalog**:
The data set returned by `getModelCatalog()` and exposed through the `claude_router_models` tool and `models` companion mode. It includes live `--model` selectors parsed from installed Claude CLI help plus curated model tiers, effort levels, modifiers, permission modes, and presets.
Avoid: treating curated tiers as the complete list of accepted model selectors.

**Model Selector**:
A value accepted by Claude's `--model` flag, such as `fable`, `opus`, `sonnet`, or a full model name such as `claude-fable-5`. Selectors can appear in the live `models` catalog section even when no curated tier metadata exists yet.
Avoid: assuming every selector has known context, cost, or capability metadata.

**Model Tier**:
One of haiku, sonnet, or opus. Each tier has a flag (e.g. `--opus`), context window, optional long-context support, and a cost tier.
Avoid: model version, model ID (those are pinned identifiers, not router tiers).

**Effort Level**:
A reasoning-depth control passed as `--effort <level>`. Levels: low, medium, high, xhigh, max. Controls thinking token budget, not model selection.
Avoid: model quality, model tier.

**Modifier**:
A boolean flag that shapes a Claude session without changing the model tier. Examples: `--long-context`, `--ultrathink`, `--chrome`, `--bare`. Some modifiers are tier-restricted (e.g. ultrathink requires opus).
Avoid: model flag, tier selector.

**Permission Mode**:
Controls what Claude can do during a session. Modes: default (interactive approval), plan (read-only), bypassPermissions (no approval, requires `--allow-dangerous`). Exposed in the catalog as `permission_modes` with a `requires_allow_dangerous` boolean.
Avoid: auth mode, access level.

**Capability Filter**:
An optional parameter (`capability`) on the `claude_router_models` tool and `models --capability` CLI flag. Filters known tiers and model selectors to those supporting a specific capability. Valid values: long_context, ultrathink, chrome. Unknown live selectors are omitted for tier-specific filters when support is not known.
Avoid: model filter, tier search.

**Preset**:
A shortcut flag that resolves to a fixed combination of tier, effort, and modifiers. Currently only `--best` (resolves to opus).
Avoid: alias, model shortcut.
