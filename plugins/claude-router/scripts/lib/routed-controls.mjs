const STRING_SCHEMA = { type: "string" };
const BOOLEAN_SCHEMA = { type: "boolean" };
const NONNEGATIVE_NUMBER_SCHEMA = { type: "number", minimum: 0 };
const STRING_OR_STRING_ARRAY_SCHEMA = { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] };
const BOOLEAN_OR_STRING_SCHEMA = { oneOf: [{ type: "boolean" }, { type: "string" }] };
const LEAN_SCHEMA = { oneOf: [{ type: "boolean" }, { type: "string", enum: ["auto", "oauth", "api"] }] };

export const READ_ONLY_ROUTED_COMMANDS = new Set(["analyze", "plan", "review", "adversarial-review"]);
export const READ_ONLY_PERMISSION_MODES = ["plan"];
// Retained as an empty compatibility export. Write-capable permission values
// are discovered from the installed Claude CLI rather than frozen here.
export const WRITE_CAPABLE_PERMISSION_MODES = [];

function defaultInputKeys(option, optionAliases = []) {
  const names = [option, ...optionAliases];
  return [...new Set(names.flatMap((name) => [name.replaceAll("-", "_"), name]))];
}

function control({
  flag,
  option = flag.slice(2),
  optionAliases = [],
  inputKeys,
  schema = STRING_SCHEMA,
  kind = "value",
  repeatable = false,
  // When false, control remains available on the CLI for clear rejection messages
  // but is omitted from MCP schemas so clients cannot advertise unsupported inputs.
  mcp = true,
  // When true, omit from MCP schemas for read-only routed commands (Finding 4 boundary).
  mcpOmitReadOnly = false,
  owner = "native"
}) {
  return {
    flag,
    option,
    optionAliases,
    inputKeys: inputKeys ?? defaultInputKeys(option, optionAliases),
    schema,
    kind,
    repeatable,
    mcp,
    mcpOmitReadOnly,
    owner
  };
}

// Router-owned: parsed even when `claude --help` is down. Not forwarded as a
// native Claude flag unless resolveClaudeControls maps them (lean, shorthands).
export const ROUTER_OWNED_VALUE_CONTROLS = [
  control({ flag: "--cwd", mcp: false, owner: "router" }),
  control({ flag: "--timeout-ms", schema: NONNEGATIVE_NUMBER_SCHEMA, owner: "router" }),
  control({ flag: "--base", mcp: false, owner: "router" }),
  control({ flag: "--scope", mcp: false, owner: "router" }),
  control({ flag: "--timeout", mcp: false, owner: "router" })
];

export const ROUTER_OWNED_OPTIONAL_VALUE_CONTROLS = [
  control({ flag: "--lean", schema: LEAN_SCHEMA, kind: "optional-value", owner: "router" })
];

