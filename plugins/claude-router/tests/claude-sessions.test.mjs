import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyClaudePrintFailure,
  renderClaudePayload,
  SMOKE_TEST_TIMEOUT_MS
} from "../scripts/lib/claude.mjs";
import {
  claudeProjectSlugsForCwd,
  discoverClaudeSession,
  encodeClaudeProjectSlug,
  extractSessionIdFromText,
  resolveClaudeProjectDir,
  snapshotClaudeSessionIds
} from "../scripts/lib/claude-sessions.mjs";
import { makeTempDir } from "./helpers.mjs";

function writeSession(dir, sessionId, payload, mtimeMs) {
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  if (Number.isFinite(mtimeMs)) {
    const atime = new Date();
    fs.utimesSync(file, atime, new Date(mtimeMs));
  }
  return file;
}

test("encodeClaudeProjectSlug matches Claude Code project directory encoding", () => {
  assert.equal(encodeClaudeProjectSlug("/Users/ada/work/repo"), "-Users-ada-work-repo");
});

test("claudeProjectSlugsForCwd includes both the given path and its realpath", () => {
  const cwd = makeTempDir();
  const slugs = claudeProjectSlugsForCwd(cwd);
  assert.ok(slugs.includes(encodeClaudeProjectSlug(cwd)));
  assert.ok(slugs.length >= 1);
});

test("discoverClaudeSession prefers the parent over later Explore subagents", () => {
  const cwd = makeTempDir();
  const configDir = makeTempDir();
  const env = { CLAUDE_CONFIG_DIR: configDir };
  const projectDir = resolveClaudeProjectDir(cwd, env);
  fs.mkdirSync(projectDir, { recursive: true });
  const parentId = "468cefa0-5f55-4e45-a8fa-093f989e3096";
  const startedAtMs = Date.now() - 1000;
  writeSession(projectDir, parentId, { type: "system", sessionId: parentId, cwd }, startedAtMs);
  writeSession(
    projectDir,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    { type: "system", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", parentSessionId: parentId, isSidechain: true },
    startedAtMs + 10
  );
  writeSession(
    projectDir,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    { type: "system", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", parentSessionId: parentId, isSidechain: true },
    startedAtMs + 20
  );
  fs.writeFileSync(path.join(projectDir, "agent-not-a-parent.jsonl"), "{}\n");
  const discovered = discoverClaudeSession(cwd, { env, startedAtMs, excludeIds: [] });
  assert.equal(discovered.sessionId, parentId);
  assert.equal(discovered.path, path.join(projectDir, `${parentId}.jsonl`));
});

test("discoverClaudeSession ignores sessions that existed before the job started", () => {
  const cwd = makeTempDir();
  const configDir = makeTempDir();
  const env = { CLAUDE_CONFIG_DIR: configDir };
  const projectDir = resolveClaudeProjectDir(cwd, env);
  fs.mkdirSync(projectDir, { recursive: true });
  const prior = "11111111-1111-4111-8111-111111111111";
  const next = "22222222-2222-4222-8222-222222222222";
  writeSession(projectDir, prior, { sessionId: prior }, Date.now() - 60_000);
  const excludeIds = snapshotClaudeSessionIds(cwd, env);
  writeSession(projectDir, next, { sessionId: next }, Date.now());
  const discovered = discoverClaudeSession(cwd, { env, excludeIds, startedAtMs: Date.now() - 1000 });
  assert.equal(discovered.sessionId, next);
});

test("extractSessionIdFromText reads complete JSON and truncated print output", () => {
  assert.equal(
    extractSessionIdFromText(JSON.stringify({ result: "x", session_id: "468cefa0-5f55-4e45-a8fa-093f989e3096" })),
    "468cefa0-5f55-4e45-a8fa-093f989e3096"
  );
  assert.equal(
    extractSessionIdFromText('{"type":"result","sessionId":"468cefa0-5f55-4e45-a8fa-093f989e3096","result":"par'),
    "468cefa0-5f55-4e45-a8fa-093f989e3096"
  );
});

test("classifyClaudePrintFailure distinguishes killed-in-progress from hard empty", () => {
  assert.equal(
    classifyClaudePrintFailure({
      timedOut: true,
      rawOutput: "",
      claudeSessionId: "468cefa0-5f55-4e45-a8fa-093f989e3096"
    }),
    "killed-in-progress"
  );
  assert.equal(classifyClaudePrintFailure({ timedOut: true, rawOutput: "", claudeSessionId: null }), "timed-out-empty");
  assert.equal(classifyClaudePrintFailure({ timedOut: false, rawOutput: "", claudeSessionId: null }), "empty");
  assert.equal(classifyClaudePrintFailure({ timedOut: false, rawOutput: "ok", claudeSessionId: null }), null);
  assert.equal(
    classifyClaudePrintFailure({
      timedOut: false,
      rawOutput: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }),
      parsed: { is_error: true, result: "Not logged in · Please run /login" },
      claudeSessionId: "11111111-1111-4111-8111-111111111111"
    }),
    "auth-failed"
  );
  assert.equal(
    classifyClaudePrintFailure({
      timedOut: false,
      rawOutput: JSON.stringify({ is_error: true, result: "API connection timeout" }),
      parsed: { is_error: true, result: "API connection timeout" },
      claudeSessionId: "22222222-2222-4222-8222-222222222222"
    }),
    "claude-error"
  );
  assert.equal(
    classifyClaudePrintFailure({
      timedOut: true,
      rawOutput: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }),
      parsed: { is_error: true, result: "Not logged in · Please run /login" },
      claudeSessionId: "11111111-1111-4111-8111-111111111111"
    }),
    "killed-in-progress"
  );
});

test("renderClaudePayload does not claim no output when a live session was killed", () => {
  const sessionId = "468cefa0-5f55-4e45-a8fa-093f989e3096";
  const text = renderClaudePayload({ workflow: "Analyze" }, "", null, "", ["Claude process timed out while a session was still in progress and was terminated before final output."], {
    timedOut: true,
    failureKind: "killed-in-progress",
    claudeSessionId: sessionId,
    claudeSessionPath: path.join(os.tmpdir(), `${sessionId}.jsonl`),
    logFile: "/tmp/jobs/analyze.log",
    cwd: "/tmp/repo"
  });
  assert.match(text, /killed in progress/i);
  assert.doesNotMatch(text, /Claude returned no output/);
  assert.match(text, /Job log: \/tmp\/jobs\/analyze\.log/);
  assert.match(text, new RegExp(`Resume: claude --resume ${sessionId}`));
  assert.match(text, new RegExp(String(SMOKE_TEST_TIMEOUT_MS)));
});
