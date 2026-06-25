import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "scripts", "claude-router-mcp.mjs");

function request(proc, message) {
  return new Promise((resolve) => {
    const onData = (chunk) => {
      const line = String(chunk).trim().split(/\r?\n/).find(Boolean);
      if (!line) {
        return;
      }
      proc.stdout.off("data", onData);
      resolve(JSON.parse(line));
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
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.ok(list.result.tools.some((tool) => tool.name === "claude_router_setup"));
    assert.ok(list.result.tools.some((tool) => tool.name === "claude_router_surface"));
    assert.ok(list.result.tools.some((tool) => tool.name === "claude_router_help"));
    assert.ok(list.result.tools.some((tool) => tool.name === "claude_router_raw"));
  } finally {
    proc.kill("SIGTERM");
  }
});

test("plugin result tool forwards wait controls", async () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  const repo = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin, data), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const started = await request(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "claude_router_analyze",
        arguments: {
          cwd: repo,
          background: true,
          prompt: "SLEEP_FAST"
        }
      }
    });
    const startPayload = JSON.parse(started.result.content[0].text);
    assert.equal(startPayload.status, "running");
    const result = await request(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "claude_router_result",
        arguments: {
          cwd: repo,
          job_id: startPayload.id,
          wait: true,
          timeout_ms: 5000
        }
      }
    });
    const resultPayload = JSON.parse(result.result.content[0].text);
    assert.equal(resultPayload.status, "completed");
    assert.equal(resultPayload.waitTimedOut, false);
    assert.equal(resultPayload.result?.parsedOutput?.result, "Slept");
  } finally {
    proc.kill("SIGTERM");
  }
});
