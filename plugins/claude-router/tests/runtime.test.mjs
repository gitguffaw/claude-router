import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir, run } from "./helpers.mjs";
import { listJobs, readJobFile, upsertJob, writeJobFile } from "../scripts/lib/state.mjs";
import { handleCancel } from "../scripts/lib/job-commands.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-companion.mjs");
const PLUGIN = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      return true;
    }
    sleep(25);
  }
  return fs.existsSync(file);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForProcessExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) {
      return true;
    }
    sleep(25);
  }
  return !processAlive(pid);
}

function installFakeClaudeWithoutRouter(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "claude");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2.1.185 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }));
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "list") {
  console.log("Installed plugins:\\n  other-plugin enabled");
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "list") {
  console.log("other-server: connected");
  process.exit(0);
}
console.log("fake claude");
`, "utf8");
  fs.chmodSync(fake, 0o755);
  return fake;
}

function installArgEchoFakeClaude(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "claude");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
console.log(JSON.stringify({ args }));
`, "utf8");
  fs.chmodSync(fake, 0o755);
  return fake;
}

test("setup reports ready with fake claude", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.match(payload.claude.detail, /2.1.185/);
});

test("setup reports not ready when Claude Router plugin or MCP registration is missing", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaudeWithoutRouter(bin);
  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.coreReady, true);
  assert.equal(payload.ready, false);
  assert.equal(payload.plugins.ok, false);
  assert.equal(payload.mcp.ok, false);
  assert.match(payload.nextSteps.join("\n"), /Claude Router Claude Code plugin/);
});

test("surface reports local claude help", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "surface", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.router.version, PLUGIN.version);
  assert.match(payload.version.stdout, /2.1.185/);
  assert.match(payload.help.stdout, /Usage: claude/);
});

test("version reports both Claude Router and Claude CLI versions", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "version", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.router.version, PLUGIN.version);
  assert.match(payload.claude.stdout, /2.1.185/);
});

test("top-level help reports Claude Router commands", () => {
  const result = run("node", [SCRIPT, "--help"], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Claude Router/);
  assert.match(result.stdout, /models\s+Show model selectors/);
  assert.match(result.stdout, /cli\s+Alias for raw Claude CLI args/);
  assert.match(result.stdout, /version\s+Show Claude Router/);
});

test("help reports subcommand help as json", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "help", "--json", "--", "mcp", "add"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.stdout, /Usage: claude/);
});

test("models command includes live Fable selector from Claude help", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "models", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.discovery.status, "available");
  const fable = payload.models.find((model) => model.selector === "fable");
  assert.ok(fable, "fable selector missing");
  assert.equal(fable.full_name, "claude-fable-5");
});

test("raw claude command can read help and blocks mutating commands by default", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const help = run("node", [SCRIPT, "raw", "--json", "--", "mcp", "add", "--help"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(help.status, 0, help.stderr);
  assert.match(JSON.parse(help.stdout).stdout, /Usage: claude/);

  const blocked = run("node", [SCRIPT, "raw", "--json", "--", "mcp", "add", "example", "node"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /may mutate/);

  const blockedAlias = run("node", [SCRIPT, "raw", "--json", "--", "plugins", "install", "example"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.notEqual(blockedAlias.status, 0);
  assert.match(blockedAlias.stderr, /may mutate/);

  const blockedMcpLogin = run("node", [SCRIPT, "raw", "--json", "--", "mcp", "login", "example"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.notEqual(blockedMcpLogin.status, 0);
  assert.match(blockedMcpLogin.stderr, /may mutate/);
});

test("raw guardrails classify command paths after global flags and do not trust literal help args", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["raw", "--json", "--", "--model", "opus", "mcp", "add", "example", "node"],
    ["raw", "--json", "--", "--permission-mode", "plan", "mcp", "remove", "example"],
    ["raw", "--json", "--", "mcp", "add", "help", "node"],
    ["raw", "--json", "--", "plugin", "install", "help"],
    ["raw", "--json", "--", "project", "purge", "--dry-run=false"],
    ["raw", "--json", "--", "mcp", "add", "example", "node", "--help=false"]
  ]) {
    const blocked = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.notEqual(blocked.status, 0, `${args.join(" ")} should fail`);
    assert.match(blocked.stderr, /may mutate/);
  }
});

test("raw guardrails do not let Claude boolean prefixes hide mutating mcp commands", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["raw", "--json", "--", "--exclude-dynamic-system-prompt-sections", "mcp", "remove", "example"],
    ["raw", "--json", "--", "--tmux", "mcp", "remove", "example"],
    ["raw", "--json", "--", "--tmux=classic", "mcp", "remove", "example"]
  ]) {
    const blocked = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.notEqual(blocked.status, 0, `${args.join(" ")} should fail`);
    assert.match(blocked.stderr, /may mutate/);
  }
});

