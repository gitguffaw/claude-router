import { terminateProcessTree } from "./process.mjs";
import { readFullJob, resolveJob, sortJobsNewestFirst } from "./job-control.mjs";
import { renderJobStatus, renderStatusReport, renderStoredJobResult } from "./render.mjs";
import { listJobs, upsertJob, writeJobFile } from "./state.mjs";
import { isActiveJobStatus } from "./tracked-jobs.mjs";

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
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
  const job = readFullJob(cwd, reference);
  output(json ? job : renderStoredJobResult(job), json);
}

export function handleCancel(cwd, { reference = "", json = false } = {}) {
  if (!reference) {
    throw new Error("cancel requires a job id.");
  }
  const job = readFullJob(cwd, reference);
  if (!isActiveJobStatus(job.status)) {
    throw new Error(`Cannot cancel job ${job.id} because it is ${job.status}.`);
  }
  const signal = terminateProcessTree(job.pid ?? Number.NaN);
  const cancelled = { ...job, status: "cancelled", phase: "cancelled", pid: null, completedAt: new Date().toISOString(), cancelSignal: signal };
  upsertJob(cwd, cancelled);
  writeJobFile(cwd, job.id, cancelled);
  output(json ? cancelled : `Cancelled Claude Router job ${job.id}.\n`, json);
}
