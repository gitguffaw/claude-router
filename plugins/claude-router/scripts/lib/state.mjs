import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProcessRecord, getProcessStartTime } from "./process.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const MAX_JOBS = 50;
// Local copy of tracked-jobs ACTIVE_JOB_STATUSES — cannot import (cycle: tracked-jobs → state).
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const STATE_FILE_NAME = "state.json";
const LOCK_FILE_NAME = "state.lock";
const JOBS_DIR_NAME = "jobs";
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_STALE_MS = 10000;
const LOCK_POLL_MS = 15;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return { version: STATE_VERSION, config: {}, jobs: [] };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }
  const slug = (path.basename(workspaceRoot) || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const base = process.env.CLAUDE_ROUTER_DATA || process.env.CODEX_PLUGIN_DATA || path.join(os.tmpdir(), "claude-router");
  return path.join(base, "state", `${slug}-${hash}`);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveLockFile(cwd) {
  return path.join(resolveStateDir(cwd), LOCK_FILE_NAME);
}

export function resolveJobFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true, mode: 0o700 });
}

/**
 * Best-effort quarantine: rename corrupt file to `<file>.corrupt-<timestamp>`.
 * If rename fails, leave the original in place. Returns the quarantine path or null.
 */
function quarantineCorruptFile(file) {
  try {
    if (!file || !fs.existsSync(file)) {
      return null;
    }
    const dest = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, dest);
    return dest;
  } catch {
    return null;
  }
}

/**
 * Minimal index rebuild from per-job JSON files (id + status + updatedAt as present).
 * Unreadable job files are skipped (not quarantined here — readJobFile handles that).
 * Returns null when no readable job records are found.
 */
function reconstructStateFromJobFiles(cwd) {
  const jobsDir = resolveJobsDir(cwd);
  let names;
  try {
    names = fs.readdirSync(jobsDir);
  } catch {
    return null;
  }
  const jobs = [];
  for (const name of names) {
    // Job files are `<id>.json`. Quarantined names end with `.corrupt-<ts>` and are skipped.
    if (!name.endsWith(".json")) {
      continue;
    }
    const file = path.join(jobsDir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.id) {
        continue;
      }
      const entry = { id: parsed.id };
      if (parsed.status !== undefined) {
        entry.status = parsed.status;
      }
      if (parsed.updatedAt !== undefined) {
        entry.updatedAt = parsed.updatedAt;
      }
      jobs.push(entry);
    } catch {
      // Leave corrupt per-job files for the job-file read path to quarantine.
    }
  }
  if (jobs.length === 0) {
    return null;
  }
  return { version: STATE_VERSION, config: {}, jobs };
}

function normalizeState(parsed) {
  return {
    ...defaultState(),
    ...parsed,
    config: parsed.config ?? {},
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
  };
}

/**
 * Try to parse a per-job JSON file. On corrupt content: quarantine and return null.
 * Missing file also returns null. Shared by readJobFile / readJobRecord / transitionJob.
 */
function tryReadJobJson(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    quarantineCorruptFile(file);
    return null;
  }
}

export function loadState(cwd) {
  const file = resolveStateFile(cwd);
  if (!fs.existsSync(file)) {
    // After a prior quarantine the index file is gone; recover from job files if any.
    // Fresh workspaces with no state and no jobs still get default empty state.
    return reconstructStateFromJobFiles(cwd) ?? defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeState(parsed);
  } catch {
    // Fail-safe: never treat a corrupt index as empty (that permanently deletes job
    // files on the next save via saveStateUnlocked cleanup). Quarantine the corrupt
    // index, then rebuild a minimal jobs list from readable per-job files when present.
    // If nothing is recoverable, return default empty state (nothing to lose).
    quarantineCorruptFile(file);
    return reconstructStateFromJobFiles(cwd) ?? defaultState();
  }
}