test("raw guardrails do not let Claude boolean prefixes hide dangerous permission-mode", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["raw", "--json", "--", "--exclude-dynamic-system-prompt-sections", "--permission-mode", "bypassPermissions", "mcp", "list"],
    ["raw", "--json", "--", "--tmux", "--permission-mode", "bypassPermissions", "mcp", "list"],
    ["raw", "--json", "--", "--tmux=classic", "--permission-mode", "bypassPermissions", "mcp", "list"]
  ]) {
    const blocked = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.notEqual(blocked.status, 0, `${args.join(" ")} should fail`);
    assert.match(blocked.stderr, /dangerous permission bypass/i);
  }

  const allowed = run("node", [
    SCRIPT,
    "raw",
    "--json",
    "--allow-dangerous",
    "--",
    "--exclude-dynamic-system-prompt-sections",
    "--permission-mode",
    "bypassPermissions",
    "mcp",
    "list"
  ], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(allowed.status, 0, allowed.stderr);
  const allowedPayload = JSON.parse(allowed.stdout);
  assert.equal(allowedPayload.classification.dangerous, true);
  assert.deepEqual(allowedPayload.classification.commandPath, ["mcp", "list"]);
});

test("raw read-only invocations still work with Claude boolean prefixes", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["raw", "--json", "--", "mcp", "list"],
    ["raw", "--json", "--", "--exclude-dynamic-system-prompt-sections", "mcp", "list"],
    ["raw", "--json", "--", "--tmux", "mcp", "list"],
    ["raw", "--json", "--", "--tmux=classic", "mcp", "list"],
    ["raw", "--json", "--", "mcp", "add", "--help"]
  ]) {
    const result = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.equal(result.status, 0, `${args.join(" ")} should succeed: ${result.stderr}`);
  }
});

test("raw passthrough preserves routed optional and repeatable-looking flags before --", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installArgEchoFakeClaude(bin);
  const result = run("node", [
    SCRIPT,
    "raw",
    "--json",
    "--resume",
    "session-1",
    "--allowed-tools",
    "Read",
    "--",
    "-p",
    "inspect"
  ], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(payload.stdout).args, ["--resume", "session-1", "--allowed-tools", "Read", "-p", "inspect"]);
});

test("routed commands reject dangerous permission bypass spellings without router override", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["analyze", "--json", "--permission-mode", "bypassPermissions", "dangerous"],
    ["exec", "--json", "--bypass-permissions", "dangerous"],
    ["exec", "--json", "--allow-dangerously-skip-permissions", "dangerous"]
  ]) {
    const blocked = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.notEqual(blocked.status, 0, `${args.join(" ")} should fail`);
    assert.match(blocked.stderr, /Dangerous permission bypass|read-only and requires --permission-mode plan/);
  }

  // allow-dangerous cannot override a read-only route boundary.
  const blockedReadOnly = run("node", [
    SCRIPT,
    "analyze",
    "--json",
    "--allow-dangerous",
    "--permission-mode",
    "bypassPermissions",
    "accepted risk"
  ], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.notEqual(blockedReadOnly.status, 0);
  assert.match(blockedReadOnly.stderr, /read-only and requires --permission-mode plan/);

  const planOk = run("node", [SCRIPT, "analyze", "--json", "--permission-mode", "plan", "safe read"], {
    cwd: ROOT,
    env: buildEnv(bin, data)
  });
  assert.equal(planOk.status, 0, planOk.stderr);
  assert.equal(JSON.parse(planOk.stdout).request.permissionMode, "plan");

  const execAllowed = run("node", [
    SCRIPT,
    "exec",
    "--json",
    "--allow-dangerous",
    "--permission-mode",
    "bypassPermissions",
    "accepted risk"
  ], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(execAllowed.status, 0, execAllowed.stderr);
  assert.equal(JSON.parse(execAllowed.stdout).request.permissionMode, "bypassPermissions");
});

