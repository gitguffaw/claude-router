import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir } from "./helpers.mjs";
import { schemaFor, validateAgainstSchema, InvalidParamsError } from "../scripts/claude-router-mcp.mjs";
import { MCP_TOOLS } from "../scripts/lib/router-commands.mjs";
import { PERMISSION_MODES } from "../scripts/lib/model-catalog.mjs";
import { WRITE_CAPABLE_PERMISSION_MODES } from "../scripts/lib/routed-controls.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "scripts", "claude-router-mcp.mjs");
const PLUGIN = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));

function request(proc, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += String(chunk);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          proc.stdout.off("data", onData);
          try {
            resolve(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
          return;
        }
        newline = buffer.indexOf("\n");
      }
    };
    proc.stdout.on("data", onData);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test("mcp server lists tools with closed schemas and omits always-rejected controls", async () => {
  const bin = makeTempDir();
  installFakeClaude(bin);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    const init = await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(init.result.serverInfo.name, "claude-router");
    assert.equal(init.result.serverInfo.version, PLUGIN.version);
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const toolByName = new Map(list.result.tools.map((tool) => [tool.name, tool]));
    assert.deepEqual(list.result.tools.map((tool) => tool.name).sort(), [
      "claude_router_adversarial_review",
      "claude_router_analyze",
      "claude_router_cancel",
      "claude_router_exec",
      "claude_router_help",
      "claude_router_models",
      "claude_router_plan",
      "claude_router_raw",
      "claude_router_result",
      "claude_router_review",
      "claude_router_setup",
      "claude_router_status",
      "claude_router_surface",
      "claude_router_ultrareview",
      "claude_router_version"
    ].sort());
    const analyze = toolByName.get("claude_router_analyze");
    assert.equal(analyze.inputSchema.additionalProperties, false);
    assert.equal(analyze.inputSchema.properties.append_system_prompt.type, "string");
    assert.deepEqual(analyze.inputSchema.properties.betas, { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] });
    assert.equal(analyze.inputSchema.properties.allow_dangerous, undefined);
    assert.equal(analyze.inputSchema.properties.allow_dangerously_skip_permissions, undefined);
    assert.equal(analyze.inputSchema.properties.dangerously_skip_permissions, undefined);
    assert.equal(analyze.inputSchema.properties.web_search, undefined);
    assert.equal(analyze.inputSchema.properties.search, undefined);
    assert.equal(analyze.inputSchema.properties.base, undefined);
    assert.equal(analyze.inputSchema.properties.scope, undefined);
    assert.equal(analyze.inputSchema.properties.timeout, undefined);
    assert.equal(analyze.inputSchema.properties.timeout_ms.type, "number");
    assert.equal(analyze.inputSchema.properties.timeout_ms.minimum, 0);
    assert.deepEqual(analyze.inputSchema.properties.permission_mode.enum, ["plan"]);
    assert.deepEqual(analyze.inputSchema.required, ["prompt"]);

    const exec = toolByName.get("claude_router_exec");
    assert.equal(exec.inputSchema.additionalProperties, false);
    assert.equal(exec.inputSchema.properties.allow_dangerous.type, "boolean");
    assert.equal(exec.inputSchema.properties.allow_dangerously_skip_permissions.type, "boolean");
    assert.equal(exec.inputSchema.properties.dangerously_skip_permissions.type, "boolean");
    assert.ok(exec.inputSchema.properties.permission_mode.enum.includes("acceptEdits"));
    assert.ok(exec.inputSchema.properties.permission_mode.enum.includes("bypassPermissions"));
    assert.ok(exec.inputSchema.properties.permission_mode.enum.includes("auto"));

    const setup = toolByName.get("claude_router_setup");
    assert.equal(setup.inputSchema.additionalProperties, false);
    assert.equal(setup.inputSchema.properties.model, undefined);
    assert.equal(setup.inputSchema.properties.background, undefined);

    const raw = toolByName.get("claude_router_raw");
    assert.equal(raw.inputSchema.additionalProperties, false);
    assert.equal(raw.inputSchema.properties.args.type, "array");
    assert.equal(raw.inputSchema.properties.args.items.type, "string");
    assert.equal(raw.inputSchema.properties.timeout_ms.type, "number");
    assert.equal(raw.inputSchema.properties.timeout_ms.minimum, 0);
    assert.equal(raw.inputSchema.properties.model, undefined);
    assert.deepEqual(raw.inputSchema.required, ["args"]);

    const models = toolByName.get("claude_router_models");
    assert.equal(models.inputSchema.additionalProperties, false);
    assert.deepEqual(models.inputSchema.properties.capability.enum, ["long_context", "ultrathink", "chrome"]);

    const status = toolByName.get("claude_router_status");
    assert.equal(status.inputSchema.additionalProperties, false);
    assert.equal(status.inputSchema.properties.timeout_ms.type, "number");
    assert.equal(status.inputSchema.properties.timeout_ms.minimum, 0);
    assert.equal(status.inputSchema.properties.poll_interval_ms.type, "number");
    assert.equal(status.inputSchema.properties.poll_interval_ms.minimum, 0);
    assert.equal(status.inputSchema.properties.model, undefined);

    const cancel = toolByName.get("claude_router_cancel");
    assert.deepEqual(cancel.inputSchema.required, ["job_id"]);
    const result = toolByName.get("claude_router_result");
    assert.equal(result.inputSchema.required?.includes("job_id") ?? false, false);
  } finally {
    proc.kill("SIGTERM");
  }
});

