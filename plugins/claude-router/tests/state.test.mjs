import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./helpers.mjs";
import { buildProcessRecord, currentProcessRecord } from "../scripts/lib/process.mjs";
import {
  ensureStateDir,
  listJobs,
  loadState,
  readJobFile,
  readJobRecord,
  resolveJobFile,
  resolveLockFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  transitionJob,
  updateState,
  upsertJob,
  writeJobFile
} from "../scripts/lib/state.mjs";
import {
  ACTIVE_JOB_STATUSES,
  appendLogLine,
  createJobLogFile,
  isCancelInProgress,
  runTrackedJob,
  trackChildProcessIdentity
} from "../scripts/lib/tracked-jobs.mjs";
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
    const env = {
      ...process.env,
      CLAUDE_ROUTER_DATA: dataDir,
      // Full-suite parallel load can delay unlucky waiters past the 5s default.
      CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS: "60000"
    };
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

test("concurrent stale-lock recovery via reaper retains every mutation", async () => {
  // ABA/TOCTOU: many processes race to recover one dead main lock. Reaper serializes
  // unlink so a fresh lock cannot be deleted by a delayed recoverer.
  const processCount = 8;
  const iterations = 4;
  const workerDir = makeTempDir();
  const workerScript = path.join(workerDir, "reap-recover-worker.mjs");
  fs.writeFileSync(workerScript, `import { upsertJob } from ${JSON.stringify(STATE_MODULE)};
const cwd = process.argv[2];
const id = process.argv[3];
upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
process.stdout.write(\`ok:\${id}\`);
`, "utf8");

  try {
    for (let round = 0; round < iterations; round += 1) {
      const dataDir = makeTempDir();
      const cwd = makeTempDir();
      try {
        withDataDir(dataDir, () => {
          ensureStateDir(cwd);
          const lockFile = resolveLockFile(cwd);
          // Abandoned main lock from a dead pid (identity-stale, not age-dependent).
          fs.writeFileSync(
            lockFile,
            `${JSON.stringify({
              pid: 999999991,
              processStartTime: "Mon Jan  1 00:00:00 2000",
              createdAt: Date.now() - 60_000
            })}\n`,
            { encoding: "utf8", mode: 0o600 }
          );
        });

        const env = {
          ...process.env,
          CLAUDE_ROUTER_DATA: dataDir,
          CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS: "60000"
        };
        const results = await Promise.all(
          Array.from({ length: processCount }, (_, index) => {
            const id = `reap-r${round}-j${String(index).padStart(2, "0")}`;
            return runWorker(workerScript, [cwd, id], env).then((result) => ({ id, ...result }));
          })
        );

        for (const result of results) {
          assert.equal(result.code, 0, `round ${round} worker ${result.id} failed: ${result.stderr || result.stdout}`);
        }

        withDataDir(dataDir, () => {
          const jobs = listJobs(cwd);
          assert.equal(jobs.length, processCount, `round ${round}: expected ${processCount} jobs, got ${jobs.length}`);
          const indexedIds = new Set(jobs.map((job) => job.id));
          for (let index = 0; index < processCount; index += 1) {
            const id = `reap-r${round}-j${String(index).padStart(2, "0")}`;
            assert.ok(indexedIds.has(id), `round ${round}: missing job ${id}`);
          }
          const stateDir = resolveStateDir(cwd);
          assert.ok(!fs.existsSync(resolveLockFile(cwd)), "main lock must be released");
          assert.ok(!fs.existsSync(`${resolveLockFile(cwd)}.reap`), "reaper lock must not remain");
          const stateNames = fs.readdirSync(stateDir).filter((name) => name === "state.json" || name.startsWith("state.json."));
          assert.equal(stateNames.filter((name) => name === "state.json").length, 1, "exactly one state.json");
          assert.ok(fs.existsSync(resolveStateFile(cwd)));
          // No leftover temp or split index files from concurrent writers.
          assert.equal(
            stateNames.filter((name) => name !== "state.json").length,
            0,
            `unexpected state sidecars: ${stateNames.join(",")}`
          );
        });
      } finally {
        cleanupDir(dataDir);
        cleanupDir(cwd);
      }
    }
  } finally {
    cleanupDir(workerDir);
  }
});