test("routed CLI preserves explicit empty --tools value", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const result = run("node", [SCRIPT, "analyze", "--json", "--tools", "", "inspect tools"], {
    cwd: repo,
    env: buildEnv(bin, data)
  });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(result.stdout).result.args;
  const index = args.indexOf("--tools");
  assert.notEqual(index, -1);
  assert.equal(args[index + 1], "");
});

test("routed commands reject CLI-level unsupported review and web search flags", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  for (const args of [
    ["review", "--json", "--scope", "src", "review target"],
    ["adversarial-review", "--json", "--scope", "src", "review target"],
    ["analyze", "--json", "--base", "main", "inspect target"],
    ["exec", "--json", "--timeout", "30", "change target"],
    ["analyze", "--json", "--webSearch", "find docs"],
    ["analyze", "--json", "--web-search", "find docs"]
  ]) {
    const blocked = run("node", [SCRIPT, ...args], { cwd: ROOT, env: buildEnv(bin, data) });
    assert.notEqual(blocked.status, 0, `${args.join(" ")} should fail`);
  }
});

test("routed parser preserves repeatable values, inline equals, and bare optional flags", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const result = run("node", [
    SCRIPT,
    "analyze",
    "--json",
    "--debug",
    "--append-system-prompt=A=B",
    "--allowed-tools",
    "Read",
    "--allowed-tools",
    "Bash(git *)",
    "inspect parser"
  ], { cwd: repo, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const args = payload.result.args;
  assert.deepEqual(args.slice(args.indexOf("--debug"), args.indexOf("--debug") + 1), ["--debug"]);
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "A=B");
  assert.equal(args.filter((arg) => arg === "--allowedTools").length, 2);
  assert.ok(args.includes("Read"));
  assert.ok(args.includes("Bash(git *)"));
  assert.match(payload.request.userRequest, /inspect parser/);
});

test("analyze stores completed job and context pack", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  const result = run("node", [SCRIPT, "analyze", "--json", "inspect cache"], { cwd: repo, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.mode, "analyze");
  assert.match(payload.contextPack.id, /^ctx-/);
  assert.match(payload.rendered, /Handled:/);
});