test("validateAgainstSchema rejects unknown timeout and wrong types before dispatch", () => {
  const analyze = MCP_TOOLS.find((tool) => tool.command === "analyze");
  const schema = schemaFor(analyze);
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", timeout: 30 }),
    (error) => error instanceof InvalidParamsError && /Unknown property "timeout"/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", timeout_ms: "30" }),
    (error) => error instanceof InvalidParamsError && /timeout_ms must be a finite number/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", timeout_ms: -1 }),
    (error) => error instanceof InvalidParamsError && /timeout_ms must be >= 0/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", timeout_ms: Number.NaN }),
    (error) => error instanceof InvalidParamsError && /timeout_ms must be a finite number/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { timeout_ms: 1 }),
    (error) => error instanceof InvalidParamsError && /Missing required property "prompt"/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", permission_mode: "acceptEdits" }),
    (error) => error instanceof InvalidParamsError && /permission_mode must be one of/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schema, { prompt: "x", unknown_flag: true }),
    (error) => error instanceof InvalidParamsError && /Unknown property "unknown_flag"/.test(error.message)
  );
  for (const key of ["allow_dangerous", "allow_dangerously_skip_permissions", "dangerously_skip_permissions"]) {
    assert.throws(
      () => validateAgainstSchema(schema, { prompt: "x", [key]: true }),
      (error) => error instanceof InvalidParamsError && new RegExp(`Unknown property "${key}"`).test(error.message)
    );
  }

  const raw = MCP_TOOLS.find((tool) => tool.command === "raw");
  assert.throws(
    () => validateAgainstSchema(schemaFor(raw), { args: ["ok", 1] }),
    (error) => error instanceof InvalidParamsError && /args\[1\] must be a string/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schemaFor(raw), {}),
    (error) => error instanceof InvalidParamsError && /Missing required property "args"/.test(error.message)
  );
  assert.throws(
    () => validateAgainstSchema(schemaFor(raw), { args: [], timeout_ms: -5 }),
    (error) => error instanceof InvalidParamsError && /timeout_ms must be >= 0/.test(error.message)
  );

  const models = MCP_TOOLS.find((tool) => tool.command === "models");
  assert.throws(
    () => validateAgainstSchema(schemaFor(models), { capability: "nope" }),
    (error) => error instanceof InvalidParamsError && /capability must be one of/.test(error.message)
  );

  const cancel = MCP_TOOLS.find((tool) => tool.command === "cancel");
  assert.throws(
    () => validateAgainstSchema(schemaFor(cancel), { cwd: "/tmp" }),
    (error) => error instanceof InvalidParamsError && /Missing required property "job_id"/.test(error.message)
  );

  const exec = MCP_TOOLS.find((tool) => tool.command === "exec");
  const execSchema = schemaFor(exec);
  assert.deepEqual(
    execSchema.properties.permission_mode.enum,
    PERMISSION_MODES.map((mode) => mode.flag_value)
  );
  assert.deepEqual(WRITE_CAPABLE_PERMISSION_MODES, PERMISSION_MODES.map((mode) => mode.flag_value));
  validateAgainstSchema(execSchema, { prompt: "x", permission_mode: "auto" });
});

test("mcp server returns invalid-params without launching companion for contract violations", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    for (const [id, params, pattern] of [
      [2, { name: "claude_router_analyze", arguments: { cwd: repo, prompt: "x", timeout: 30 } }, /Unknown property "timeout"/],
      [3, { name: "claude_router_analyze", arguments: { cwd: repo, prompt: "x", typo_model: "opus" } }, /Unknown property/],
      [4, { name: "claude_router_analyze", arguments: { cwd: repo, timeout_ms: 1 } }, /Missing required property "prompt"/],
      [5, { name: "claude_router_analyze", arguments: { cwd: repo, prompt: "x", permission_mode: "acceptEdits" } }, /permission_mode must be one of/],
      [6, { name: "claude_router_raw", arguments: { cwd: repo, args: ["mcp", 1] } }, /args\[1\] must be a string/],
      [7, { name: "claude_router_models", arguments: { capability: "nope" } }, /capability must be one of/],
      [8, { name: "claude_router_review", arguments: { cwd: repo, scope: "src", prompt: "review target" } }, /Unknown property "scope"/],
      [9, { name: "claude_router_analyze", arguments: { cwd: repo, prompt: "x", allow_dangerous: true } }, /Unknown property "allow_dangerous"/],
      [10, { name: "claude_router_analyze", arguments: { cwd: repo, prompt: "x", timeout_ms: -1 } }, /timeout_ms must be >= 0/],
      [11, { name: "claude_router_cancel", arguments: { cwd: repo } }, /Missing required property "job_id"/],
      [12, { name: "claude_router_status", arguments: { cwd: repo, poll_interval_ms: -1 } }, /poll_interval_ms must be >= 0/]
    ]) {
      const blocked = await request(proc, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params
      });
      assert.equal(blocked.error?.code, -32602, JSON.stringify(blocked));
      assert.match(blocked.error.message, pattern);
    }
  } finally {
    proc.kill("SIGTERM");
  }
});