test("commit ownership verification retries after lock steal mid-mutate", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      ensureStateDir(cwd);
      let mutateCalls = 0;
      const state = updateState(cwd, (draft) => {
        mutateCalls += 1;
        if (mutateCalls === 1) {
          // Sabotage: drop our held lock and plant a foreign dead identity.
          const lockFile = resolveLockFile(cwd);
          try {
            fs.unlinkSync(lockFile);
          } catch {
            // ignore
          }
          fs.writeFileSync(
            lockFile,
            `${JSON.stringify({
              pid: 999999992,
              processStartTime: "Tue Jan  2 00:00:00 2001",
              createdAt: Date.now() - 60_000
            })}\n`,
            { flag: "wx", encoding: "utf8", mode: 0o600 }
          );
        }
        draft.jobs.unshift({
          id: "commit-verify-job",
          status: "completed",
          mode: "analyze",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
      assert.equal(mutateCalls, 2, "mutate must re-run exactly once after lock-lost retry");
      assert.equal(state.jobs.length, 1);
      assert.equal(state.jobs[0].id, "commit-verify-job");
      assert.equal(listJobs(cwd).length, 1);
      assert.ok(!fs.existsSync(resolveLockFile(cwd)));
      assert.ok(!fs.existsSync(`${resolveLockFile(cwd)}.reap`));
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("stale reaper lock is recovered then main lock is reaped", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      ensureStateDir(cwd);
      const lockFile = resolveLockFile(cwd);
      const reaperFile = `${lockFile}.reap`;
      const deadPayload = `${JSON.stringify({
        pid: 999999993,
        processStartTime: "Wed Jan  3 00:00:00 2002",
        createdAt: Date.now() - 60_000
      })}\n`;
      fs.writeFileSync(lockFile, deadPayload, { encoding: "utf8", mode: 0o600 });
      fs.writeFileSync(reaperFile, deadPayload, { encoding: "utf8", mode: 0o600 });
      // Age the reaper mtime past the short reaper backstop (covers malformed path too).
      const old = new Date(Date.now() - 10_000);
      fs.utimesSync(reaperFile, old, old);

      const state = updateState(cwd, (draft) => {
        draft.jobs.unshift({
          id: "reaper-stale-job",
          status: "completed",
          mode: "analyze",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
      assert.equal(state.jobs.length, 1);
      assert.equal(state.jobs[0].id, "reaper-stale-job");
      assert.ok(!fs.existsSync(lockFile), "main lock released");
      assert.ok(!fs.existsSync(reaperFile), "stale reaper must be cleared");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("lock ownership lost on every attempt exhausts retries without writing state", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      ensureStateDir(cwd);
      const stateFile = resolveStateFile(cwd);
      assert.ok(!fs.existsSync(stateFile), "precondition: no state.json yet");
      let mutateCalls = 0;
      assert.throws(
        () => {
          updateState(cwd, (draft) => {
            mutateCalls += 1;
            // Steal on every invocation so commit verification always fails.
            const lockFile = resolveLockFile(cwd);
            try {
              fs.unlinkSync(lockFile);
            } catch {
              // ignore
            }
            fs.writeFileSync(
              lockFile,
              `${JSON.stringify({
                pid: 999999994,
                processStartTime: `steal-${mutateCalls}-Mon Jan  1 00:00:00 1999`,
                createdAt: Date.now() - 60_000
              })}\n`,
              { flag: "wx", encoding: "utf8", mode: 0o600 }
            );
            draft.jobs.unshift({
              id: "must-not-commit",
              status: "completed",
              mode: "analyze",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          });
        },
        (error) =>
          error instanceof Error &&
          /lock ownership lost during commit after 3 attempts/i.test(error.message)
      );
      assert.equal(mutateCalls, 3, "mutate must run once per exhausted attempt");
      assert.ok(!fs.existsSync(stateFile), "no partial state.json write on lock-lost exhaustion");
      assert.equal(listJobs(cwd).length, 0);
    });
  } finally {
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

test("MAX_JOBS retention never prunes running jobs older than terminal overflow", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const runningId = "active-running-old";
      // Insert first so its updatedAt is older than the terminal flood below.
      upsertJob(cwd, {
        id: runningId,
        status: "running",
        phase: "running",
        mode: "analyze",
        summary: runningId
      });
      writeJobFile(cwd, runningId, { id: runningId, status: "running", phase: "running" });

      for (let index = 0; index < 55; index += 1) {
        const id = `terminal-${String(index).padStart(2, "0")}`;
        upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
        writeJobFile(cwd, id, { id, status: "completed" });
      }

      const jobs = listJobs(cwd);
      const indexed = jobs.find((job) => job.id === runningId);
      assert.ok(indexed, "running job must remain in the index under terminal overflow");
      assert.equal(indexed.status, "running");
      assert.ok(fs.existsSync(resolveJobFile(cwd, runningId)), "running job file must not be deleted");
      assert.ok(readJobFile(cwd, runningId), "running job file must still be readable");

      const terminal = jobs.filter((job) => job.status === "completed");
      assert.equal(terminal.length, 50, "terminal records must still be capped at MAX_JOBS");
      assert.ok(!jobs.some((job) => job.id === "terminal-00"), "oldest terminal index entry must be pruned");
      assert.ok(jobs.some((job) => job.id === "terminal-54"), "newest terminal must be retained");
      assert.equal(readJobFile(cwd, "terminal-00"), null, "oldest terminal job file must be cleaned up");
      assert.ok(readJobFile(cwd, "terminal-54"), "newest terminal job file must remain");
      assert.equal(jobs.length, 51, "1 active + MAX_JOBS terminal");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("MAX_JOBS retention does not cap active jobs", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      for (let index = 0; index < 60; index += 1) {
        const id = `active-${String(index).padStart(2, "0")}`;
        const status = index % 2 === 0 ? "queued" : "running";
        upsertJob(cwd, { id, status, phase: status, mode: "analyze", summary: id });
        writeJobFile(cwd, id, { id, status, phase: status });
      }
      const jobs = listJobs(cwd);
      assert.equal(jobs.length, 60, "all active jobs must be retained with no cap");
      for (let index = 0; index < 60; index += 1) {
        const id = `active-${String(index).padStart(2, "0")}`;
        assert.ok(jobs.some((job) => job.id === id), `missing active job ${id}`);
        assert.ok(fs.existsSync(resolveJobFile(cwd, id)), `missing job file for ${id}`);
      }
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("MAX_JOBS retention treats ACTIVE_JOB_STATUSES as non-prunable (drift pin)", () => {
  // state.mjs keeps a private copy of active statuses to avoid a tracked-jobs import cycle.
  // This pins both definitions functionally equal without reading state internals.
  assert.ok(ACTIVE_JOB_STATUSES.size > 0, "ACTIVE_JOB_STATUSES must export at least one status");

  for (const status of ACTIVE_JOB_STATUSES) {
    const dataDir = makeTempDir();
    const cwd = makeTempDir();
    try {
      withDataDir(dataDir, () => {
        const activeId = `active-${status}-old`;
        upsertJob(cwd, {
          id: activeId,
          status,
          phase: status,
          mode: "analyze",
          summary: activeId
        });
        writeJobFile(cwd, activeId, { id: activeId, status, phase: status });

        for (let index = 0; index < 55; index += 1) {
          const id = `terminal-${status}-${String(index).padStart(2, "0")}`;
          upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
          writeJobFile(cwd, id, { id, status: "completed" });
        }

        const jobs = listJobs(cwd);
        const indexed = jobs.find((job) => job.id === activeId);
        assert.ok(indexed, `status ${status} job must survive terminal overflow`);
        assert.equal(indexed.status, status);
        assert.ok(fs.existsSync(resolveJobFile(cwd, activeId)), `status ${status} job file must remain`);
        assert.ok(readJobFile(cwd, activeId), `status ${status} job file must be readable`);
      });
    } finally {
      cleanupDir(dataDir);
      cleanupDir(cwd);
    }
  }

  // Made-up terminal-ish status must remain prunable (not silently treated as active).
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const fakeId = "fake-terminal-ish-old";
      const fakeStatus = "finished-ish";
      assert.ok(
        !ACTIVE_JOB_STATUSES.has(fakeStatus),
        "test status must not be in ACTIVE_JOB_STATUSES"
      );
      upsertJob(cwd, {
        id: fakeId,
        status: fakeStatus,
        phase: fakeStatus,
        mode: "analyze",
        summary: fakeId
      });
      writeJobFile(cwd, fakeId, { id: fakeId, status: fakeStatus, phase: fakeStatus });

      for (let index = 0; index < 55; index += 1) {
        const id = `terminal-fake-${String(index).padStart(2, "0")}`;
        upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
        writeJobFile(cwd, id, { id, status: "completed" });
      }

      const jobs = listJobs(cwd);
      assert.ok(!jobs.some((job) => job.id === fakeId), "made-up terminal-ish status must be prunable");
      assert.equal(readJobFile(cwd, fakeId), null, "made-up terminal-ish job file must be cleaned up");
      assert.ok(jobs.some((job) => job.id === "terminal-fake-54"), "newest terminal must remain");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("MAX_JOBS retention never prunes cancelling jobs older than terminal overflow", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const cancellingId = "active-cancelling-old";
      // Insert first so its updatedAt is older than the terminal flood below.
      upsertJob(cwd, {
        id: cancellingId,
        status: "running",
        phase: "cancelling",
        cancelRequestedAt: new Date(Date.now() - 86_400_000).toISOString(),
        mode: "analyze",
        summary: cancellingId
      });
      writeJobFile(cwd, cancellingId, {
        id: cancellingId,
        status: "running",
        phase: "cancelling",
        cancelRequestedAt: new Date(Date.now() - 86_400_000).toISOString()
      });

      for (let index = 0; index < 55; index += 1) {
        const id = `terminal-cancel-${String(index).padStart(2, "0")}`;
        upsertJob(cwd, { id, status: "completed", mode: "analyze", summary: id });
        writeJobFile(cwd, id, { id, status: "completed" });
      }

      const jobs = listJobs(cwd);
      const indexed = jobs.find((job) => job.id === cancellingId);
      assert.ok(indexed, "cancelling job must remain in the index under terminal overflow");
      assert.equal(indexed.status, "running");
      assert.equal(indexed.phase, "cancelling");
      assert.ok(fs.existsSync(resolveJobFile(cwd, cancellingId)), "cancelling job file must not be deleted");
      assert.ok(readJobFile(cwd, cancellingId), "cancelling job file must still be readable");

      const terminal = jobs.filter((job) => job.status === "completed");
      assert.equal(terminal.length, 50, "terminal records must still be capped at MAX_JOBS");
      assert.ok(!jobs.some((job) => job.id === "terminal-cancel-00"), "oldest terminal index entry must be pruned");
      assert.ok(jobs.some((job) => job.id === "terminal-cancel-54"), "newest terminal must be retained");
      assert.equal(jobs.length, 51, "1 cancelling + MAX_JOBS terminal");
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

test("runTrackedJob completes when log directory is removed mid-run", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const logDir = path.join(dataDir, "volatile-logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "mid-run.log");
    fs.writeFileSync(logFile, "", "utf8");

    const job = {
      id: "log-sink-mid-run",
      workspaceRoot: cwd,
      status: "queued",
      phase: "queued",
      mode: "analyze",
      logFile
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    const result = await runTrackedJob(job, async () => {
      fs.rmSync(logDir, { recursive: true, force: true });
      appendLogLine(logFile, "progress after log dir removed");
      appendLogLine(logFile, "second progress chunk");
      return {
        exitStatus: 0,
        jobStatus: "completed",
        payload: { ok: true },
        rendered: "done-despite-log-failure",
        warnings: []
      };
    });

    assert.equal(result.status, "completed");
    assert.equal(result.rendered, "done-despite-log-failure");
    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "completed");
    assert.equal(stored.phase, "done");
    assert.ok(stored.completedAt);
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

test("runTrackedJob catch path commits failed terminal state when log writes fail", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const logFile = path.join(dataDir, "missing-parent", "catch-path.log");
    const job = {
      id: "log-sink-catch",
      workspaceRoot: cwd,
      status: "queued",
      phase: "queued",
      mode: "analyze",
      logFile
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    const result = await runTrackedJob(job, async () => {
      throw new Error("runner exploded after bad log sink");
    });

    assert.equal(result.status, "failed");
    assert.equal(result.phase, "failed");
    assert.match(result.result?.error ?? "", /runner exploded/);
    const stored = readJobFile(cwd, job.id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.phase, "failed");
    assert.ok(stored.completedAt);
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

test("appendLogLine does not throw on missing parent and short-circuits after failure", () => {
  const missing = path.join(makeTempDir(), "no-such-dir", "job.log");
  assert.doesNotThrow(() => appendLogLine(missing, "first line"));
  assert.doesNotThrow(() => appendLogLine(missing, "second line"));
  assert.doesNotThrow(() => appendLogLine(null, "ignored"));
  assert.doesNotThrow(() => appendLogLine("", "ignored"));
});

test("createJobLogFile on unwritable sink returns without throwing and runTrackedJob still commits", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    // No jobs directory under state; createJobLogFile must not throw.
    let logFile;
    assert.doesNotThrow(() => {
      logFile = createJobLogFile(cwd, "create-fail-job", "Claude analyze");
    });
    assert.ok(typeof logFile === "string" && logFile.length > 0);
    assert.equal(fs.existsSync(logFile), false);

    const job = {
      id: "create-fail-job",
      workspaceRoot: cwd,
      status: "queued",
      phase: "queued",
      mode: "analyze",
      logFile
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    const result = await runTrackedJob(job, async () => {
      appendLogLine(logFile, "progress with failed sink");
      return {
        exitStatus: 0,
        jobStatus: "completed",
        payload: { ok: true },
        rendered: "terminal-ok",
        warnings: []
      };
    });

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

function listCorruptSidecars(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => name.includes(".corrupt-"));
}

test("corrupt state.json with readable job files reconstructs index and save keeps job files", () => {
  // Pre-fix: loadState swallowed parse errors as empty state; the next save then
  // treated previousJobs as [] and deleted every per-job file not in the empty view.
  // Post-fix: quarantine + rebuild from jobs/, and save retains reconstructed ids.
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      ensureStateDir(cwd);
      const jobA = {
        id: "recover-a",
        status: "completed",
        updatedAt: "2026-01-01T00:00:00.000Z",
        mode: "analyze",
        summary: "a"
      };
      const jobB = {
        id: "recover-b",
        status: "running",
        updatedAt: "2026-01-02T00:00:00.000Z",
        mode: "implement",
        phase: "running"
      };
      writeJobFile(cwd, jobA.id, jobA);
      writeJobFile(cwd, jobB.id, jobB);

      const stateFile = resolveStateFile(cwd);
      fs.writeFileSync(stateFile, "{ not-json !!\n", { encoding: "utf8", mode: 0o600 });
      assert.ok(fs.existsSync(stateFile));

      const loaded = loadState(cwd);
      assert.equal(loaded.version, 1);
      assert.ok(Array.isArray(loaded.jobs));
      assert.equal(loaded.jobs.length, 2, "reconstructed index must include readable job files");
      const byId = new Map(loaded.jobs.map((job) => [job.id, job]));
      assert.ok(byId.has("recover-a"));
      assert.ok(byId.has("recover-b"));
      assert.equal(byId.get("recover-a").status, "completed");
      assert.equal(byId.get("recover-b").status, "running");
      assert.equal(byId.get("recover-a").updatedAt, jobA.updatedAt);
      assert.equal(byId.get("recover-b").updatedAt, jobB.updatedAt);

      assert.ok(!fs.existsSync(stateFile), "corrupt state.json must be quarantined aside");
      const stateDir = resolveStateDir(cwd);
      const corruptSidecars = listCorruptSidecars(stateDir).filter((name) => name.startsWith("state.json.corrupt-"));
      assert.equal(corruptSidecars.length, 1, "expected one state.json.corrupt-* sidecar");

      // Next save must not delete reconstructed jobs' per-job files (pre-fix silent loss).
      saveState(cwd, loaded);
      assert.ok(fs.existsSync(resolveJobFile(cwd, "recover-a")), "job file recover-a must survive save");
      assert.ok(fs.existsSync(resolveJobFile(cwd, "recover-b")), "job file recover-b must survive save");
      assert.ok(readJobFile(cwd, "recover-a"));
      assert.ok(readJobFile(cwd, "recover-b"));
      assert.equal(listJobs(cwd).length, 2);
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("corrupt state.json with no job files returns default state and quarantines", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      ensureStateDir(cwd);
      const stateFile = resolveStateFile(cwd);
      fs.writeFileSync(stateFile, "<<<corrupt>>>", { encoding: "utf8", mode: 0o600 });

      const loaded = loadState(cwd);
      assert.deepEqual(loaded, { version: 1, config: {}, jobs: [] });
      assert.ok(!fs.existsSync(stateFile), "corrupt state.json must be renamed aside");
      const corruptSidecars = listCorruptSidecars(resolveStateDir(cwd)).filter((name) =>
        name.startsWith("state.json.corrupt-")
      );
      assert.equal(corruptSidecars.length, 1);
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});

test("corrupt per-job file: readJobFile returns null and quarantines; transitionJob uses index", () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  try {
    withDataDir(dataDir, () => {
      const jobId = "corrupt-job-file";
      const indexJob = {
        id: jobId,
        status: "running",
        phase: "running",
        mode: "analyze",
        summary: "from-index"
      };
      upsertJob(cwd, indexJob);
      // Overwrite the job file with garbage after a valid index entry exists.
      const jobFile = resolveJobFile(cwd, jobId);
      fs.writeFileSync(jobFile, "{ bad json", { encoding: "utf8", mode: 0o600 });

      assert.equal(readJobFile(cwd, jobId), null, "corrupt job file must not throw");
      assert.ok(!fs.existsSync(jobFile), "corrupt job file must be quarantined");
      const jobsDir = path.dirname(jobFile);
      const corruptSidecars = listCorruptSidecars(jobsDir).filter((name) =>
        name.startsWith(`${jobId}.json.corrupt-`)
      );
      assert.equal(corruptSidecars.length, 1);

      // Index fall-through still works for record reads and transitions.
      const record = readJobRecord(cwd, jobId);
      assert.ok(record, "readJobRecord must fall through to index after quarantine");
      assert.equal(record.id, jobId);
      assert.equal(record.status, "running");

      const result = transitionJob(cwd, jobId, (current) => {
        assert.ok(current, "transitionJob must resolve via index when job file is corrupt");
        assert.equal(current.id, jobId);
        assert.equal(current.status, "running");
        return {
          apply: true,
          reason: "mark-completed",
          job: {
            ...current,
            status: "completed",
            phase: "completed"
          }
        };
      });
      assert.equal(result.applied, true);
      assert.equal(result.job.status, "completed");
      assert.equal(readJobFile(cwd, jobId)?.status, "completed");
      assert.equal(listJobs(cwd).find((job) => job.id === jobId)?.status, "completed");
    });
  } finally {
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
});
