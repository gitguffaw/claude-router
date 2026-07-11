import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./helpers.mjs";
import { buildProcessRecord, currentProcessRecord } from "../scripts/lib/process.mjs";
import {
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveLockFile,
  resolveStateDir,
  transitionJob,
  upsertJob,
  writeJobFile
} from "../scripts/lib/state.mjs";
import { isCancelInProgress, runTrackedJob, trackChildProcessIdentity } from "../scripts/lib/tracked-jobs.mjs";
import { handleCancel, refreshStaleActiveJobs } from "../scripts/lib/job-commands.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_MODULE = path.join(ROOT, "scripts/lib/state.mjs");

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort self-clean
  }
}

function runWorker(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function withDataDir(dataDir, fn) {
  const previous = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previous;
    }
  }
}

test("concurrent multi-process upsertJob and writeJobFile retain every job", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const workerDir = makeTempDir();
  const workerScript = path.join(workerDir, "upsert-worker.mjs");
  const processCount = 30;
  fs.writeFileSync(workerScript, `import { upsertJob, writeJobFile } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
const id = process.argv[3];
const job = {
  id,
  status: "completed",
  mode: "analyze",
  summary: id,
  logFile: null
};
upsertJob(cwd, job);
writeJobFile(cwd, id, job);
process.stdout.write(\`ok:\${id}\`);
`, "utf8");

  try {
    const env = { ...process.env, CLAUDE_ROUTER_DATA: dataDir };
    const results = await Promise.all(
      Array.from({ length: processCount }, (_, index) => {
        const id = `job-${String(index).padStart(2, "0")}`;
        return runWorker(workerScript, [cwd, id], env).then((result) => ({ id, ...result }));
      })
    );

    for (const result of results) {
      assert.equal(result.code, 0, `worker ${result.id} failed: ${result.stderr || result.stdout}`);
    }

    withDataDir(dataDir, () => {
      const jobs = listJobs(cwd);
      assert.equal(jobs.length, processCount, `expected ${processCount} indexed jobs, got ${jobs.length}`);
      const indexedIds = new Set(jobs.map((job) => job.id));
      for (let index = 0; index < processCount; index += 1) {
        const id = `job-${String(index).padStart(2, "0")}`;
        assert.ok(indexedIds.has(id), `missing indexed job ${id}`);
        const stored = readJobFile(cwd, id);
        assert.ok(stored, `missing job file for ${id}`);
        assert.equal(stored.id, id);
        assert.equal(stored.status, "completed");
        assert.ok(fs.existsSync(resolveJobFile(cwd, id)));
      }
    });
  } finally {
    cleanupDir(workerDir);
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("stale state lock is recovered and allows upsertJob", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const lockFile = resolveLockFile(cwd);
      fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
      // Abandoned lock from a dead pid with an old timestamp.
      fs.writeFileSync(
        lockFile,
        `${JSON.stringify({ pid: 999999991, createdAt: Date.now() - 60_000 })}\n`,
        { encoding: "utf8", mode: 0o600 }
      );

      const state = upsertJob(cwd, { id: "recovered-job", status: "completed", mode: "analyze" });
      assert.equal(state.jobs.length, 1);
      assert.equal(state.jobs[0].id, "recovered-job");
      assert.ok(!fs.existsSync(lockFile), "lock should be released after recovery");
      assert.ok(fs.existsSync(path.join(resolveStateDir(cwd), "state.json")));
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});
test("live state lock times out instead of blocking forever", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const workerDir = makeTempDir();
  const holderScript = path.join(workerDir, "hold-lock.mjs");
  const waiterScript = path.join(workerDir, "wait-lock.mjs");
  fs.writeFileSync(holderScript, `import fs from "node:fs";
import { buildProcessRecord } from ${JSON.stringify(path.join(ROOT, "scripts/lib/process.mjs"))};
import { resolveLockFile, ensureStateDir } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
const readyFile = process.argv[3];
ensureStateDir(cwd);
const lockFile = resolveLockFile(cwd);
const identity = buildProcessRecord(process.pid);
fs.writeFileSync(lockFile, JSON.stringify({ pid: identity.pid, processStartTime: identity.processStartTime, createdAt: Date.now() }) + "\\n", { flag: "wx", encoding: "utf8", mode: 0o600 });
fs.writeFileSync(readyFile, "ready\\n");
setTimeout(() => {}, 30_000);
`, "utf8");
  fs.writeFileSync(waiterScript, `import { upsertJob } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
try {
  upsertJob(cwd, { id: "blocked-job", status: "queued" });
  console.error("expected lock timeout");
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Timed out/i.test(message)) {
    console.error(message);
    process.exit(3);
  }
  process.stdout.write("timeout-ok");
  process.exit(0);
}
`, "utf8");
  const readyFile = path.join(workerDir, "ready.txt");
  const env = {
    ...process.env,
    CLAUDE_ROUTER_DATA: dataDir,
    CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS: "200",
    CLAUDE_ROUTER_STATE_LOCK_STALE_MS: "60000"
  };
  let holder;
  try {
    holder = spawn(process.execPath, [holderScript, cwd, readyFile], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(fs.existsSync(readyFile), "lock holder did not become ready");

    const waited = await runWorker(waiterScript, [cwd], env);
    assert.equal(waited.code, 0, waited.stderr || waited.stdout);
    assert.match(waited.stdout, /timeout-ok/);
  } finally {
    if (holder && !holder.killed) {
      holder.kill("SIGKILL");
    }
    cleanupDir(workerDir);
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("live lock with old createdAt is not stolen when staleMs is below timeoutMs", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const workerDir = makeTempDir();
  const holderScript = path.join(workerDir, "hold-old-lock.mjs");
  const waiterScript = path.join(workerDir, "wait-old-lock.mjs");
  fs.writeFileSync(holderScript, `import fs from "node:fs";
import { buildProcessRecord } from ${JSON.stringify(path.join(ROOT, "scripts/lib/process.mjs"))};
import { resolveLockFile, ensureStateDir } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
const readyFile = process.argv[3];
ensureStateDir(cwd);
const lockFile = resolveLockFile(cwd);
const identity = buildProcessRecord(process.pid);
const payload = {
  pid: identity.pid,
  processStartTime: identity.processStartTime,
  // Intentionally older than any reasonable staleMs override.
  createdAt: Date.now() - 60_000
};
fs.writeFileSync(lockFile, JSON.stringify(payload) + "\\n", { flag: "wx", encoding: "utf8", mode: 0o600 });
fs.writeFileSync(readyFile, JSON.stringify({ lockFile, pid: identity.pid, processStartTime: identity.processStartTime }) + "\\n");
setTimeout(() => {}, 30_000);
`, "utf8");
  fs.writeFileSync(waiterScript, `import { upsertJob } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
try {
  upsertJob(cwd, { id: "must-not-acquire", status: "queued" });
  console.error("expected lock timeout against live aged lock");
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Timed out/i.test(message)) {
    console.error(message);
    process.exit(3);
  }
  process.stdout.write("timeout-ok");
  process.exit(0);
}
`, "utf8");

  const readyFile = path.join(workerDir, "ready.txt");
  // staleMs << timeoutMs would previously let waiters unlink a live holder.
  const env = {
    ...process.env,
    CLAUDE_ROUTER_DATA: dataDir,
    CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS: "400",
    CLAUDE_ROUTER_STATE_LOCK_STALE_MS: "50"
  };
  let holder;
  try {
    holder = spawn(process.execPath, [holderScript, cwd, readyFile], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(fs.existsSync(readyFile), "aged lock holder did not become ready");
    const holderMeta = JSON.parse(fs.readFileSync(readyFile, "utf8"));
    const lockBefore = fs.readFileSync(holderMeta.lockFile, "utf8");

    const waited = await runWorker(waiterScript, [cwd], env);
    assert.equal(waited.code, 0, waited.stderr || waited.stdout);
    assert.match(waited.stdout, /timeout-ok/);

    assert.ok(fs.existsSync(holderMeta.lockFile), "live aged lock must still exist after waiter timeout");
    const lockAfter = fs.readFileSync(holderMeta.lockFile, "utf8");
    assert.equal(lockAfter, lockBefore, "waiter must not replace the live holder's lock");
    const afterMeta = JSON.parse(lockAfter);
    assert.equal(afterMeta.pid, holderMeta.pid);
    assert.equal(afterMeta.processStartTime, holderMeta.processStartTime);
    assert.ok(holder && !holder.killed && holder.exitCode === null, "holder process must still be alive");
  } finally {
    if (holder && !holder.killed) {
      holder.kill("SIGKILL");
    }
    cleanupDir(workerDir);
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("live lock without processStartTime is not stolen (Windows/legacy fallback)", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const workerDir = makeTempDir();
  const holderScript = path.join(workerDir, "hold-no-start.mjs");
  const waiterScript = path.join(workerDir, "wait-no-start.mjs");
  fs.writeFileSync(holderScript, `import fs from "node:fs";
import { resolveLockFile, ensureStateDir } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
const readyFile = process.argv[3];
ensureStateDir(cwd);
const lockFile = resolveLockFile(cwd);
// Legacy / Windows-style lock: live pid, no start identity, intentionally old age.
const payload = {
  pid: process.pid,
  createdAt: Date.now() - 60_000
};
fs.writeFileSync(lockFile, JSON.stringify(payload) + "\\n", { flag: "wx", encoding: "utf8", mode: 0o600 });
fs.writeFileSync(readyFile, JSON.stringify({ lockFile, pid: process.pid }) + "\\n");
setTimeout(() => {}, 30_000);
`, "utf8");
  fs.writeFileSync(waiterScript, `import { upsertJob } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
try {
  upsertJob(cwd, { id: "must-not-steal-legacy", status: "queued" });
  console.error("expected timeout against live lock without processStartTime");
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Timed out/i.test(message)) {
    console.error(message);
    process.exit(3);
  }
  process.stdout.write("timeout-ok");
  process.exit(0);
}
`, "utf8");

  const readyFile = path.join(workerDir, "ready.txt");
  const env = {
    ...process.env,
    CLAUDE_ROUTER_DATA: dataDir,
    CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS: "400",
    CLAUDE_ROUTER_STATE_LOCK_STALE_MS: "50"
  };
  let holder;
  try {
    holder = spawn(process.execPath, [holderScript, cwd, readyFile], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(fs.existsSync(readyFile), "legacy lock holder did not become ready");
    const holderMeta = JSON.parse(fs.readFileSync(readyFile, "utf8"));
    const lockBefore = fs.readFileSync(holderMeta.lockFile, "utf8");

    const waited = await runWorker(waiterScript, [cwd], env);
    assert.equal(waited.code, 0, waited.stderr || waited.stdout);
    assert.match(waited.stdout, /timeout-ok/);

    assert.ok(fs.existsSync(holderMeta.lockFile), "live legacy lock must remain after waiter timeout");
    const lockAfter = fs.readFileSync(holderMeta.lockFile, "utf8");
    assert.equal(lockAfter, lockBefore, "waiter must not replace a live lock without processStartTime");
    const afterMeta = JSON.parse(lockAfter);
    assert.equal(afterMeta.pid, holderMeta.pid);
    assert.equal(afterMeta.processStartTime, undefined);
    assert.ok(holder && !holder.killed && holder.exitCode === null, "holder process must still be alive");
  } finally {
    if (holder && !holder.killed) {
      holder.kill("SIGKILL");
    }
    cleanupDir(workerDir);
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("MAX_JOBS retention still prunes oldest indexed jobs under lock", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      for (let index = 0; index < 55; index += 1) {
        const id = `retention-${String(index).padStart(2, "0")}`;
        upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
        writeJobFile(cwd, id, { id, status: "completed" });
      }
      const jobs = listJobs(cwd);
      assert.equal(jobs.length, 50);
      assert.ok(!jobs.some((job) => job.id === "retention-00"));
      assert.ok(jobs.some((job) => job.id === "retention-54"));
      assert.equal(readJobFile(cwd, "retention-00"), null);
      assert.ok(readJobFile(cwd, "retention-54"));
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("runTrackedJob terminal commit preserves cancelling ownership under barrier", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const job = {
      id: "barrier-job",
      workspaceRoot: cwd,
      status: "queued",
      phase: "queued",
      mode: "analyze",
      logFile: null
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    let releaseRunner;
    const runnerGate = new Promise((resolve) => {
      releaseRunner = resolve;
    });
    let updateProcessSeen = false;

    const tracked = runTrackedJob(job, async ({ updateProcess }) => {
      updateProcess({
        pid: 4242,
        processStartTime: "Mon Jan  1 00:00:00 2026",
        processGroup: true
      });
      updateProcessSeen = true;
      await runnerGate;
      return {
        exitStatus: 0,
        jobStatus: "completed",
        payload: { ok: true },
        rendered: "completed-output",
        warnings: []
      };
    }, { trackChildProcess: true });

    const deadline = Date.now() + 2000;
    while (!updateProcessSeen && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    assert.equal(updateProcessSeen, true);
    assert.equal(readJobFile(cwd, job.id).pid, 4242);

    const claim = transitionJob(cwd, job.id, (current) => ({
      apply: true,
      reason: "claim-cancel",
      job: {
        ...current,
        phase: "cancelling",
        cancelRequestedAt: new Date().toISOString()
      }
    }));
    assert.equal(claim.applied, true);
    assert.equal(claim.job.phase, "cancelling");
    assert.equal(claim.job.pid, 4242);

    releaseRunner();
    const result = await tracked;
    assert.equal(result.status, "cancelled");
    assert.equal(result.phase, "cancelled");
    assert.equal(result.pid, null);
    assert.match(result.rendered ?? "", /cancelled/i);

    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "cancelled");
    assert.equal(stored.phase, "cancelled");
    assert.equal(stored.pid, null);
    assert.equal(listJobs(cwd).find((entry) => entry.id === job.id).status, "cancelled");
    assert.equal(listJobs(cwd).find((entry) => entry.id === job.id).pid, null);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("cancel during startup with missing-pid rejects and leaves tracking open", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const base = {
      id: "startup-job",
      status: "running",
      phase: "running",
      mode: "analyze",
      pid: null,
      processStartTime: null,
      processGroup: false,
      companionPid: process.pid
    };
    writeJobFile(cwd, base.id, base);
    upsertJob(cwd, base);

    await assert.rejects(
      () => handleCancel(cwd, { reference: "startup-job", json: true }),
      /missing-pid|still starting/i
    );

    const stored = readJobFile(cwd, "startup-job");
    assert.equal(stored.status, "running");
    assert.equal(stored.phase, "running");
    assert.equal(stored.pid, null);
    assert.equal(stored.cancelRequestedAt, undefined);
    assert.equal(isCancelInProgress(stored), false);

    const tracked = trackChildProcessIdentity(cwd, "startup-job", {
      pid: 999001,
      processStartTime: "Mon Jan  1 00:00:00 2026",
      processGroup: true
    });
    assert.equal(tracked.pid, 999001);
    assert.equal(readJobFile(cwd, "startup-job").pid, 999001);
    assert.equal(readJobFile(cwd, "startup-job").status, "running");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("cancel failure releases ownership so runTrackedJob can complete", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const job = {
      id: "cancel-fail-complete",
      workspaceRoot: cwd,
      status: "running",
      phase: "running",
      mode: "analyze",
      pid: 555,
      processStartTime: "Mon Jan  1 00:00:00 2026",
      processGroup: true,
      logFile: null
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    await assert.rejects(
      () => handleCancel(cwd, {
        reference: job.id,
        json: true,
        terminateProcessTreeImpl: async () => ({
          attempted: true,
          delivered: true,
          escalated: true,
          method: "process-group",
          verification: {
            alive: true,
            matches: true,
            reason: "matched",
            currentStartTime: job.processStartTime
          }
        })
      }),
      /Cannot confirm cancellation/
    );

    const afterCancel = readJobFile(cwd, job.id);
    assert.equal(afterCancel.status, "running");
    assert.equal(afterCancel.phase, "cancel-failed");
    assert.equal(afterCancel.cancelRequestedAt, undefined);
    assert.ok(afterCancel.cancelFailedAt);
    assert.equal(isCancelInProgress(afterCancel), false);

    const result = await runTrackedJob(job, async () => ({
      exitStatus: 0,
      jobStatus: "completed",
      payload: { ok: true },
      rendered: "done",
      warnings: []
    }), { trackChildProcess: false });

    assert.equal(result.status, "completed");
    assert.equal(readJobFile(cwd, job.id).status, "completed");
    assert.equal(listJobs(cwd).find((entry) => entry.id === job.id).status, "completed");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("create-then-cancel cannot be clobbered by unlocked job file rewrite", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const jobId = "create-race";
      const created = transitionJob(cwd, jobId, () => ({
        apply: true,
        reason: "create-queued",
        job: {
          id: jobId,
          status: "queued",
          phase: "queued",
          mode: "analyze"
        }
      }));
      assert.equal(created.applied, true);

      const cancelled = transitionJob(cwd, jobId, (current) => ({
        apply: true,
        reason: "cancel-no-process",
        job: {
          ...current,
          status: "cancelled",
          phase: "cancelled",
          pid: null,
          completedAt: new Date().toISOString()
        }
      }));
      assert.equal(cancelled.applied, true);
      assert.equal(readJobFile(cwd, jobId).status, "cancelled");

      // Stale companion write must not resurrect via transitionJob.
      const resurrect = transitionJob(cwd, jobId, (current) => {
        if (current?.status === "cancelled" || current?.phase === "cancelling") {
          return { apply: false, reason: "cancelled", job: current };
        }
        return {
          apply: true,
          reason: "background-running",
          job: {
            ...current,
            status: "running",
            phase: "background",
            pid: 12345
          }
        };
      });
      assert.equal(resurrect.applied, false);
      assert.equal(readJobFile(cwd, jobId).status, "cancelled");
      assert.equal(readJobFile(cwd, jobId).pid, null);
      assert.equal(listJobs(cwd).find((job) => job.id === jobId).status, "cancelled");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("trackChildProcessIdentity rejects cancelling jobs so spawn path can kill orphans", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const base = {
        id: "track-reject",
        status: "running",
        phase: "cancelling",
        cancelRequestedAt: new Date().toISOString(),
        mode: "analyze",
        pid: null
      };
      writeJobFile(cwd, base.id, base);
      upsertJob(cwd, base);
      assert.throws(
        () => trackChildProcessIdentity(cwd, base.id, {
          pid: 777,
          processStartTime: "Mon Jan  1 00:00:00 2026",
          processGroup: true
        }),
        (error) => error.code === "CLAUDE_ROUTER_TRACK_REJECTED" && error.trackReason === "cancelling"
      );
      assert.equal(readJobFile(cwd, base.id).pid, null);
      assert.equal(readJobFile(cwd, base.id).phase, "cancelling");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

/**
 * Spawn a short-lived child, capture its start-time identity while alive, then kill it.
 * Used to build a dead-but-once-real process record for stale-job tests.
 */
async function spawnDeadChildRecord() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: ["ignore", "ignore", "ignore"]
  });
  const pid = child.pid;
  assert.ok(Number.isFinite(pid), "spawned child must have a pid");
  // Capture start identity while the process is still running.
  const record = buildProcessRecord(pid);
  child.kill("SIGKILL");
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  return { pid: record.pid, processStartTime: record.processStartTime ?? null };
}

test("refreshStaleActiveJobs does not stale-mark when child is dead but companion is live", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const deadChild = await spawnDeadChildRecord();
    const companion = currentProcessRecord();
    const job = {
      id: "stale-race-live-companion",
      status: "running",
      phase: "running",
      mode: "analyze",
      pid: deadChild.pid,
      processStartTime: deadChild.processStartTime,
      processGroup: true,
      companionPid: companion.pid,
      companionProcessStartTime: companion.processStartTime
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    refreshStaleActiveJobs(cwd);

    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "running", "live companion must prevent failed/stale-process discard");
    assert.notEqual(stored.phase, "stale-process");
    assert.equal(stored.pid, deadChild.pid);
    assert.equal(listJobs(cwd).find((entry) => entry.id === job.id).status, "running");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("refreshStaleActiveJobs marks stale when both child and companion are dead", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const deadChild = await spawnDeadChildRecord();
    const deadCompanion = await spawnDeadChildRecord();
    assert.notEqual(deadChild.pid, deadCompanion.pid);
    const job = {
      id: "stale-both-dead",
      status: "running",
      phase: "running",
      mode: "analyze",
      pid: deadChild.pid,
      processStartTime: deadChild.processStartTime,
      processGroup: true,
      companionPid: deadCompanion.pid,
      companionProcessStartTime: deadCompanion.processStartTime
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    refreshStaleActiveJobs(cwd);

    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.phase, "stale-process");
    assert.equal(stored.pid, null);
    assert.equal(stored.companionPid, null);
    assert.equal(stored.companionProcessStartTime, null);
    assert.match(String(stored.result?.error ?? ""), /stale/i);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("refreshStaleActiveJobs still stale-marks background jobs with dead pid (no companion)", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const deadChild = await spawnDeadChildRecord();
    const job = {
      id: "stale-background-no-companion",
      status: "running",
      phase: "background",
      mode: "analyze",
      pid: deadChild.pid,
      processStartTime: deadChild.processStartTime,
      processGroup: true
      // no companionPid — background / self-tracked job
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    refreshStaleActiveJobs(cwd);

    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.phase, "stale-process");
    assert.equal(stored.pid, null);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});
