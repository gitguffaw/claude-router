import assert from "node:assert/strict";
import test from "node:test";
import { resolveClaudeControls } from "../scripts/lib/model-resolution.mjs";

test("model shorthands override an explicit --model in fixed precedence order", () => {
  assert.equal(resolveClaudeControls({ best: true }).model, "opus");
  assert.equal(resolveClaudeControls({ model: "claude-custom", sonnet: true }).model, "sonnet");
  assert.equal(resolveClaudeControls({ best: true, sonnet: true }).model, "sonnet");
  assert.equal(resolveClaudeControls({ sonnet: true, haiku: true }).model, "haiku");
  assert.equal(resolveClaudeControls({ opus: true, haiku: true }).model, "haiku");
  assert.equal(resolveClaudeControls({}).model, null);
});

test("long-context maps sonnet to sonnet[1m] and everything else to opus[1m]", () => {
  assert.equal(resolveClaudeControls({ sonnet: true, "long-context": true }).model, "sonnet[1m]");
  assert.equal(resolveClaudeControls({ haiku: true, "long-context": true }).model, "opus[1m]");
  assert.equal(resolveClaudeControls({ "long-context": true }).model, "opus[1m]");
});

test("timeout-ms accepts non-negative milliseconds and rejects everything else", () => {
  assert.equal(resolveClaudeControls({ "timeout-ms": "30000" }).timeoutMs, 30000);
  assert.equal(resolveClaudeControls({ "timeout-ms": 0 }).timeoutMs, 0);
  assert.equal(resolveClaudeControls({}).timeoutMs, null);
  assert.equal(resolveClaudeControls({ "timeout-ms": "" }).timeoutMs, null);
  assert.throws(() => resolveClaudeControls({ "timeout-ms": "abc" }), /Invalid timeout/);
  assert.throws(() => resolveClaudeControls({ "timeout-ms": "-5" }), /Invalid timeout/);
});

test("invalid --lean value fails with the accepted choices", () => {
  assert.throws(
    () => resolveClaudeControls({ lean: "subscription" }),
    /Use auto, oauth, or api/
  );
});

test("lean auto selects api when provider credentials are set", () => {
  for (const name of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) {
    const controls = resolveClaudeControls({ lean: true }, { env: { [name]: "1" } });
    assert.equal(controls.leanProfile.id, "api");
    assert.equal(controls.bare, true);
    assert.equal(controls.safeMode, false);
  }
});

test("lean auto detects OAuth from the auth method string without loggedIn", () => {
  const controls = resolveClaudeControls(
    { lean: true },
    { env: {}, auth: { loggedIn: false, authMethod: "OAuth token" } }
  );
  assert.equal(controls.leanProfile.id, "oauth");
  assert.equal(controls.safeMode, true);
  assert.equal(controls.bare, false);
});

test("lean auto fails with guidance when no authentication signal is present", () => {
  assert.throws(
    () => resolveClaudeControls({ lean: true }, { env: {}, auth: {} }),
    /could not determine the active Claude authentication path/
  );
});

test("lean profiles reject the opposite isolation flag", () => {
  assert.throws(
    () => resolveClaudeControls({ lean: "oauth", bare: true }),
    /--lean=oauth conflicts with --bare/
  );
  assert.throws(
    () => resolveClaudeControls({ lean: "api", "safe-mode": true }),
    /--lean=api conflicts with --safe-mode/
  );
});

test("lean requires the installed CLI to advertise the isolation flag", () => {
  assert.throws(
    () => resolveClaudeControls({ lean: "oauth" }, { availableFlags: new Set(["--bare"]) }),
    /does not advertise --safe-mode/
  );
  assert.throws(
    () => resolveClaudeControls({ lean: "api" }, { availableFlags: new Set(["--safe-mode"]) }),
    /does not advertise --bare/
  );
  // No surface snapshot means no advertisement check.
  const controls = resolveClaudeControls({ lean: "api" }, {});
  assert.equal(controls.bare, true);
});

test("lean profile metadata records whether defaults were applied", () => {
  const defaults = resolveClaudeControls({ lean: "api" }, { mode: "exec" });
  assert.equal(defaults.tools, "Bash,Read,Edit,Write");
  assert.equal(defaults.systemPrompt, "You are a concise expert coding assistant.");
  assert.equal(defaults.leanProfile.defaultToolsApplied, true);
  assert.equal(defaults.leanProfile.defaultSystemPromptApplied, true);

  const explicit = resolveClaudeControls(
    { lean: "api", tools: "Read", "system-prompt": "Terse." },
    { mode: "exec" }
  );
  assert.equal(explicit.tools, "Read");
  assert.equal(explicit.systemPrompt, "Terse.");
  assert.equal(explicit.leanProfile.defaultToolsApplied, false);
  assert.equal(explicit.leanProfile.defaultSystemPromptApplied, false);
});

test("explicit empty tools string disables built-in tools even under lean", () => {
  assert.equal(resolveClaudeControls({ tools: "" }).tools, "");
  assert.equal(resolveClaudeControls({ lean: "api", tools: "" }).tools, "");
  assert.deepEqual(resolveClaudeControls({}).tools, []);
});