test("read-only route warns when fake claude changes files", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  const result = run("node", [SCRIPT, "analyze", "--json", "CHANGE_FILE"], { cwd: repo, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed-with-warnings");
  assert.match(payload.warnings.join("\n"), /Read-only/);
});

test("managed routed jobs fail when the Claude process times out", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const result = run("node", [SCRIPT, "analyze", "--json", "--timeout-ms", "250", "SLEEP"], { cwd: repo, env: buildEnv(bin, data), timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "failed");
  assert.equal(payload.result.timedOut, true);
  assert.match(payload.warnings.join("\n"), /timed out/);
});


test("status and result return stored jobs", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  run("node", [SCRIPT, "plan", "--json", "plan migration"], { cwd: repo, env: buildEnv(bin, data) });
  const status = run("node", [SCRIPT, "status", "--json"], { cwd: repo, env: buildEnv(bin, data) });
  assert.equal(status.status, 0, status.stderr);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.jobs.length, 1);
  const result = run("node", [SCRIPT, "result", "--json", statusPayload.jobs[0].id], { cwd: repo, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const resultPayload = JSON.parse(result.stdout);
  assert.equal(resultPayload.status, "completed");

  const missingIdCancel = run("node", [SCRIPT, "cancel", "--json"], { cwd: repo, env: buildEnv(bin, data) });
  assert.notEqual(missingIdCancel.status, 0);
  assert.match(missingIdCancel.stderr, /requires a job id/);

  const completedCancel = run("node", [SCRIPT, "cancel", "--json", statusPayload.jobs[0].id], { cwd: repo, env: buildEnv(bin, data) });
  assert.notEqual(completedCancel.status, 0);
  assert.match(completedCancel.stderr, /Cannot cancel job/);
});

test("cancel refuses active jobs whose recorded PID identity is stale", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const env = buildEnv(bin, data);
  const staleJob = {
    id: "stale-job",
    jobClass: "claude",
    kindLabel: "Analyze",
    mode: "analyze",
    title: "stale",
    summary: "stale",
    workspaceRoot: repo,
    status: "running",
    phase: "running",
    pid: process.pid,
    processStartTime: "Mon Jan  1 00:00:00 1990",
    logFile: null
  };
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = data;
  try {
    upsertJob(repo, staleJob);
    writeJobFile(repo, staleJob.id, staleJob);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }

  const cancelled = run("node", [SCRIPT, "cancel", "--json", staleJob.id], { cwd: repo, env });
  assert.notEqual(cancelled.status, 0);
  assert.match(cancelled.stderr, /recorded process/);
  const result = run("node", [SCRIPT, "result", "--json", staleJob.id], { cwd: repo, env });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "stale-process");
  assert.equal(payload.pid, null);
  assert.equal(payload.cancelSignal.attempted, false);
});

test("cancel does not mark jobs cancelled when termination cannot confirm exit", async () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const env = buildEnv(bin, data);
  const activeJob = {
    id: "unkillable-job",
    jobClass: "claude",
    kindLabel: "Analyze",
    mode: "analyze",
    title: "unkillable",
    summary: "unkillable",
    workspaceRoot: repo,
    status: "running",
    phase: "running",
    pid: 123,
    processStartTime: "Mon Jan  1 00:00:00 2026",
    processGroup: true,
    logFile: null
  };
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = data;
  try {
    upsertJob(repo, activeJob);
    writeJobFile(repo, activeJob.id, activeJob);
    await assert.rejects(
      () => handleCancel(repo, {
        reference: activeJob.id,
        json: true,
        terminateProcessTreeImpl: async () => ({
          attempted: true,
          delivered: true,
          escalated: true,
          method: "process-group",
          verification: { alive: true, matches: true, reason: "matched", currentStartTime: activeJob.processStartTime }
        })
      }),
      /Cannot confirm cancellation/
    );
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }

  const readDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = data;
  let payload;
  try {
    payload = readJobFile(repo, activeJob.id);
  } finally {
    if (readDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = readDataDir;
    }
  }
  assert.equal(payload.status, "running");
  assert.equal(payload.phase, "cancel-failed");
  assert.equal(payload.cancelSignal.verification.matches, true);
  assert.equal(payload.cancelRequestedAt, undefined);
  assert.ok(payload.cancelFailedAt);
});


test("status marks stale active jobs failed instead of leaving them running", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const env = buildEnv(bin, data);
  const staleJob = {
    id: "stale-status-job",
    jobClass: "claude",
    kindLabel: "Analyze",
    mode: "analyze",
    title: "stale",
    summary: "stale",
    workspaceRoot: repo,
    status: "running",
    phase: "running",
    pid: process.pid,
    processStartTime: "Mon Jan  1 00:00:00 1990",
    logFile: null
  };
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = data;
  try {
    upsertJob(repo, staleJob);
    writeJobFile(repo, staleJob.id, staleJob);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }

  const status = run("node", [SCRIPT, "status", "--json", staleJob.id], { cwd: repo, env });
  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "stale-process");
  assert.equal(payload.pid, null);
  assert.equal(payload.processVerification.reason, "pid-reused");
});

