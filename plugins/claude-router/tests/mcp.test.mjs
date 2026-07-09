import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir } from "./helpers.mjs";

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

test("mcp server lists tools", async () => {
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
    assert.equal(analyze.inputSchema.properties.append_system_prompt.type, "string");
    assert.deepEqual(analyze.inputSchema.properties.betas, { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] });
    assert.equal(analyze.inputSchema.properties.allow_dangerously_skip_permissions.type, "boolean");
    assert.equal(analyze.inputSchema.properties.web_search.type, "boolean");
    assert.equal(analyze.inputSchema.properties.timeout, undefined);
    assert.equal(analyze.inputSchema.properties.timeout_ms.type, "number");

    const setup = toolByName.get("claude_router_setup");
    assert.equal(setup.inputSchema.properties.model, undefined);
    assert.equal(setup.inputSchema.properties.background, undefined);

    const raw = toolByName.get("claude_router_raw");
    assert.equal(raw.inputSchema.properties.args.type, "array");
    assert.equal(raw.inputSchema.properties.timeout_ms.type, "number");
    assert.equal(raw.inputSchema.properties.model, undefined);

    const status = toolByName.get("claude_router_status");
    assert.equal(status.inputSchema.properties.timeout_ms.type, "number");
    assert.equal(status.inputSchema.properties.poll_interval_ms.type, "number");
    assert.equal(status.inputSchema.properties.model, undefined);
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

    const scopedReview = await request(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "claude_router_review",
        arguments: { cwd: repo, scope: "src", prompt: "review target" }
      }
    });
    assert.match(scopedReview.error.message, /does not yet support --base or --scope/);
  } finally {
    proc.kill("SIGTERM");
  }
});