test("mcp routed tools preserve explicit empty tools string", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const result = await request(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "claude_router_analyze",
        arguments: { cwd: repo, prompt: "inspect empty tools", tools: "" }
      }
    });
    assert.equal(result.error, undefined, JSON.stringify(result.error ?? {}));
    const payload = JSON.parse(result.result.content[0].text);
    const args = payload.result.args;
    const index = args.indexOf("--tools");
    assert.notEqual(index, -1, `missing --tools in ${JSON.stringify(args)}`);
    assert.equal(args[index + 1], "");
  } finally {
    proc.kill("SIGTERM");
  }
});

test("mcp prompt argument boundary treats dash-leading prompts as data", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    for (const [id, prompt] of [
      [2, "--debug"],
      [3, "--permission-mode acceptEdits"],
      [4, "--tools Bash"]
    ]) {
      const result = await request(proc, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "claude_router_analyze",
          arguments: { cwd: repo, prompt }
        }
      });
      assert.equal(result.error, undefined, JSON.stringify(result.error ?? {}));
      const payload = JSON.parse(result.result.content[0].text);
      // Exact flag-like prompt is stored as userRequest data.
      assert.equal(payload.request.userRequest, prompt);
      assert.equal(payload.request.permissionMode, "plan");
      // Not interpreted as router controls.
      assert.equal(payload.request.controls.debug, null);
      assert.equal(payload.request.controls.tools.length === 0 || payload.request.controls.tools === "", true);
      const claudeArgs = payload.result.args;
      assert.equal(claudeArgs.at(-1), payload.request.prompt);
      assert.match(payload.request.prompt, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const structured = await request(proc, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "claude_router_analyze",
        arguments: {
          cwd: repo,
          prompt: "--looks-like-flag but is prompt",
          permission_mode: "plan",
          model: "sonnet"
        }
      }
    });
    assert.equal(structured.error, undefined, JSON.stringify(structured.error ?? {}));
    const structuredPayload = JSON.parse(structured.result.content[0].text);
    assert.equal(structuredPayload.request.userRequest, "--looks-like-flag but is prompt");
    assert.equal(structuredPayload.request.permissionMode, "plan");
    assert.equal(structuredPayload.request.controls.model, "sonnet");
    const structuredArgs = structuredPayload.result.args;
    assert.ok(structuredArgs.includes("--model"));
    assert.ok(structuredArgs.includes("sonnet"));
    assert.equal(structuredArgs.at(-1), structuredPayload.request.prompt);
    assert.match(structuredPayload.request.prompt, /--looks-like-flag but is prompt/);
  } finally {
    proc.kill("SIGTERM");
  }
});

test("mcp raw tool preserves guardrails through global Claude flags", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const blocked = await request(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "claude_router_raw",
        arguments: { cwd: repo, args: ["--model", "opus", "mcp", "add", "example", "node"] }
      }
    });
    assert.match(blocked.error.message, /may mutate/);
    assert.notEqual(blocked.error.code, -32602);
  } finally {
    proc.kill("SIGTERM");
  }
});

test("mcp valid analyze call still succeeds with closed schema", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const result = await request(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "claude_router_analyze",
        arguments: {
          cwd: repo,
          prompt: "normal prompt",
          permission_mode: "plan",
          timeout_ms: 120000
        }
      }
    });
    assert.equal(result.error, undefined, JSON.stringify(result.error ?? {}));
    const payload = JSON.parse(result.result.content[0].text);
    assert.equal(payload.request.userRequest, "normal prompt");
    assert.equal(payload.request.permissionMode, "plan");
  } finally {
    proc.kill("SIGTERM");
  }
});

test("mcp exec accepts auto permission_mode from shared catalog", async () => {
  const bin = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const execTool = list.result.tools.find((tool) => tool.name === "claude_router_exec");
    assert.deepEqual(
      execTool.inputSchema.properties.permission_mode.enum,
      PERMISSION_MODES.map((mode) => mode.flag_value)
    );
    assert.ok(execTool.inputSchema.properties.permission_mode.enum.includes("auto"));

    const result = await request(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "claude_router_exec",
        arguments: {
          cwd: repo,
          prompt: "implement with auto mode",
          permission_mode: "auto"
        }
      }
    });
    assert.equal(result.error, undefined, JSON.stringify(result.error ?? {}));
    const payload = JSON.parse(result.result.content[0].text);
    assert.equal(payload.request.permissionMode, "auto");
    assert.equal(payload.request.write, true);
  } finally {
    proc.kill("SIGTERM");
  }
});
