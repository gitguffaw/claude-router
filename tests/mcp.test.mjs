import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, installFakeClaude, makeTempDir } from "./helpers.mjs";

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
