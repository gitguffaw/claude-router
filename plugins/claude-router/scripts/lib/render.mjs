import { isActiveJobStatus, readLogPreview } from "./tracked-jobs.mjs";

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function elapsed(job) {
  const start = Date.parse(job.startedAt ?? job.createdAt ?? "");
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "";
  }
  return `${Math.max(0, Math.round((end - start) / 1000))}s`;
}

export function renderSetupReport(report) {
  const lines = [
    "# Claude Router Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- claude: ${report.claude.detail}`,
    `- auth: ${report.auth.detail}`,
    `- plugins: ${report.plugins.ok ? "checked" : "not available"}`,
    `- mcp: ${report.mcp.ok ? "checked" : "not available"}`
  ];
  if (report.nextSteps.length) {
    lines.push("", "Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderStartedJob(job) {
  return [
    `# Claude ${job.kindLabel} Started`,
    "",
    `Job ID: ${job.id}`,
    `Status: ${job.status}`,
    `Result: claude-router result ${job.id}`,
    `Status: claude-router status ${job.id}`,
    `Cancel: claude-router cancel ${job.id}`,
    ""
  ].join("\n");
}

export function renderStatusReport(jobs) {
  if (!jobs.length) {
    return "No Claude Router jobs found.\n";
  }
  const lines = [
    "| Job | Kind | Status | Phase | Elapsed | Summary | Actions |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const job of jobs) {
    const actions = [`result ${job.id}`];
    if (isActiveJobStatus(job.status)) {
      actions.push(`cancel ${job.id}`);
    }
    lines.push(`| ${escapeCell(job.id)} | ${escapeCell(job.kindLabel)} | ${escapeCell(job.status)} | ${escapeCell(job.phase)} | ${escapeCell(elapsed(job))} | ${escapeCell(job.summary)} | ${escapeCell(actions.join(", "))} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderJobStatus(job) {
  const lines = [`# Claude Job ${job.id}`, "", `Status: ${job.status}`, `Kind: ${job.kindLabel ?? job.mode ?? ""}`, `Phase: ${job.phase ?? ""}`, `Elapsed: ${elapsed(job)}`];
  if (job.contextPack?.id) {
    lines.push(`Context pack: ${job.contextPack.id}`);
  }
  if (job.logFile) {
    lines.push("", "Log preview:");
    for (const line of readLogPreview(job.logFile)) {
      lines.push(`- ${line}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job) {
  if (!job) {
    return "Claude Router job not found.\n";
  }
  const lines = [`# Claude Job Result ${job.id}`, "", `Status: ${job.status}`];
  if (job.phase) {
    lines.push(`Phase: ${job.phase}`);
  }
  if (job.waitTimedOut) {
    lines.push("Wait: timed out before the job completed");
  }
  if (job.contextPack?.id) {
    lines.push(`Context pack: ${job.contextPack.id}`);
  }
  if (job.claudeSessionId) {
    lines.push(`Resume in Claude: claude --resume ${job.claudeSessionId}`);
  }
  if (isActiveJobStatus(job.status)) {
    lines.push("", "The job is still running. Poll again with `result --wait`, inspect `status`, or cancel it if it appears stuck.");
    if (job.logPreview?.length) {
      lines.push("", "Log preview:");
      for (const line of job.logPreview) {
        lines.push(`- ${line}`);
      }
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }
  lines.push("", job.rendered || JSON.stringify(job.result ?? {}, null, 2));
  return `${lines.join("\n").trimEnd()}\n`;
}
