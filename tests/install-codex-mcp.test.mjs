import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "scripts", "install-codex-mcp.mjs");

test("install-codex-mcp dry-run records absolute node and server paths", () => {
  const result = run(process.execPath, [INSTALLER, "--dry-run", "--json"], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.name, "claude-router");
  assert.equal(payload.node, process.execPath);
  assert.equal(path.isAbsolute(payload.node), true);
  assert.equal(path.isAbsolute(payload.server), true);
  assert.deepEqual(payload.command, ["codex", "mcp", "add", "claude-router", "--", process.execPath, payload.server]);
});

test("install-codex-mcp registers through codex mcp add and verifies with get", () => {
  const dir = makeTempDir();
  const log = path.join(dir, "codex-argv.jsonl");
  const fakeCodex = path.join(dir, "codex");

  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "mcp" && args[1] === "add") {
  console.log("Added global MCP server '" + args[2] + "'.");
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "get") {
  console.log(args[2]);
  console.log("  command: " + ${JSON.stringify(process.execPath)});
  process.exit(0);
}
process.exit(2);
`, "utf8");
  fs.chmodSync(fakeCodex, 0o755);

  const result = run(process.execPath, [INSTALLER, "--codex", fakeCodex, "--name", "claude-router-test", "--json"], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "claude-router-test");
  assert.equal(payload.add.status, 0);
  assert.equal(payload.get.status, 0);
  assert.equal(payload.serverCheck.ok, true);
  assert.equal(payload.serverCheck.tools.includes("claude_router_setup"), true);
  assert.equal(payload.serverCheck.toolCount > 0, true);

  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(calls[0], ["mcp", "add", "claude-router-test", "--", process.execPath, payload.server]);
  assert.deepEqual(calls[1], ["mcp", "get", "claude-router-test"]);
});
