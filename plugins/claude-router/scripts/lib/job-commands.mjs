import { terminateProcessTree, verifyProcessRecord } from "./process.mjs";
import { readFullJob, resolveJob, sortJobsNewestFirst } from "./job-control.mjs";
import { renderJobStatus, renderStatusReport, renderStoredJobResult } from "./render.mjs";
import { listJobs, upsertJob, writeJobFile } from "./state.mjs";
import { isActiveJobStatus } from "./tracked-jobs.mjs";

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
}

function staleJobPayload(job, verification) {
  return {
    ...job,
    status: "failed",
    phase: "stale-process",
    pid: null,
    completedAt: new Date().toISOString(),
    result: { error: `Recorded process is stale: ${verification.reason}` },
    processVerification: verification
  };
}

function refreshStaleActiveJobs(cwd) {
  for (const job of listJobs(cwd)) {
    if (!isActiveJobStatus(job.status) || !Number.isFinite(job.pid)) {
      continue;
    }
    const verification = verifyProcessRecord(
      { pid: job.pid, processStartTime: job.processStartTime ?? null },
      { allowUnverified: process.platform === "win32" }
    );
    if (verification.matches || verification.reason === "unverifiable") {
      continue;
    }
    const stale = staleJobPayload(job, verification);
    upsertJob(cwd, stale);
    writeJobFile(cwd, job.id, stale);
  }
}

async function waitForJob(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 240000);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 250);
  const deadline = Date.now() + timeoutMs;
  let job = readFullJob(cwd, reference);
  while (isActiveJobStatus(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
    job = readFullJob(cwd, reference);
  }
  return { ...job, waitTimedOut: isActiveJobStatus(job.status) };
}

export async function handleStatus(cwd, { reference = "", json = false, wait = false, all = false, timeoutMs = null, pollIntervalMs = null } = {}) {
  refreshStaleActiveJobs(cwd);
  if (reference) {
    const job = wait ? await waitForJob(cwd, reference, { timeoutMs, pollIntervalMs }) : readFullJob(cwd, reference);
    output(json ? job : renderJobStatus(job), json);
    return;
  }
  if (wait) {
    throw new Error("status --wait requires a job id.");
  }
  const jobs = sortJobsNewestFirst(listJobs(cwd));
  const visibleJobs = all ? jobs : jobs.slice(0, 20);
  output(json ? { jobs: visibleJobs, truncated: !all && jobs.length > visibleJobs.length, total: jobs.length } : renderStatusReport(visibleJobs), json);
}

export function handleResult(cwd, { reference = "", json = false } = {}) {
  refreshStaleActiveJobs(cwd);
  const job = readFullJob(cwd, reference);
  output(json ? job : renderStoredJobResult(job), json);
}

export async function handleCancel(cwd, { reference = "", json = false, terminateProcessTreeImpl = terminateProcessTree } = {}) {
  if (!reference) {
    throw new Error("cancel requires a job id.");
  }
  const job = readFullJob(cwd, reference);
  if (!isActiveJobStatus(job.status)) {
    throw new Error(`Cannot cancel job ${job.id} because it is ${job.status}.`);
  }
  const signal = await terminateProcessTreeImpl(
    { pid: job.pid ?? Number.NaN, processStartTime: job.processStartTime ?? null, processGroup: job.processGroup },
    { allowUnverified: process.platform === "win32" }
  );
  if (!signal.attempted) {
    const stale = { ...staleJobPayload(job, signal.verification), cancelSignal: signal };
    upsertJob(cwd, stale);
    writeJobFile(cwd, job.id, stale);
    throw new Error(`Cannot cancel job ${job.id}: recorded process ${signal.verification?.reason ?? "could not be verified"}.`);
  }
  if (signal.verification?.matches) {
    const stillRunning = { ...job, phase: "cancel-failed", cancelSignal: signal };
    upsertJob(cwd, stillRunning);
    writeJobFile(cwd, job.id, stillRunning);
    throw new Error(`Cannot confirm cancellation for job ${job.id}: process still appears to be running.`);
  }
  const cancelled = { ...job, status: "cancelled", phase: "cancelled", pid: null, completedAt: new Date().toISOString(), cancelSignal: signal };
  upsertJob(cwd, cancelled);
  writeJobFile(cwd, job.id, cancelled);
  output(json ? cancelled : `Cancelled Claude Router job ${job.id}.\n`, json);
}
