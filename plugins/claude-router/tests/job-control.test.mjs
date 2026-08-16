import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { makeTempDir } from "./helpers.mjs";
import { readFullJob, resolveJob, sortJobsNewestFirst } from "../scripts/lib/job-control.mjs";
import { upsertJob, writeJobFile } from "../scripts/lib/state.mjs";

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort self-clean
  }
}

function withJobWorkspace(fn) {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previous = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    return fn(cwd);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previous;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
}

test("sortJobsNewestFirst orders by updatedAt descending without mutating the input", () => {
  const jobs = [
    { id: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", updatedAt: "2026-03-01T00:00:00.000Z" },
    { id: "untimed" },
    { id: "mid", updatedAt: "2026-02-01T00:00:00.000Z" }
  ];
  const sorted = sortJobsNewestFirst(jobs);
  assert.deepEqual(sorted.map((job) => job.id), ["new", "mid", "old", "untimed"]);
  assert.deepEqual(jobs.map((job) => job.id), ["old", "new", "untimed", "mid"]);
});

test("resolveJob throws when the workspace has no jobs", () => {
  withJobWorkspace((cwd) => {
    assert.throws(() => resolveJob(cwd), /No Claude Router jobs found\./);
  });
});

test("resolveJob without a reference returns the newest job", () => {
  withJobWorkspace((cwd) => {
    upsertJob(cwd, { id: "claude-older", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" });
    upsertJob(cwd, { id: "claude-newer", status: "completed", updatedAt: "2026-02-01T00:00:00.000Z" });
    assert.equal(resolveJob(cwd).id, "claude-newer");
  });
});

test("resolveJob matches an exact id and an id prefix, preferring the newest match", () => {
  withJobWorkspace((cwd) => {
    upsertJob(cwd, { id: "claude-aaa-111", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" });
    upsertJob(cwd, { id: "claude-aaa-222", status: "completed", updatedAt: "2026-02-01T00:00:00.000Z" });
    upsertJob(cwd, { id: "claude-bbb-333", status: "completed", updatedAt: "2026-03-01T00:00:00.000Z" });
    assert.equal(resolveJob(cwd, "claude-aaa-111").id, "claude-aaa-111");
    assert.equal(resolveJob(cwd, "claude-aaa").id, "claude-aaa-222");
    assert.equal(resolveJob(cwd, "claude-bbb").id, "claude-bbb-333");
  });
});

test("resolveJob rejects an unknown reference and names it in the message", () => {
  withJobWorkspace((cwd) => {
    upsertJob(cwd, { id: "claude-known", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" });
    assert.throws(() => resolveJob(cwd, "missing-ref"), /No Claude Router job found for "missing-ref"\./);
  });
});

test("readFullJob prefers the per-job file payload over the index record", () => {
  withJobWorkspace((cwd) => {
    upsertJob(cwd, { id: "claude-full", status: "running", updatedAt: "2026-01-01T00:00:00.000Z" });
    writeJobFile(cwd, "claude-full", { id: "claude-full", status: "completed", rendered: "# Done" });
    const job = readFullJob(cwd, "claude-full");
    assert.equal(job.status, "completed");
    assert.equal(job.rendered, "# Done");
  });
});

test("readFullJob falls back to the index record when the job file is missing", () => {
  withJobWorkspace((cwd) => {
    upsertJob(cwd, { id: "claude-index-only", status: "running", updatedAt: "2026-01-01T00:00:00.000Z" });
    const job = readFullJob(cwd, "claude-index-only");
    assert.equal(job.id, "claude-index-only");
    assert.equal(job.status, "running");
  });
});
