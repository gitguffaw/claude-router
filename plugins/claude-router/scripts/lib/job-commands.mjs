import { terminateProcessTree, verifyProcessRecord } from "./process.mjs";
import { readFullJob, resolveJob, sortJobsNewestFirst } from "./job-control.mjs";
import { renderJobStatus, renderStatusReport, renderStoredJobResult } from "./render.mjs";
import { listJobs, transitionJob } from "./state.mjs";
import { cancelledJobResult, isActiveJobStatus, isCancelInProgress, nowIso, TERMINAL_JOB_STATUSES } from "./tracked-jobs.mjs";

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
}

function staleJobPayload(job, verification) {
  return {
    ...job,
    status: "failed",
    phase: "stale-process",
    pid: null,
    companionPid: null,
    companionProcessStartTime: null,
    completedAt: nowIso(),
    result: { error: `Recorded process is stale: ${verification.reason}` },
    processVerification: verification
  };
}

/**
 * Mark active jobs whose recorded process identity is gone as failed/stale-process.
 * Foreground managed jobs (finite companionPid) skip stale-marking while the
 * companion is still alive so concurrent status cannot discard a pending runner commit.
 * Exported for tests.
 */
export function refreshStaleActiveJobs(cwd) {
  const allowUnverified = process.platform === "win32";
  for (const job of listJobs(cwd)) {
    if (!isActiveJobStatus(job.status) || !Number.isFinite(job.pid)) {
      continue;
    }
    if (isCancelInProgress(job)) {
      continue;
    }
    const verification = verifyProcessRecord(
      { pid: job.pid, processStartTime: job.processStartTime ?? null },
      { allowUnverified }
    );
    if (verification.matches || verification.reason === "unverifiable") {
      continue;
    }
    // Live companion still owns the terminal commit; do not race it to failed/stale.
    if (Number.isFinite(job.companionPid)) {
      const companionVerification = verifyProcessRecord(
        { pid: job.companionPid, processStartTime: job.companionProcessStartTime ?? null },
        { allowUnverified }
      );
      if (companionVerification.matches || companionVerification.reason === "unverifiable") {
        continue;
      }
    }
    transitionJob(cwd, job.id, (current) => {
      if (!current || !isActiveJobStatus(current.status) || isCancelInProgress(current) || current.status === "cancelled") {
        return { apply: false, reason: "skip-stale", job: current };
      }
      if (!Number.isFinite(current.pid)) {
        return { apply: false, reason: "no-pid", job: current };
      }
      // Re-check identities under the lock so a pre-lock snapshot cannot stale-mark
      // a job whose child/companion record changed (runner commit, re-track, etc.).
      const currentVerification = verifyProcessRecord(
        { pid: current.pid, processStartTime: current.processStartTime ?? null },
        { allowUnverified }
      );
      if (currentVerification.matches || currentVerification.reason === "unverifiable") {
        return { apply: false, reason: "process-live", job: current };
      }
      if (Number.isFinite(current.companionPid)) {
        const companionVerification = verifyProcessRecord(
          { pid: current.companionPid, processStartTime: current.companionProcessStartTime ?? null },
          { allowUnverified }
        );
        if (companionVerification.matches || companionVerification.reason === "unverifiable") {
          return { apply: false, reason: "companion-live", job: current };
        }
      }
      return {
        apply: true,
        reason: "mark-stale",
        job: staleJobPayload(current, currentVerification)
      };
    });
  }
}

function parseNonNegativeNumber(value, defaultValue, label) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} "${value}". Use a non-negative millisecond value.`);
  }
  return parsed;
}

async function waitForJob(cwd, reference, options = {}) {
  const timeoutMs = parseNonNegativeNumber(options.timeoutMs, 240000, "timeout");
  const pollIntervalMs = Math.max(100, parseNonNegativeNumber(options.pollIntervalMs, 250, "poll interval"));
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

function finalizeCancelled(cwd, jobId, cancelSignal, extras = {}) {
  return transitionJob(cwd, jobId, (current) => {
    if (!current) {
      return { apply: false, reason: "missing" };
    }
    if (current.status === "cancelled") {
      return { apply: false, reason: "already-cancelled", job: current };
    }
    if (!isActiveJobStatus(current.status) && !isCancelInProgress(current)) {
      return { apply: false, reason: "not-active", job: current };
    }
    return {
      apply: true,
      reason: "finalize-cancelled",
      job: {
        ...current,
        ...extras,
        status: "cancelled",
        phase: "cancelled",
        pid: null,
        completedAt: nowIso(),
        cancelSignal,
        rendered: current.rendered ?? `# Claude Job Cancelled\n\nJob ${current.id} was cancelled.\n`
      }
    };
  });
}

function markCancelFailed(cwd, jobId, cancelSignal) {
  return transitionJob(cwd, jobId, (current) => {
    if (!current) {
      return { apply: false, reason: "missing" };
    }
    if (current.status === "cancelled" || TERMINAL_JOB_STATUSES.has(current.status)) {
      return { apply: false, reason: "terminal", job: current };
    }
    const {
      cancelRequestedAt: _releasedOwnership,
      ...rest
    } = current;
    return {
      apply: true,
      reason: "cancel-failed",
      job: {
        ...rest,
        status: "running",
        phase: "cancel-failed",
        cancelSignal,
        cancelFailedAt: nowIso()
        // Clear cancelRequestedAt so a later runner completion is not treated as cancelled.
      }
    };
  });
}

