const STRING_SCHEMA = { type: "string" };
const BOOLEAN_SCHEMA = { type: "boolean" };
const STRING_OR_STRING_ARRAY_SCHEMA = { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] };
const BOOLEAN_OR_STRING_SCHEMA = { oneOf: [{ type: "boolean" }, { type: "string" }] };

function defaultInputKeys(option) {
  const snake = option.replaceAll("-", "_");
  return [...new Set([snake, option])];
}

function control({ flag, option = flag.slice(2), optionAliases = [], inputKeys, schema = STRING_SCHEMA, repeatable = false }) {
  return {
    flag,
    option,
    optionAliases,
    inputKeys: inputKeys ?? defaultInputKeys(option),
    schema,
    repeatable
  };
}

export const ROUTED_VALUE_CONTROLS = [
  control({ flag: "--base" }),
  control({ flag: "--timeout-ms", schema: { type: "number" } }),
  control({ flag: "--model" }),
  control({ flag: "--effort" }),
  control({ flag: "--permission-mode" }),
  control({ flag: "--plugin-dir", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--plugin-url", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--mcp-config", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--settings" }),
  control({ flag: "--setting-sources" }),
  control({ flag: "--add-dir", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--scope" }),
  control({ flag: "--agent" }),
  control({ flag: "--agents" }),
  control({ flag: "--allowed-tools", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
  control({ flag: "--disallowed-tools", schema: STRING_OR_STRING_ARRAY_SCHEMA, repeatable: true }),
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

export const ROUTED_OPTIONAL_VALUE_CONTROLS = [
  control({ flag: "--debug", schema: BOOLEAN_OR_STRING_SCHEMA }),
  control({ flag: "--resume", schema: BOOLEAN_OR_STRING_SCHEMA }),
  control({ flag: "--tmux", schema: BOOLEAN_OR_STRING_SCHEMA }),
  control({ flag: "--worktree", schema: BOOLEAN_OR_STRING_SCHEMA })
];

export const ROUTED_BOOLEAN_CONTROLS = [
  control({ flag: "--background", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--best", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--sonnet", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--opus", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--haiku", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--long-context", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--chrome", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--no-chrome", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--bare", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--ultrathink", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--strict-mcp-config", schema: BOOLEAN_SCHEMA }),
  control({
    flag: "--dangerously-skip-permissions",
    optionAliases: ["bypass-permissions"],
    inputKeys: ["dangerously_skip_permissions", "dangerously-skip-permissions", "bypass_permissions", "bypass-permissions"],
    schema: BOOLEAN_SCHEMA
  }),
  control({ flag: "--allow-dangerous", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--allow-dangerously-skip-permissions", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--search", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--web-search", optionAliases: ["webSearch"], inputKeys: ["web_search", "web-search", "webSearch"], schema: BOOLEAN_SCHEMA }),
  control({ flag: "--ax-screen-reader", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--brief", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--continue", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--disable-slash-commands", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--exclude-dynamic-system-prompt-sections", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--fork-session", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--ide", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--include-hook-events", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--include-partial-messages", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--no-session-persistence", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--replay-user-messages", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--safe-mode", schema: BOOLEAN_SCHEMA }),
  control({ flag: "--verbose", schema: BOOLEAN_SCHEMA })
];

export const ROUTED_VALUE_OPTIONS = ROUTED_VALUE_CONTROLS.map((item) => item.option);
export const ROUTED_OPTIONAL_VALUE_OPTIONS = ROUTED_OPTIONAL_VALUE_CONTROLS.map((item) => item.option);
export const ROUTED_BOOLEAN_OPTIONS = ROUTED_BOOLEAN_CONTROLS.flatMap((item) => [item.option, ...item.optionAliases]);
export const ROUTED_REPEATABLE_OPTIONS = ROUTED_VALUE_CONTROLS.filter((item) => item.repeatable).map((item) => item.option);

export function routedFlagEntries(controls) {
  return controls.map((item) => [item.flag, ...item.inputKeys]);
}

export function routedInputSchemaProperties({ includeAliases = false } = {}) {
  const properties = {};
  for (const item of [...ROUTED_VALUE_CONTROLS, ...ROUTED_OPTIONAL_VALUE_CONTROLS, ...ROUTED_BOOLEAN_CONTROLS]) {
    const keys = includeAliases ? item.inputKeys : [item.inputKeys[0]];
    for (const key of keys) {
      properties[key] = item.schema;
    }
  }
  return properties;
}
