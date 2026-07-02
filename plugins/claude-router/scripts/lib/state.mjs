import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const MAX_JOBS = 50;
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";

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

export function resolveJobFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true, mode: 0o700 });
}

export function loadState(cwd) {
  const file = resolveStateFile(cwd);
  if (!fs.existsSync(file)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: parsed.config ?? {},
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
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

export function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const retained = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (!retained.has(job.id)) {
      removeIfExists(resolveJobFile(cwd, job.id));
      removeIfExists(job.logFile);
    }
  }
  const nextState = { version: STATE_VERSION, config: state.config ?? {}, jobs: nextJobs };
  writeJsonAtomic(resolveStateFile(cwd), nextState);
  return nextState;
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
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
  const file = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