test("status truncates long job lists unless --all is provided", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const env = buildEnv(bin, data);
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = data;
  try {
    for (let index = 0; index < 25; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
      upsertJob(repo, {
        id: `job-${String(index).padStart(2, "0")}`,
        mode: "analyze",
        kindLabel: "Analyze",
        status: "completed",
        phase: "done",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }

  const compact = run("node", [SCRIPT, "status", "--json"], { cwd: repo, env });
  assert.equal(compact.status, 0, compact.stderr);
  const compactPayload = JSON.parse(compact.stdout);
  assert.equal(compactPayload.jobs.length, 20);
  assert.equal(compactPayload.truncated, true);
  assert.equal(compactPayload.total, 25);

  const all = run("node", [SCRIPT, "status", "--json", "--all"], { cwd: repo, env });
  assert.equal(all.status, 0, all.stderr);
  const allPayload = JSON.parse(all.stdout);
  assert.equal(allPayload.jobs.length, 25);
  assert.equal(allPayload.truncated, false);
  assert.equal(allPayload.total, 25);
});

test("background job can be waited for", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const env = buildEnv(bin, data);
  const started = run("node", [SCRIPT, "analyze", "--json", "--background", "background task"], { cwd: repo, env });
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  assert.equal(startPayload.status, "running");
  assert.equal(typeof startPayload.pid, "number");
  if (process.platform !== "win32") {
    assert.equal(typeof startPayload.processStartTime, "string");
    assert.ok(startPayload.processStartTime.length > 0);
  }
  const status = run("node", [SCRIPT, "status", "--json", "--wait", "--timeout-ms", "5000", startPayload.id], { cwd: repo, env });
  assert.equal(status.status, 0, status.stderr);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.status, "completed");
  assert.equal(statusPayload.waitTimedOut, false);
});

test("background job can be cancelled", () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const pidFile = path.join(data, "fake-claude.pid");
  const env = { ...buildEnv(bin, data), FAKE_CLAUDE_PID_FILE: pidFile };
  const started = run("node", [SCRIPT, "analyze", "--json", "--background", "SLEEP"], { cwd: repo, env });
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  assert.equal(waitForFile(pidFile), true, "fake Claude child PID was not recorded");
  const childPid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.equal(processAlive(childPid), true, "fake Claude child should be alive before cancel");
  const cancelled = run("node", [SCRIPT, "cancel", "--json", startPayload.id], { cwd: repo, env });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  const cancelPayload = JSON.parse(cancelled.stdout);
  assert.equal(cancelPayload.status, "cancelled");
  if (!waitForProcessExit(childPid)) {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Already gone.
    }
    assert.fail(`fake Claude child ${childPid} survived background cancel`);
  }
});

function waitForRunningJobWithPid(repo, dataDir, timeoutMs = 5000) {
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = listJobs(repo).find((entry) => entry.status === "running" && Number.isFinite(entry.pid));
      if (job) {
        return job;
      }
      sleep(25);
    }
    return null;
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }
}

function readStoredJobWithDataDir(repo, dataDir, jobId) {
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    return readJobFile(repo, jobId);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
  }
}