function isNonPrunableJob(job) {
  if (!job) {
    return false;
  }
  // Cancel owns the lifecycle; never drop while cancelling even if status drifts.
  if (job.phase === "cancelling" || job.cancelRequestedAt) {
    return true;
  }
  return ACTIVE_JOB_STATUSES.has(job.status);
}

function pruneJobs(jobs) {
  // Retention caps only terminal records. Active/cancelling jobs are always kept
  // so a long-running process cannot lose its index entry, job file, or log.
  const active = [];
  const terminal = [];
  for (const job of jobs ?? []) {
    if (isNonPrunableJob(job)) {
      active.push(job);
    } else {
      terminal.push(job);
    }
  }
  terminal.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  return [...active, ...terminal.slice(0, MAX_JOBS)];
}

function removeIfExists(file) {
  if (file && fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function writeJsonAtomic(file, payload) {
  const tempFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempFile, file);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function lockTimeoutMs() {
  return positiveIntEnv("CLAUDE_ROUTER_STATE_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS);
}

function lockStaleMs() {
  return positiveIntEnv("CLAUDE_ROUTER_STATE_LOCK_STALE_MS", DEFAULT_LOCK_STALE_MS);
}

function readLockMeta(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable by this user.
    return Boolean(error && error.code === "EPERM");
  }
}

function lockOwnerStatus(meta) {
  const pid = Number(meta?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { hasOwner: false, live: false };
  }
  // Baseline owner existence is portable (including Windows). Start-time identity
  // is optional reuse detection where available; never treat lookup failure as dead.
  if (!isProcessAlive(pid)) {
    return { hasOwner: true, live: false };
  }

  const expectedStart = meta.processStartTime ?? null;
  if (expectedStart) {
    const currentStart = getProcessStartTime(pid);
    if (currentStart && currentStart !== expectedStart) {
      return { hasOwner: true, live: false };
    }
    // Missing/unavailable current start identity (Windows, transient ps failure):
    // fail safe and keep treating the existing PID as live.
  }
  return { hasOwner: true, live: true };
}

function isLockStale(lockFile, staleMs) {
  const now = Date.now();
  const meta = readLockMeta(lockFile);
  if (meta) {
    const owner = lockOwnerStatus(meta);
    if (owner.hasOwner) {
      // Live ownership always wins over createdAt/mtime age.
      return !owner.live;
    }
  }

  // Age/mtime only recovers malformed, missing-owner, or unverifiable abandoned locks.
  const createdAt = Number(meta?.createdAt);
  if (Number.isFinite(createdAt) && now - createdAt >= staleMs) {
    return true;
  }
  try {
    const stat = fs.statSync(lockFile);
    if (now - stat.mtimeMs >= staleMs) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function tryAcquireLock(lockFile, identity) {
  const payload = `${JSON.stringify({
    pid: identity.pid,
    processStartTime: identity.processStartTime,
    createdAt: Date.now()
  })}\n`;
  try {
    fs.writeFileSync(lockFile, payload, { flag: "wx", encoding: "utf8", mode: 0o600 });
    return true;
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function releaseLock(lockFile) {
  try {
    const meta = readLockMeta(lockFile);
    if (meta && Number(meta.pid) !== process.pid) {
      return;
    }
    fs.unlinkSync(lockFile);
  } catch {
    // Best-effort release; next acquirer can recover stale locks.
  }
}

function withStateLock(cwd, fn) {
  ensureStateDir(cwd);
  const lockFile = resolveLockFile(cwd);
  const timeoutMs = lockTimeoutMs();
  const staleMs = lockStaleMs();
  const startedAt = Date.now();
  // Resolve holder identity once per acquisition attempt; poll retries reuse it.
  const identity = buildProcessRecord(process.pid);
  let acquired = false;

  while (!acquired) {
    if (tryAcquireLock(lockFile, identity)) {
      acquired = true;
      break;
    }
    if (isLockStale(lockFile, staleMs)) {
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Another process may have recovered the lock first.
      }
      continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for Claude Router state lock at ${lockFile}`);
    }
    sleepMs(LOCK_POLL_MS);
  }

  try {
    return fn();
  } finally {
    releaseLock(lockFile);
  }
}

function saveStateUnlocked(cwd, state) {
  // Load the live index under the caller-held lock so cleanup never uses a
  // stale snapshot from before concurrent writers finished.
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const retained = new Set(nextJobs.map((job) => job.id).filter(Boolean));
  const nextState = { version: STATE_VERSION, config: state.config ?? {}, jobs: nextJobs };
  writeJsonAtomic(resolveStateFile(cwd), nextState);
  for (const job of previousJobs) {
    if (!job?.id || retained.has(job.id)) {
      continue;
    }
    removeIfExists(resolveJobFile(cwd, job.id));
    removeIfExists(job.logFile);
  }
  return nextState;
}

export function saveState(cwd, state) {
  return withStateLock(cwd, () => saveStateUnlocked(cwd, state));
}

export function updateState(cwd, mutate) {
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    mutate(state);
    return saveStateUnlocked(cwd, state);
  });
}

export function generateJobId(prefix = "claude") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function upsertJob(cwd, patch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    if (index === -1) {
      state.jobs.unshift({ createdAt: timestamp, updatedAt: timestamp, ...patch });
    } else {
      state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: timestamp };
    }
  });
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const file = resolveJobFile(cwd, jobId);
  writeJsonAtomic(file, payload);
  return file;
}

export function readJobFile(cwd, jobId) {
  // Missing or corrupt per-job JSON both return null (callers treat as missing).
  // Corrupt files are quarantined once so they are not reparsed forever.
  return tryReadJobJson(resolveJobFile(cwd, jobId));
}

function readJobRecordUnlocked(cwd, jobId) {
  const fileJob = tryReadJobJson(resolveJobFile(cwd, jobId));
  if (fileJob) {
    return fileJob;
  }
  // Fall through to index copy when the job file is missing or was quarantined.
  return loadState(cwd).jobs.find((job) => job.id === jobId) ?? null;
}

/**
 * Conditionally transition one job under the workspace state lock.
 * decide(currentJob|null) must return:
 *   { apply: false, reason?: string, job?: object } or
 *   { apply: true, reason?: string, job: object }
 * On apply, both the state index and per-job file are written before unlock.
 */
export function transitionJob(cwd, jobId, decide) {
  if (!jobId) {
    throw new Error("transitionJob requires a job id.");
  }
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    const index = state.jobs.findIndex((job) => job.id === jobId);
    const indexJob = index >= 0 ? state.jobs[index] : null;
    const file = resolveJobFile(cwd, jobId);
    // Same quarantine path as readJobFile; fall through to index on corrupt/missing.
    const fileJob = tryReadJobJson(file);
    const current = fileJob ?? indexJob ?? null;
    const decision = decide(current ? { ...current } : null) ?? { apply: false, reason: "no-decision" };
    if (!decision.apply) {
      return {
        applied: false,
        reason: decision.reason ?? "rejected",
        job: decision.job ?? current,
        previous: current
      };
    }
    if (!decision.job || typeof decision.job !== "object") {
      throw new Error("transitionJob apply decision requires a job object.");
    }
    const timestamp = nowIso();
    const next = {
      ...decision.job,
      id: jobId,
      createdAt: decision.job.createdAt ?? current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (index === -1) {
      state.jobs.unshift(next);
    } else {
      state.jobs[index] = next;
    }
    ensureStateDir(cwd);
    writeJsonAtomic(file, next);
    saveStateUnlocked(cwd, state);
    return {
      applied: true,
      reason: decision.reason ?? "applied",
      job: next,
      previous: current
    };
  });
}

export function readJobRecord(cwd, jobId) {
  return readJobRecordUnlocked(cwd, jobId);
}
