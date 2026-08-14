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
- The Model Catalog is rebuilt from the installed Claude CLI help. Router policy may constrain safety, but it does not own Claude's model, effort, permission, or native flag vocabulary.

## Model Catalog Language

**Model Catalog**:
The data set returned by `getModelCatalog()` and exposed through the `claude_router_models` tool and `models` companion mode. It includes documented model examples, all discovered top-level CLI fields, live effort and permission choices, compatibility annotations, and lean-profile availability.
Avoid: a static fallback catalog or any claim that router releases enumerate Claude's complete surface.

**Model Selector**:
A value passed to Claude's `--model` flag, such as `fable`, `opus`, `sonnet`, or a full model name such as `claude-fable-5`. Claude Router treats it as opaque and lets the installed CLI validate it.
Avoid: an allowlist or assuming the examples in `claude --help` are exhaustive.

**Live CLI Field**:
A top-level Claude flag parsed from the installed `claude --help`, including its aliases, value shape, current choices, and description. Managed MCP schemas incorporate these fields dynamically.
Avoid: freezing a copied CLI flag list as the authoritative router contract.

**Effort Level**:
A value passed through to `--effort`. The catalog reports the choices currently advertised by the installed CLI; it does not reject future values based on the router release.
Avoid: fixed token-budget claims or a router-owned effort enum.

**Modifier**:
A native Claude field or legacy router convenience that changes session behavior without itself selecting the model. Every catalog entry labels whether its source is live Claude help or router compatibility.
Avoid: presenting router conveniences as native Claude capabilities.

**Permission Mode**:
Controls what Claude can do during a session. Values are discovered from installed help. Router read-only modes still force `plan`, and `bypassPermissions` still requires explicit `--allow-dangerous` consent.
Avoid: confusing Claude's changing value vocabulary with the router's stable safety invariants.

**Lean Profile**:
A router launch profile that reduces ambient context, tool schemas, and the core prompt while preserving the requested authentication path. `oauth` maps to Claude `--safe-mode`; `api` maps to `--bare`; `auto` detects the active path.
Avoid: treating `--safe-mode` and `--bare` as synonyms. Bare mode does not read OAuth or keychain credentials.

**Compatibility Annotation**:
Non-authoritative metadata retained for older tier and router-convenience concepts. It may explain a discovered selector but never adds that selector to the live model list.
Avoid: availability claim or capability filter.