test("foreground job cancel kills Claude child and keeps cancelled terminal status", async () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const pidFile = path.join(data, "fake-claude-fg.pid");
  const env = { ...buildEnv(bin, data), FAKE_CLAUDE_PID_FILE: pidFile };

  const foreground = spawn(process.execPath, [SCRIPT, "analyze", "--json", "SLEEP"], {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  foreground.stdout.setEncoding("utf8");
  foreground.stderr.setEncoding("utf8");
  foreground.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  foreground.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const foregroundExit = new Promise((resolve) => {
    foreground.on("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    assert.equal(waitForFile(pidFile, 5000), true, "fake Claude child PID was not recorded");
    const childPid = Number(fs.readFileSync(pidFile, "utf8"));
    assert.equal(processAlive(childPid), true, "fake Claude child should be alive before cancel");

    const runningJob = waitForRunningJobWithPid(repo, data, 5000);
    assert.ok(runningJob, "foreground job with persisted Claude pid was not found");
    assert.equal(runningJob.pid, childPid, "stored pid should be the Claude child, not only the companion");
    if (process.platform !== "win32") {
      assert.equal(runningJob.processGroup, true, "detached Claude child should be tracked as a process group");
      assert.equal(typeof runningJob.processStartTime, "string");
      assert.ok(runningJob.processStartTime.length > 0);
    }

    const cancelled = run("node", [SCRIPT, "cancel", "--json", runningJob.id], { cwd: repo, env });
    assert.equal(cancelled.status, 0, cancelled.stderr);
    const cancelPayload = JSON.parse(cancelled.stdout);
    assert.equal(cancelPayload.status, "cancelled");

    if (!waitForProcessExit(childPid, 5000)) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already gone.
      }
      assert.fail(`fake Claude child ${childPid} survived foreground cancel`);
    }

    const exit = await Promise.race([
      foregroundExit,
      new Promise((resolve) => setTimeout(() => resolve({ code: null, signal: "timeout" }), 8000))
    ]);
    assert.notEqual(exit.signal, "timeout", `foreground companion did not exit after cancel: ${stderr}`);
    assert.equal(exit.code, 0, `foreground companion exit=${exit.code} signal=${exit.signal} stderr=${stderr} stdout=${stdout}`);

    const terminal = JSON.parse(stdout);
    assert.equal(terminal.status, "cancelled", `foreground terminal payload: ${stdout}`);
    assert.match(terminal.rendered ?? "", /cancelled/i);

    const stored = readStoredJobWithDataDir(repo, data, runningJob.id);
    assert.ok(stored, "stored job missing after foreground cancel");
    assert.equal(stored.status, "cancelled");
    assert.equal(stored.pid, null);
  } finally {
    if (!foreground.killed && foreground.exitCode === null) {
      foreground.kill("SIGKILL");
    }
  }
});

test("foreground non-JSON cancel renders a cancelled terminal message", async () => {
  const repo = makeTempDir();
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  initGitRepo(repo);
  const pidFile = path.join(data, "fake-claude-fg-text.pid");
  const env = { ...buildEnv(bin, data), FAKE_CLAUDE_PID_FILE: pidFile };

  const foreground = spawn(process.execPath, [SCRIPT, "analyze", "SLEEP"], {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  foreground.stdout.setEncoding("utf8");
  foreground.stderr.setEncoding("utf8");
  foreground.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  foreground.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const foregroundExit = new Promise((resolve) => {
    foreground.on("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    assert.equal(waitForFile(pidFile, 5000), true, "fake Claude child PID was not recorded");
    const childPid = Number(fs.readFileSync(pidFile, "utf8"));
    const runningJob = waitForRunningJobWithPid(repo, data, 5000);
    assert.ok(runningJob, "foreground job was not found for non-JSON cancel");

    const cancelled = run("node", [SCRIPT, "cancel", runningJob.id], { cwd: repo, env });
    assert.equal(cancelled.status, 0, cancelled.stderr);
    assert.match(cancelled.stdout, /Cancelled Claude Router job/);

    assert.equal(waitForProcessExit(childPid, 5000), true, "Claude child survived non-JSON foreground cancel");
    const exit = await Promise.race([
      foregroundExit,
      new Promise((resolve) => setTimeout(() => resolve({ code: null, signal: "timeout" }), 8000))
    ]);
    assert.notEqual(exit.signal, "timeout", `foreground companion hung: ${stderr}`);
    assert.equal(exit.code, 0, stderr);
    assert.match(stdout, /cancelled/i);
    assert.equal(readStoredJobWithDataDir(repo, data, runningJob.id).status, "cancelled");
  } finally {
    if (!foreground.killed && foreground.exitCode === null) {
      foreground.kill("SIGKILL");
    }
  }
});
