import fs from "node:fs";
import { currentProcessRecord } from "./process.mjs";
import { readJobFile, resolveJobLogFile, upsertJob, writeJobFile } from "./state.mjs";

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
export const TERMINAL_JOB_STATUSES = new Set(["completed", "completed-with-warnings", "blocked", "failed", "interrupted", "cancelled"]);

export function nowIso() {
  return new Date().toISOString();
}

export function isActiveJobStatus(status) {
  return ACTIVE_JOB_STATUSES.has(status);
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

export async function runTrackedJob(job, runner, options = {}) {
  const processRecord = currentProcessRecord({ processGroup: Boolean(options.processGroup) });
  const running = {
    ...job,
    status: "running",
    phase: "running",
    startedAt: nowIso(),
    pid: processRecord.pid,
    processStartTime: processRecord.processStartTime,
    processGroup: processRecord.processGroup
  };
  upsertJob(job.workspaceRoot, running);
  writeJobFile(job.workspaceRoot, job.id, running);
  try {
    const execution = await runner();
    const status = execution.jobStatus ?? (execution.exitStatus === 0 ? "completed" : "failed");
    const completed = {
      ...running,
      status,
      phase: status === "completed" || status === "completed-with-warnings" ? "done" : status,
      pid: null,
      completedAt: nowIso(),
      result: execution.payload,
      rendered: execution.rendered,
      warnings: execution.warnings ?? [],
      claudeSessionId: execution.claudeSessionId ?? null
    };
    upsertJob(job.workspaceRoot, completed);
    writeJobFile(job.workspaceRoot, job.id, completed);
    return completed;
  } catch (error) {
    appendLogLine(job.logFile, error instanceof Error ? error.stack || error.message : String(error));
    const failed = {
      ...running,
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt: nowIso(),
      result: { error: error instanceof Error ? error.message : String(error) },
      rendered: `# Claude Job Failed\n\n${error instanceof Error ? error.message : String(error)}\n`
    };
    upsertJob(job.workspaceRoot, failed);
    writeJobFile(job.workspaceRoot, job.id, failed);
    return failed;
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
