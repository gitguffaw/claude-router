import fs from "node:fs";
import { currentProcessRecord } from "./process.mjs";
import { readJobFile, resolveJobLogFile, transitionJob } from "./state.mjs";

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
export const TERMINAL_JOB_STATUSES = new Set(["completed", "completed-with-warnings", "blocked", "failed", "interrupted", "cancelled"]);

export function nowIso() {
  return new Date().toISOString();
}

export function isActiveJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(status);
}

export function isCancelInProgress(job) {
  return Boolean(job && (job.phase === "cancelling" || job.cancelRequestedAt));
}

function redactSecrets(value) {
  return String(value ?? "")
    .replace(/(ANTHROPIC_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(OPENAI_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1REDACTED")
    .replace(/(sk-ant-[A-Za-z0-9_-]{8,})/g, "sk-ant-REDACTED")
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "sk-REDACTED");
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", { encoding: "utf8", mode: 0o600 });
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function appendLogLine(logFile, message) {
  const text = redactSecrets(message).trim();
  if (!logFile || !text) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${text}\n`, "utf8");
}

export function cancelledJobResult(job) {
  return {
    ...job,
    rendered: job.rendered ?? `# Claude Job Cancelled\n\nJob ${job.id} was cancelled.\n`
  };
}

export function trackChildProcessIdentity(workspaceRoot, jobId, childRecord) {
  const transition = transitionJob(workspaceRoot, jobId, (current) => {
    if (!current) {
      return { apply: false, reason: "missing" };
    }
    if (current.status === "cancelled") {
      return { apply: false, reason: "cancelled", job: current };
    }
    if (TERMINAL_JOB_STATUSES.has(current.status)) {
      return { apply: false, reason: "terminal", job: current };
    }
    if (isCancelInProgress(current)) {
      // Cancel owns the lifecycle; caller must kill the just-spawned child.
      return { apply: false, reason: "cancelling", job: current };
    }
    return {
      apply: true,
      reason: "track-child",
      job: {
        ...current,
        status: "running",
        phase: current.phase === "background" ? "background" : "running",
        pid: childRecord.pid ?? null,
        processStartTime: childRecord.processStartTime ?? null,
        processGroup: Boolean(childRecord.processGroup)
      }
    };
  });

  if (transition.reason === "track-child" && transition.applied) {
    return transition.job;
  }

  const error = new Error(
    transition.reason === "cancelling" || transition.reason === "cancelled"
      ? `Job ${jobId} cancellation forbids process tracking (${transition.reason}).`
      : `Job ${jobId} is not accepting process tracking (${transition.reason}).`
  );
  error.code = "CLAUDE_ROUTER_TRACK_REJECTED";
  error.trackReason = transition.reason;
  error.job = transition.job;
  throw error;
}

function commitRunnerTerminal(workspaceRoot, jobId, terminalBuilder) {
  const transition = transitionJob(workspaceRoot, jobId, (current) => {
    if (!current) {
      return { apply: false, reason: "missing" };
    }
    if (current.status === "cancelled") {
      return { apply: false, reason: "cancelled", job: current };
    }
    if (isCancelInProgress(current)) {
      // Runner return under cancel ownership means the supervised child has exited.
      // Finalize cancelled now so index and job file match the caller result.
      return {
        apply: true,
        reason: "finalize-cancelled-from-runner",
        job: {
          ...current,
          status: "cancelled",
          phase: "cancelled",
          pid: null,
          completedAt: current.completedAt ?? nowIso(),
          rendered: current.rendered ?? `# Claude Job Cancelled\n\nJob ${current.id} was cancelled.\n`
        }
      };
    }
    if (TERMINAL_JOB_STATUSES.has(current.status)) {
      return { apply: false, reason: "terminal", job: current };
    }
    const terminal = terminalBuilder(current);
    return {
      apply: true,
      reason: "runner-terminal",
      job: {
        ...current,
        ...terminal,
        pid: null,
        completedAt: terminal.completedAt ?? nowIso()
      }
    };
  });

  if (transition.job?.status === "cancelled" || transition.reason === "cancelled" || transition.reason === "finalize-cancelled-from-runner") {
    return cancelledJobResult(transition.job);
  }
  if (transition.applied) {
    return transition.job;
  }
  if (transition.job) {
    return transition.job;
  }
  throw new Error(`Unable to commit terminal state for job ${jobId}: ${transition.reason}`);
}

export async function runTrackedJob(job, runner, options = {}) {
  const trackChildProcess = Boolean(options.trackChildProcess);
  const processRecord = currentProcessRecord({ processGroup: Boolean(options.processGroup) });
  const runningSeed = {
    ...job,
    status: "running",
    phase: "running",
    startedAt: nowIso(),
    // Foreground managed jobs cancel the Claude child tree, not the companion wrapper.
    pid: trackChildProcess ? null : processRecord.pid,
    processStartTime: trackChildProcess ? null : processRecord.processStartTime,
    processGroup: trackChildProcess ? false : processRecord.processGroup
  };
  if (trackChildProcess) {
    runningSeed.companionPid = processRecord.pid;
    runningSeed.companionProcessStartTime = processRecord.processStartTime;
  }

  const started = transitionJob(job.workspaceRoot, job.id, (current) => {
    if (current?.status === "cancelled" || isCancelInProgress(current)) {
      return { apply: false, reason: current.status === "cancelled" ? "cancelled" : "cancelling", job: current };
    }
    if (current && TERMINAL_JOB_STATUSES.has(current.status)) {
      return { apply: false, reason: "terminal", job: current };
    }
    return {
      apply: true,
      reason: "start-running",
      job: {
        ...(current ?? job),
        ...runningSeed,
        // Preserve background marker set by the launcher when present.
        phase: current?.phase === "background" ? "background" : "running"
      }
    };
  });
  if (started.job?.status === "cancelled" || isCancelInProgress(started.job)) {
    return cancelledJobResult(started.job);
  }
  if (!started.applied && started.job && TERMINAL_JOB_STATUSES.has(started.job.status)) {
    return started.job;
  }

  const updateProcess = (childRecord) => trackChildProcessIdentity(job.workspaceRoot, job.id, childRecord);

  try {
    const execution = await runner({ updateProcess });
    return commitRunnerTerminal(job.workspaceRoot, job.id, () => {
      const status = execution.jobStatus ?? (execution.exitStatus === 0 ? "completed" : "failed");
      return {
        status,
        phase: status === "completed" || status === "completed-with-warnings" ? "done" : status,
        result: execution.payload,
        rendered: execution.rendered,
        warnings: execution.warnings ?? [],
        claudeSessionId: execution.claudeSessionId ?? null
      };
    });
  } catch (error) {
    appendLogLine(job.logFile, error instanceof Error ? error.stack || error.message : String(error));
    return commitRunnerTerminal(job.workspaceRoot, job.id, () => ({
      status: "failed",
      phase: "failed",
      result: { error: error instanceof Error ? error.message : String(error) },
      rendered: `# Claude Job Failed\n\n${error instanceof Error ? error.message : String(error)}\n`
    }));
  }
}

export function readLogPreview(logFile, limit = 6) {
  if (!logFile || !fs.existsSync(logFile)) {
    return [];
  }
  return fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).slice(-limit);
}

export function readStoredJob(workspaceRoot, jobId) {
  return readJobFile(workspaceRoot, jobId);
}
