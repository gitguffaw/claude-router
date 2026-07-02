import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-companion.mjs");

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

test("surface reports local claude help", () => {
  const bin = makeTempDir();
  const data = makeTempDir();
  installFakeClaude(bin);
  const result = run("node", [SCRIPT, "surface", "--json"], { cwd: ROOT, env: buildEnv(bin, data) });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.router.version, "2.1.1");
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
  assert.equal(payload.router.version, "2.1.1");
  assert.match(payload.claude.stdout, /2.1.185/);
});

test("top-level help reports Claude Router commands", () => {
  const result = run("node", [SCRIPT, "--help"], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Claude Router/);
  assert.match(result.stdout, /models\s+Show model selectors/);
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
  const env = buildEnv(bin, data);
  const started = run("node", [SCRIPT, "analyze", "--json", "--background", "SLEEP"], { cwd: repo, env });
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  const cancelled = run("node", [SCRIPT, "cancel", "--json", startPayload.id], { cwd: repo, env });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  const cancelPayload = JSON.parse(cancelled.stdout);
  assert.equal(cancelPayload.status, "cancelled");
});