function processIdentityFromJob(job) {
  return {
    pid: job?.pid ?? Number.NaN,
    processStartTime: job?.processStartTime ?? null,
    processGroup: job?.processGroup
  };
}

export async function handleCancel(cwd, { reference = "", json = false, terminateProcessTreeImpl = terminateProcessTree } = {}) {
  if (!reference) {
    throw new Error("cancel requires a job id.");
  }
  const resolved = resolveJob(cwd, reference);

  // 1) Atomically claim cancellation ownership before any kill.
  //    Refuse without mutating ownership when the child identity is not yet recorded.
  const claim = transitionJob(cwd, resolved.id, (current) => {
    if (!current) {
      return { apply: false, reason: "missing" };
    }
    if (current.status === "cancelled") {
      return { apply: false, reason: "already-cancelled", job: current };
    }
    if (!isActiveJobStatus(current.status) && !isCancelInProgress(current)) {
      return { apply: false, reason: "not-active", job: current };
    }
    if (isCancelInProgress(current)) {
      return { apply: false, reason: "already-cancelling", job: current };
    }
    if (!Number.isFinite(current.pid)) {
      return { apply: false, reason: "missing-pid", job: current };
    }
    return {
      apply: true,
      reason: "claim-cancel",
      job: {
        ...current,
        phase: "cancelling",
        cancelRequestedAt: nowIso()
      }
    };
  });

  if (claim.reason === "missing") {
    throw new Error(`No Claude Router job found for "${reference}".`);
  }
  if (claim.reason === "already-cancelled") {
    const cancelled = cancelledJobResult(claim.job);
    output(json ? cancelled : `Cancelled Claude Router job ${cancelled.id}.\n`, json);
    return;
  }
  if (claim.reason === "not-active") {
    throw new Error(`Cannot cancel job ${resolved.id} because it is ${claim.job?.status}.`);
  }
  if (claim.reason === "missing-pid") {
    throw new Error(
      `Cannot cancel job ${resolved.id}: process is still starting (missing-pid). Retry after the job has a recorded process identity.`
    );
  }

  // already-cancelling reuses the existing ownership and claimed identity.
  const killTarget = processIdentityFromJob(claim.job);
  if (!Number.isFinite(killTarget.pid)) {
    throw new Error(
      `Cannot cancel job ${resolved.id}: process is still starting (missing-pid). Retry after the job has a recorded process identity.`
    );
  }

  // 2) Kill using the claimed identity snapshot (not a later re-read that may have cleared pid).
  const signal = await terminateProcessTreeImpl(killTarget, {
    allowUnverified: process.platform === "win32"
  });

  const reportCancelled = (job) => {
    const cancelled = cancelledJobResult(job);
    output(json ? cancelled : `Cancelled Claude Router job ${cancelled.id}.\n`, json);
  };

  // Runner may have already finalized cancelled after the child exited.
  const latestAfterKill = readFullJob(cwd, resolved.id);
  if (latestAfterKill?.status === "cancelled") {
    reportCancelled(latestAfterKill);
    return;
  }

  if (!signal.attempted) {
    const reason = signal.verification?.reason ?? "could not be verified";
    if (reason === "not-running" || reason === "missing-pid") {
      const finalized = finalizeCancelled(cwd, resolved.id, signal);
      reportCancelled(finalized.job ?? latestAfterKill);
      return;
    }
    if (reason === "pid-reused") {
      const afterReuse = readFullJob(cwd, resolved.id);
      if (afterReuse?.status === "cancelled") {
        reportCancelled(afterReuse);
        return;
      }
      transitionJob(cwd, resolved.id, (current) => {
        if (!current || current.status === "cancelled" || TERMINAL_JOB_STATUSES.has(current.status)) {
          return { apply: false, reason: "terminal", job: current };
        }
        return {
          apply: true,
          reason: "stale-on-cancel",
          job: {
            ...staleJobPayload(current, signal.verification),
            cancelSignal: signal
          }
        };
      });
      throw new Error(`Cannot cancel job ${resolved.id}: recorded process ${reason}.`);
    }
    markCancelFailed(cwd, resolved.id, signal);
    throw new Error(`Cannot cancel job ${resolved.id}: recorded process ${reason}.`);
  }

  if (signal.verification?.matches) {
    const afterMatch = readFullJob(cwd, resolved.id);
    if (afterMatch?.status === "cancelled") {
      reportCancelled(afterMatch);
      return;
    }
    markCancelFailed(cwd, resolved.id, signal);
    throw new Error(`Cannot confirm cancellation for job ${resolved.id}: process still appears to be running.`);
  }

  const finalized = finalizeCancelled(cwd, resolved.id, signal);
  // Idempotent if the runner already wrote cancelled.
  reportCancelled(finalized.job ?? claim.job);
}
