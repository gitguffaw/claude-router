import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, initGitRepo, installFakeClaude, makeTempDir, run } from "./helpers.mjs";
import { redactSecrets } from "../scripts/lib/redact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-companion.mjs");
const KEY = "sk-ant-api03-ROUTERTESTSECRETabcdef";
const BEARER = "ROUTERTESTBEARERtoken42";

function setup(extraEnv = {}) {
  const bin = makeTempDir();
  installFakeClaude(bin);
  const data = makeTempDir();
  const repo = makeTempDir();
  initGitRepo(repo);
  return { data, repo, env: { ...buildEnv(bin, data), ...extraEnv } };
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function filesContaining(dir, needles) {
  return filesUnder(dir)
    .filter((file) => needles.some((needle) => fs.readFileSync(file, "utf8").includes(needle)))
    .map((file) => path.relative(dir, file));
}

async function waitForTerminal(repo, env, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = run("node", [SCRIPT, "result", jobId, "--json"], { cwd: repo, env });
    const job = result.status === 0 ? JSON.parse(result.stdout) : null;
    if (job && !["queued", "running"].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not finish`);
}

test("redactSecrets masks keys and bearer tokens but not words that contain sk-", () => {
  const rows = [
    [`use ${KEY} now`, "use sk-ant-REDACTED now"],
    ["key=sk-abcdefghijklmnop", "key=sk-REDACTED"],
    ["ANTHROPIC_API_KEY=abc123 next", "ANTHROPIC_API_KEY=REDACTED next"],
    [`Authorization: Bearer ${BEARER}`, "Authorization: Bearer REDACTED"],
    ["risk-assessment-notes-v2", "risk-assessment-notes-v2"],
    ["fix/disk-cleanup-for-everything", "fix/disk-cleanup-for-everything"],
    ["task-abcdefghijklmnop", "task-abcdefghijklmnop"]
  ];
  for (const [input, expected] of rows) {
    assert.equal(redactSecrets(input), expected, input);
  }
});

test("finished jobs store no raw secrets in job files, the index, context packs, or logs", () => {
  const { data, repo, env } = setup({ FAKE_CLAUDE_STDERR_ECHO: "1" });
  const promptRun = run("node", [SCRIPT, "exec", "--json", `use key ${KEY} now`], { cwd: repo, env });
  assert.equal(promptRun.status, 0, promptRun.stderr);
  const flagRun = run("node", [SCRIPT, "exec", "--json", "--system-prompt", `Authorization: Bearer ${BEARER}`, "hello"], { cwd: repo, env });
  assert.equal(flagRun.status, 0, flagRun.stderr);

  assert.deepEqual(filesContaining(data, [KEY, BEARER]), []);

  const job = JSON.parse(promptRun.stdout);
  const stored = JSON.parse(run("node", [SCRIPT, "result", job.id, "--json"], { cwd: repo, env }).stdout);
  assert.match(stored.request.prompt, /sk-ant-REDACTED/);
  assert.match(stored.rendered, /sk-ant-REDACTED/);
  assert.match(fs.readFileSync(stored.logFile, "utf8"), /warning: <task>\nuse key sk-ant-REDACTED now/);
});

test("background jobs hand the raw prompt to Claude, then redact it once finished", async () => {
  const argvFile = path.join(makeTempDir(), "argv.json");
  const { data, repo, env } = setup({ FAKE_CLAUDE_PRINT_ARGV_FILE: argvFile });
  const launched = run("node", [SCRIPT, "exec", "--json", "--background", `bg ${KEY}`], { cwd: repo, env });
  assert.equal(launched.status, 0, launched.stderr);
  const job = await waitForTerminal(repo, env, JSON.parse(launched.stdout).id);

  assert.equal(job.status, "completed");
  assert.match(JSON.parse(fs.readFileSync(argvFile, "utf8")).at(-1), new RegExp(`bg ${KEY}`));
  // The job file turns terminal a moment before the index is rewritten, so poll briefly.
  let leaking = filesContaining(data, [KEY]);
  for (let attempt = 0; leaking.length && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    leaking = filesContaining(data, [KEY]);
  }
  assert.deepEqual(leaking, []);
});

test("bypass and read-only guards hold when Claude help discovery fails", () => {
  const argvFile = path.join(makeTempDir(), "argv.json");
  const { repo, env } = setup({ FAKE_CLAUDE_HELP_FAIL: "1", FAKE_CLAUDE_PRINT_ARGV_FILE: argvFile });
  const rejected = [
    [["exec", "--dangerously-skip-permissions", "x"], /Dangerous permission bypass/],
    [["exec", "--allow-dangerously-skip-permissions", "x"], /Dangerous permission bypass/],
    [["exec", "--permission-mode", "bypassPermissions", "x"], /Dangerous permission bypass/],
    [["exec", "--permission-mode=bypassPermissions", "x"], /Dangerous permission bypass/],
    [["review", "--permission-mode", "acceptEdits", "x"], /read-only and requires --permission-mode plan/],
    [["raw", "--dangerously-skip-permissions", "-p", "x"], /dangerous permission bypass/],
    [["raw", "--permission-mode", "bypassPermissions", "-p", "x"], /dangerous permission bypass/],
    [["cli", "--dangerously-skip-permissions", "-p", "x"], /dangerous permission bypass/],
    [["raw", "mcp", "add", "evil", "cmd"], /may mutate/],
    [["raw", "--verbose", "plugin", "install", "x"], /may mutate/],
    [["raw", "rm", "abc"], /may mutate/]
  ];
  for (const [argv, message] of rejected) {
    fs.rmSync(argvFile, { force: true });
    const result = run("node", [SCRIPT, ...argv], { cwd: repo, env });
    assert.notEqual(result.status, 0, argv.join(" "));
    assert.match(result.stderr, message, argv.join(" "));
    assert.equal(fs.existsSync(argvFile), false, `${argv.join(" ")} launched Claude`);
  }

  const plan = run("node", [SCRIPT, "plan", "x"], { cwd: repo, env });
  assert.equal(plan.status, 0, plan.stderr);
  const planArgv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  assert.equal(planArgv[planArgv.indexOf("--permission-mode") + 1], "plan");
  assert.equal(planArgv.some((arg) => /skip-permissions/.test(arg)), false);
});
