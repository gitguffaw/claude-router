import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLiveControlArgs,
  assertLiveControlSafety,
  discoverClaudeControls,
  dynamicRoutedControls,
  liveControlParseConfig,
  nativeArgsFromParsedOptions,
  schemaForLiveControl
} from "../scripts/lib/live-controls.mjs";

const HELP_TEXT = `Usage: claude [options] [command] [prompt]

Options:
  -d                              Enable debug logging
  -p, --print                     Print response and exit
  --json                          Emit JSON output
  --output-format <format>        Output format (text, json, stream-json)
  --permission-mode <mode>        Permission mode (choices: "acceptEdits", "bypassPermissions", "plan", "default")
  --allowedTools, --allowed-tools <tools...>  Tool names to allow
  --resume [sessionId]            Resume the named session
  --api-key <key>                 Anthropic API key override
  --dangerously-skip-permissions  Bypass all permission checks
`;

const CONTROLS = discoverClaudeControls(HELP_TEXT);

function control(option) {
  const found = CONTROLS.find((candidate) => candidate.option === option);
  assert.ok(found, `expected discovered control for --${option}`);
  return found;
}

test("discoverClaudeControls keeps long flags only and classifies their kinds", () => {
  assert.deepEqual(
    CONTROLS.map((item) => item.option),
    ["print", "json", "output-format", "permission-mode", "allowed-tools", "resume", "api-key", "dangerously-skip-permissions"]
  );
  assert.equal(control("print").kind, "boolean");
  assert.equal(control("api-key").kind, "value");
  assert.equal(control("resume").kind, "optional-value");
  assert.equal(control("resume").valueHint, "sessionId");
  assert.equal(control("allowed-tools").repeatable, true);
  assert.equal(control("api-key").repeatable, false);
  assert.ok(CONTROLS.every((item) => item.source === "claude-help"));
});

test("discoverClaudeControls prefers the kebab-case long name and keeps the camelCase form as alias", () => {
  const allowedTools = control("allowed-tools");
  assert.equal(allowedTools.flag, "--allowed-tools");
  assert.deepEqual(allowedTools.optionAliases, ["allowedTools"]);
  assert.deepEqual(allowedTools.inputKeys, ["allowed_tools", "allowed-tools", "allowedTools"]);
  assert.deepEqual(control("permission-mode").inputKeys, ["permission_mode", "permission-mode"]);
});

test("discoverClaudeControls extracts choices from explicit lists and known value hints", () => {
  assert.deepEqual(control("permission-mode").choices, ["acceptEdits", "bypassPermissions", "plan", "default"]);
  assert.deepEqual(control("output-format").choices, ["text", "json", "stream-json"]);
  assert.deepEqual(control("resume").choices, []);
});

test("discoverClaudeControls marks sensitive and dangerous flags by name", () => {
  assert.equal(control("api-key").sensitive, true);
  assert.equal(control("api-key").dangerous, false);
  assert.equal(control("dangerously-skip-permissions").dangerous, true);
  assert.equal(control("dangerously-skip-permissions").sensitive, false);
});

test("dynamicRoutedControls drops router-reserved options always and managed natives unless requested", () => {
  const routed = dynamicRoutedControls(HELP_TEXT);
  assert.deepEqual(
    routed.map((item) => item.option),
    ["allowed-tools", "resume", "api-key", "dangerously-skip-permissions"]
  );
  const withManaged = dynamicRoutedControls(HELP_TEXT, { includeManaged: true });
  assert.deepEqual(
    withManaged.map((item) => item.option),
    ["print", "output-format", "permission-mode", "allowed-tools", "resume", "api-key", "dangerously-skip-permissions"]
  );
});

test("schemaForLiveControl shapes JSON schema by control kind", () => {
  assert.deepEqual(schemaForLiveControl(control("dangerously-skip-permissions")), {
    type: "boolean",
    description: "Bypass all permission checks"
  });
  assert.deepEqual(schemaForLiveControl(control("resume")), {
    oneOf: [{ type: "boolean" }, { type: "string" }],
    description: "Resume the named session"
  });
  assert.deepEqual(schemaForLiveControl(control("allowed-tools")), {
    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    description: "Tool names to allow"
  });
  const permissionMode = schemaForLiveControl(control("permission-mode"));
  assert.equal(permissionMode.type, "string");
  assert.match(permissionMode.description, /Current installed-CLI choices: acceptEdits, bypassPermissions, plan, default\./);
});

test("appendLiveControlArgs serializes values by kind and matches any advertised input key", () => {
  const args = [];
  appendLiveControlArgs(args, {
    print: true,
    allowedTools: ["Bash", "Read"],
    resume: true,
    api_key: "sk-test"
  }, CONTROLS);
  assert.deepEqual(args, ["--print", "--allowed-tools", "Bash", "--allowed-tools", "Read", "--resume", "--api-key", "sk-test"]);
});

test("appendLiveControlArgs skips null, false, and non-true boolean values", () => {
  const args = [];
  appendLiveControlArgs(args, {
    print: "yes",
    json: false,
    api_key: null,
    "allowed-tools": undefined,
    "dangerously-skip-permissions": false
  }, CONTROLS);
  assert.deepEqual(args, []);
});

test("appendLiveControlArgs passes an explicit optional-value string through to the flag", () => {
  const args = [];
  appendLiveControlArgs(args, { resume: "session-123" }, CONTROLS);
  assert.deepEqual(args, ["--resume", "session-123"]);
});

test("liveControlParseConfig buckets options by kind and maps camelCase aliases", () => {
  const config = liveControlParseConfig(CONTROLS);
  assert.deepEqual(config.valueOptions, ["output-format", "permission-mode", "allowed-tools", "api-key"]);
  assert.deepEqual(config.optionalValueOptions, ["resume"]);
  assert.deepEqual(config.booleanOptions, ["print", "json", "dangerously-skip-permissions"]);
  assert.deepEqual(config.repeatableOptions, ["allowed-tools"]);
  assert.deepEqual(config.aliasMap, { allowedTools: "allowed-tools" });
});

test("nativeArgsFromParsedOptions emits args in discovered-control order", () => {
  const args = nativeArgsFromParsedOptions({ "api-key": "sk-test", print: true }, CONTROLS);
  assert.deepEqual(args, ["--print", "--api-key", "sk-test"]);
});

test("assertLiveControlSafety blocks dangerous flags unless --allow-dangerous accompanies them", () => {
  assert.throws(
    () => assertLiveControlSafety({ "dangerously-skip-permissions": true }, CONTROLS),
    /--allow-dangerous/
  );
  assert.throws(
    () => assertLiveControlSafety({ dangerously_skip_permissions: true }, CONTROLS),
    /--allow-dangerous/
  );
  assert.doesNotThrow(() => assertLiveControlSafety({ "dangerously-skip-permissions": true, "allow-dangerous": true }, CONTROLS));
  assert.doesNotThrow(() => assertLiveControlSafety({ print: true }, CONTROLS));
});

test("assertLiveControlSafety treats a bypassPermissions value on a dangerous control as a bypass request", () => {
  const bypassControl = discoverClaudeControls(`Options:\n  --bypass-mode <mode>  Bypass posture\n`);
  assert.throws(
    () => assertLiveControlSafety({ "bypass-mode": "bypassPermissions" }, bypassControl),
    /--allow-dangerous/
  );
  assert.doesNotThrow(() => assertLiveControlSafety({ "bypass-mode": "plan" }, bypassControl));
});
