import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claude-router-test-"));
}

export function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout
  });
}

export function initGitRepo(dir) {
  run("git", ["init"], { cwd: dir });
  run("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  run("git", ["config", "user.name", "Test User"], { cwd: dir });
}

export function installFakeClaude(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "claude");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2.1.185 (Claude Code)");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Usage: claude [options] [command] [prompt]\\nOptions:\\n  --model <model>  Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5').\\nCommands:\\n  mcp\\n  plugin\\n  agents");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }));
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "list") {
  console.log("Installed plugins:\\n  claude-router enabled");
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "list") {
  console.log("claude-router: connected");
  process.exit(0);
}
if (args[0] === "ultrareview") {
  console.log(JSON.stringify({ verdict: "pass", findings: [] }));
  process.exit(0);
}
if (args.includes("-p")) {
  const prompt = args[args.length - 1] || "";
  if (prompt.includes("SLEEP")) {
    if (process.env.FAKE_CLAUDE_PID_FILE) {
      fs.writeFileSync(process.env.FAKE_CLAUDE_PID_FILE, String(process.pid));
    }
    setTimeout(() => {
      console.log(JSON.stringify({ result: "Slept", session_id: "00000000-0000-4000-8000-000000000000" }));
    }, 5000);
    return;
  }
  if (prompt.includes("CHANGE_FILE")) {
    fs.writeFileSync("changed-by-claude.txt", "changed\\n");
  }
  console.log(JSON.stringify({ result: "Handled: " + prompt.slice(0, 40), session_id: "00000000-0000-4000-8000-000000000000" }));
  process.exit(0);
}
console.log("fake claude");
`, "utf8");
  fs.chmodSync(fake, 0o755);
  return fake;
}

export function buildEnv(binDir, dataDir = makeTempDir()) {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    CLAUDE_ROUTER_DATA: dataDir
  };
}