export const ROUTER_OWNED_BOOLEAN_CONTROLS = [
  control({ flag: "--background", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--json", schema: BOOLEAN_SCHEMA, kind: "boolean", mcp: false, owner: "router" }),
  control({ flag: "--best", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--sonnet", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--opus", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--haiku", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--long-context", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--ultrathink", schema: BOOLEAN_SCHEMA, kind: "boolean", owner: "router" }),
  control({ flag: "--allow-dangerous", schema: BOOLEAN_SCHEMA, kind: "boolean", mcpOmitReadOnly: true, owner: "router" }),
  control({ flag: "--search", schema: BOOLEAN_SCHEMA, kind: "boolean", mcp: false, owner: "router" }),
  control({
    flag: "--web-search",
    optionAliases: ["webSearch"],
    inputKeys: ["web_search", "web-search", "webSearch"],
    schema: BOOLEAN_SCHEMA,
    kind: "boolean",
    mcp: false,
    owner: "router"
  })
];

// Native seed: parse these even when help is down. Live discovery overlays
// the same options (aliases, descriptions, kind) and adds flags the seed
// does not know. Emit goes through nativeArgsFromParsedOptions, not a
// camelCase bag.
export const NATIVE_SEED_VALUE_CONTROLS = [
  control({ flag: "--model" }),
  control({ flag: "--effort" }),
  control({ flag: "--permission-mode" }),
  control({ flag: "--plugin-dir", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--plugin-url", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--mcp-config", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--settings" }),
  control({ flag: "--setting-sources" }),
  control({ flag: "--add-dir", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--agent" }),
  control({ flag: "--agents" }),
  control({ flag: "--allowed-tools", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true, optionAliases: ["allowedTools"] }),
  control({ flag: "--disallowed-tools", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true, optionAliases: ["disallowedTools"] }),
  control({ flag: "--tools", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--append-system-prompt" }),
  control({ flag: "--betas", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--debug-file" }),
  control({ flag: "--fallback-model" }),
  control({ flag: "--file", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--from-pr" }),
  control({ flag: "--input-format" }),
  control({ flag: "--json-schema" }),
  control({ flag: "--max-budget-usd" }),
  control({ flag: "--name" }),
  control({ flag: "--output-format" }),
  control({ flag: "--prompt-suggestions" }),
  control({ flag: "--remote-control" }),
  control({ flag: "--remote-control-session-name-prefix" }),
  control({ flag: "--session-id" }),
  control({ flag: "--system-prompt" })
];

export const NATIVE_SEED_OPTIONAL_VALUE_CONTROLS = [
  control({ flag: "--debug", schema: BOOLEAN_OR_STRING_SCHEMA, kind: "optional-value" }),
  control({ flag: "--resume", schema: BOOLEAN_OR_STRING_SCHEMA, kind: "optional-value" }),
  control({ flag: "--tmux", schema: BOOLEAN_OR_STRING_SCHEMA, kind: "optional-value" }),
  control({ flag: "--worktree", schema: BOOLEAN_OR_STRING_SCHEMA, kind: "optional-value" })
];

export const NATIVE_SEED_BOOLEAN_CONTROLS = [
  control({ flag: "--chrome", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--no-chrome", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--bare", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--strict-mcp-config", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({
    flag: "--dangerously-skip-permissions",
    optionAliases: ["bypass-permissions"],
    inputKeys: ["dangerously_skip_permissions", "dangerously-skip-permissions", "bypass_permissions", "bypass-permissions"],
    schema: BOOLEAN_SCHEMA,
    kind: "boolean",
    mcpOmitReadOnly: true
  }),
  control({ flag: "--allow-dangerously-skip-permissions", schema: BOOLEAN_SCHEMA, kind: "boolean", mcpOmitReadOnly: true }),
  control({ flag: "--ax-screen-reader", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--brief", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--continue", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--disable-slash-commands", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--exclude-dynamic-system-prompt-sections", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--fork-session", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--ide", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--include-hook-events", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--include-partial-messages", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--no-session-persistence", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--replay-user-messages", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--safe-mode", schema: BOOLEAN_SCHEMA, kind: "boolean" }),
  control({ flag: "--verbose", schema: BOOLEAN_SCHEMA, kind: "boolean" })
];

export const ROUTER_OWNED_CONTROLS = [
  ...ROUTER_OWNED_VALUE_CONTROLS,
  ...ROUTER_OWNED_OPTIONAL_VALUE_CONTROLS,
  ...ROUTER_OWNED_BOOLEAN_CONTROLS
];

export const NATIVE_SEED_CONTROLS = [
  ...NATIVE_SEED_VALUE_CONTROLS,
  ...NATIVE_SEED_OPTIONAL_VALUE_CONTROLS,
  ...NATIVE_SEED_BOOLEAN_CONTROLS
];

export const ROUTED_VALUE_CONTROLS = [...ROUTER_OWNED_VALUE_CONTROLS, ...NATIVE_SEED_VALUE_CONTROLS];
export const ROUTED_OPTIONAL_VALUE_CONTROLS = [...ROUTER_OWNED_OPTIONAL_VALUE_CONTROLS, ...NATIVE_SEED_OPTIONAL_VALUE_CONTROLS];
export const ROUTED_BOOLEAN_CONTROLS = [...ROUTER_OWNED_BOOLEAN_CONTROLS, ...NATIVE_SEED_BOOLEAN_CONTROLS];

export const ROUTED_VALUE_OPTIONS = ROUTED_VALUE_CONTROLS.map((item) => item.option);
export const ROUTED_OPTIONAL_VALUE_OPTIONS = ROUTED_OPTIONAL_VALUE_CONTROLS.map((item) => item.option);
export const ROUTED_BOOLEAN_OPTIONS = ROUTED_BOOLEAN_CONTROLS.flatMap((item) => [item.option, ...item.optionAliases]);
export const ROUTED_REPEATABLE_OPTIONS = ROUTED_VALUE_CONTROLS.filter((item) => item.repeatable).map((item) => item.option);

export const MCP_ROUTED_VALUE_CONTROLS = ROUTED_VALUE_CONTROLS.filter((item) => item.mcp !== false);
export const MCP_ROUTED_OPTIONAL_VALUE_CONTROLS = ROUTED_OPTIONAL_VALUE_CONTROLS.filter((item) => item.mcp !== false);
export const MCP_ROUTED_BOOLEAN_CONTROLS = ROUTED_BOOLEAN_CONTROLS.filter((item) => item.mcp !== false);

export const ROUTER_OWNED_OPTIONS = new Set(ROUTER_OWNED_CONTROLS.flatMap((item) => [item.option, ...item.optionAliases]));
export const ROUTER_OWNED_SCHEMA_OPTIONS = new Set(
  ROUTER_OWNED_CONTROLS.filter((item) => item.mcp !== false).map((item) => item.option)
);

export const NATIVE_EMIT_SKIP = new Set([
  "model",
  "effort",
  "permission-mode",
  "output-format",
  "print",
  "help",
  "version",
  "tools",
  "system-prompt",
  "safe-mode",
  "bare",
  "dangerously-skip-permissions",
  "bypass-permissions"
]);

export function routedFlagEntries(controls) {
  return controls.map((item) => [item.flag, ...item.inputKeys]);
}

function permissionModeSchemaForCommand(command) {
  if (command && READ_ONLY_ROUTED_COMMANDS.has(command)) {
    return { type: "string", enum: [...READ_ONLY_PERMISSION_MODES] };
  }
  return { type: "string" };
}

export function routedInputSchemaProperties({ includeAliases = false, command = null, mcpOnly = false } = {}) {
  const controls = mcpOnly
    ? [...MCP_ROUTED_VALUE_CONTROLS, ...MCP_ROUTED_OPTIONAL_VALUE_CONTROLS, ...MCP_ROUTED_BOOLEAN_CONTROLS]
    : [...ROUTED_VALUE_CONTROLS, ...ROUTED_OPTIONAL_VALUE_CONTROLS, ...ROUTED_BOOLEAN_CONTROLS];
  const readOnly = Boolean(command && READ_ONLY_ROUTED_COMMANDS.has(command));
  const properties = {};
  for (const item of controls) {
    if (mcpOnly && item.mcpOmitReadOnly && readOnly) {
      continue;
    }
    const keys = includeAliases ? item.inputKeys : [item.inputKeys[0]];
    const schema = item.option === "permission-mode"
      ? permissionModeSchemaForCommand(command)
      : item.schema;
    for (const key of keys) {
      properties[key] = schema;
    }
  }
  return properties;
}
