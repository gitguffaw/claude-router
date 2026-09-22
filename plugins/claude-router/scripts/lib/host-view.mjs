// Host-facing projection. The calling model needs "ready" plus the task result.
// Startup chatter stays in the on-disk job. The exception is an authentication
// error that blocks work, such as a server that needs authentication.

const LAUNCH_NOISE_LINE = [
  /\bmcp[_\s-]?servers?\b/i,
  /\bnot connected\b/i,
  /\bdidn['’]?t connect\b/i,
  /\bfailed to connect\b/i,
  /\bserver disconnected\b/i,
  /\b(?:plugin|hook)s?\b.*\b(?:failed|error|warning)\b/i,
  /\bfailed to (?:load|start|initialize) (?:an? )?(?:plugin|mcp|hook|server)\b/i,
  /"type"\s*:\s*"system"/i,
  /"subtype"\s*:\s*"init"/i,
  /"mcp_servers"/i,
  /^\s*\[mcp\]/i,
  /^\s*warning:\s.*\b(?:mcp|plugin|hook|connect)/i,
  /^\s*error:\s.*\bmcp\b/i,
  /^\s*MCP\b/
];

const BLOCKING_AUTH_LINE = [
  /\bneeds[-_ ]?auth(?:entication)?\b/i,
  /\bauthentication required\b/i,
  /\bauth required\b/i,
  /\bnot logged in\b/i,
  /\bplease run \/login\b/i,
  /\blogin required\b/i,
  /\bunauthorized\b/i
];

const ENVELOPE_KEYS = new Set([
  "type",
  "subtype",
  "session_id",
  "sessionId",
  "uuid",
  "cwd",
  "tools",
  "mcp_servers",
  "mcpServers",
  "model",
  "permissionMode",
  "permission_mode",
  "apiKeySource",
  "slash_commands",
  "output_style",
  "agents",
  "skills",
  "plugins",
  "claude_code_version",
  "duration_ms",
  "duration_api_ms",
  "num_turns",
  "total_cost_usd",
  "usage",
  "modelUsage",
  "fast_mode_state",
  "is_error",
  "terminal_reason",
  "stop_reason",
  "cost_usd",
  "request_id"
]);

const READY_STATUSES = new Set(["queued", "running", "completed", "completed-with-warnings"]);

function isMcpStatusHeader(line) {
  return /^\s*(?:mcp servers?|connected mcp|mcp status)\s*:?\s*$/i.test(String(line ?? "").trim());
}

function isIndentedStatusLine(line) {
  return /^\s{2,}\S/.test(line) || /^\s*[-*]\s+\S/.test(line);
}

export function isBlockingAuthLine(line) {
  const text = String(line ?? "").trim();
  return Boolean(text) && BLOCKING_AUTH_LINE.some((pattern) => pattern.test(text));
}

export function blockingAuthNotice(line) {
  const text = String(line ?? "").replace(/\s+/g, " ").trim();
  if (!isBlockingAuthLine(text)) {
    return "";
  }
  if (/\bnot logged in\b/i.test(text) || /\/login\b/i.test(text)) {
    return "Claude is not logged in. Run claude auth login.";
  }
  const quoted = text.match(/mcp server\s+["']([^"']+)["']/i)?.[1];
  const beforeUrl = text.match(/^(.+?)\s+https?:\/\//i)?.[1]?.replace(/:\s*$/, "").trim();
  const labeled = text.match(/^[\s*-]*([A-Za-z0-9._:-]+)\s*:\s+\S/)?.[1];
  const beforeBang = text.match(/^(.+?)\s+-\s+!?\s*(?:needs authentication|authentication required|auth required)/i)?.[1]?.trim();
  const name = [quoted, beforeUrl, labeled, beforeBang].find((candidate) => candidate && !/^(?:error|warning|warn|mcp)$/i.test(candidate));
  return name ? `${name} needs authentication` : "Needs authentication";
}

function authNoticeFromServer(server) {
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    return "";
  }
  if ((server.name == null && server.serverName == null) || (server.status == null && server.error == null && server.message == null)) {
    return "";
  }
  const name = String(server.name ?? server.serverName ?? "").trim();
  const blob = `${server.status ?? ""} ${server.error ?? server.message ?? ""}`.trim();
  if (!isBlockingAuthLine(blob)) {
    return "";
  }
  if (!name || /^(?:mcp|error|warning|server)$/i.test(name)) {
    return "Needs authentication";
  }
  return `${name} needs authentication`;
}

function addNotice(notices, seen, notice) {
  const text = String(notice ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return;
  }
  const key = text.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  notices.push(text);
}

function collectAuth(value, add, key = "", depth = 0) {
  if (value == null || depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (key === "result" || key === "prompt" || key === "rendered" || key === "summary" || key === "title") {
      return;
    }
    const trimmed = value.trim();
    const whole = trimmed.startsWith("{") || trimmed.startsWith("[")
      ? (parseJsonObject(trimmed) ?? parseJsonValue(trimmed))
      : null;
    if (whole) {
      collectAuth(whole, add, key, depth + 1);
      return;
    }
    for (const line of value.split(/\r?\n/)) {
      const embedded = embeddedJson(line);
      if (embedded) {
        collectAuth(embedded, add, key, depth + 1);
        continue;
      }
      add(blockingAuthNotice(line));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAuth(item, add, key, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const serverNotice = authNoticeFromServer(value);
  if (serverNotice) {
    add(serverNotice);
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (typeof child === "string" && (childKey === "result" || childKey === "prompt" || childKey === "rendered")) {
      continue;
    }
    if (serverNotice && ["name", "serverName", "status", "error", "message", "source"].includes(childKey)) {
      continue;
    }
    collectAuth(child, add, childKey, depth + 1);
  }
}

function embeddedJson(line) {
  const start = String(line ?? "").indexOf("{");
  if (start < 0) {
    return null;
  }
  const candidate = line.slice(start).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return null;
  }
  return parseJsonObject(candidate) ?? parseJsonValue(candidate);
}

function parseJsonValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function startupAuthNotices({ stderr = "", parsed = null, rawOutput = "", stdout = "", extra = [] } = {}) {
  const notices = [];
  const seen = new Set();
  const add = (notice) => addNotice(notices, seen, notice);
  for (const notice of extra ?? []) {
    add(notice);
  }
  collectAuth(stderr, add);
  collectAuth(stdout, add);
  collectAuth(rawOutput, add);
  collectAuth(parsed, add);
  return notices;
}

export function isLaunchNoiseLine(line) {
  const text = String(line ?? "").trim();
  if (!text || isBlockingAuthLine(text)) {
    return false;
  }
  if (LAUNCH_NOISE_LINE.some((pattern) => pattern.test(text))) {
    return true;
  }
  return /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN)\b/i.test(text)
    && /\b(?:mcp|plugin|hook)\b/i.test(text);
}

export function isLaunchNoiseText(value) {
  const lines = String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => isLaunchNoiseLine(line));
}

export function stripLaunchNoise(value) {
  const kept = [];
  const seen = new Set();
  const keep = (notice) => addNotice(kept, seen, notice);
  let inBlock = false;
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    const embedded = embeddedJson(line);
    if (embedded) {
      const before = kept.length;
      collectAuth(embedded, keep);
      if (kept.length > before || isLaunchNoiseLine(line) || isBlockingAuthLine(line)) {
        continue;
      }
    }
    if (isBlockingAuthLine(line)) {
      keep(blockingAuthNotice(line));
      continue;
    }
    if (isMcpStatusHeader(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (trimmed === "" || isIndentedStatusLine(line) || isLaunchNoiseLine(line)) {
        if (trimmed === "") {
          inBlock = false;
        }
        continue;
      }
      inBlock = false;
    }
    if (isLaunchNoiseLine(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  } catch {
    // not a single JSON object
  }
  return null;
}

/**
 * Claude print stdout may be one JSON object or NDJSON that starts with a
 * system init event. Keep the model result, not the init event.
 */
export function parseClaudeStdout(stdout) {
  const text = String(stdout ?? "").trim();
  const blockingAuth = text ? startupAuthNotices({ stdout: text }) : [];
  if (!text) {
    return { parsed: null, rawOutput: "", blockingAuth };
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const objects = [];
  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }
    const value = parseJsonObject(line);
    if (value) {
      objects.push(value);
    }
  }
  const pretty = objects.length === 0 || (objects.length === 1 && lines.length > 1 && !lines.every((line) => line.startsWith("{")));
  if (pretty) {
    const whole = parseJsonObject(text);
    if (whole) {
      return { parsed: whole, rawOutput: text, blockingAuth };
    }
  }
  if (!objects.length) {
    return { parsed: null, rawOutput: text, blockingAuth };
  }
  const preferred = [...objects].reverse().find((obj) => obj.type === "result" || typeof obj.result === "string");
  const chosen = preferred ?? objects.find((obj) => obj.type !== "system") ?? null;
  if (!chosen || chosen.type === "system") {
    return { parsed: null, rawOutput: "", blockingAuth };
  }
  return { parsed: chosen, rawOutput: JSON.stringify(chosen), blockingAuth };
}

function taskRemainder(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "";
  }
  const rest = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (ENVELOPE_KEYS.has(key) || /mcp|plugin|hook/i.test(key)) {
      continue;
    }
    if (key === "result" && !String(value ?? "").trim()) {
      continue;
    }
    rest[key] = value;
  }
  const keys = Object.keys(rest);
  if (!keys.length) {
    return "";
  }
  if (keys.length === 1 && typeof rest[keys[0]] === "string") {
    return String(rest[keys[0]]).trim();
  }
  return JSON.stringify(rest, null, 2);
}

export function claudeTaskText({ parsed = null, rawOutput = "", stderr = "", failureKind = null } = {}) {
  if (failureKind === "killed-in-progress" || failureKind === "timed-out-empty" || failureKind === "auth-failed") {
    return "";
  }
  if (typeof parsed?.result === "string" && parsed.result.trim()) {
    const text = parsed.result.trim();
    return failureKind ? stripLaunchNoise(text) : text;
  }
  const remainder = taskRemainder(parsed);
  if (remainder) {
    return remainder;
  }
  const raw = stripLaunchNoise(rawOutput || "");
  if (raw) {
    return raw;
  }
  if (failureKind) {
    return stripLaunchNoise(stderr || "");
  }
  return "";
}

function isReadyStatus(status) {
  return READY_STATUSES.has(status);
}

function appendNotices(text, notices) {
  let out = String(text ?? "").trim();
  for (const notice of notices) {
    if (!out.toLowerCase().includes(notice.toLowerCase())) {
      out = out ? `${out}\n\n${notice}` : notice;
    }
  }
  return out;
}

function jobAuthNotices(job, failureKind = null) {
  const notices = startupAuthNotices({
    stderr: job?.result?.stderr,
    parsed: job?.result?.parsedOutput,
    rawOutput: job?.result?.rawOutput,
    extra: job?.result?.blockingAuth
  });
  if (failureKind !== "auth-failed") {
    return notices;
  }
  return notices.filter((notice) => !/not logged in/i.test(notice));
}

export function hostJobOutput(job) {
  const status = job?.status;
  const failureKind = job?.result?.failureKind ?? null;
  const withAuth = (text) => appendNotices(text, jobAuthNotices(job, failureKind));
  if (status === "cancelled") {
    return withAuth(`Cancelled Claude Router job ${job.id}.`);
  }
  if (status === "running" || status === "queued") {
    return withAuth("Claude is ready.");
  }
  if (failureKind === "auth-failed") {
    return withAuth("Claude is not logged in. This is not a model result.");
  }
  if (failureKind === "killed-in-progress") {
    return withAuth(stripLaunchNoise(job.rendered || "") || "The managed job was killed in progress. This is not a hard empty model failure.");
  }
  if (failureKind === "timed-out-empty") {
    return withAuth("The managed job timed out with no captured Claude output or session.");
  }
  if (failureKind === "claude-error") {
    const detail = claudeTaskText({
      parsed: job.result?.parsedOutput,
      rawOutput: job.result?.rawOutput,
      stderr: job.result?.stderr,
      failureKind
    });
    return withAuth(["Claude reported a print-mode error. This is not a successful model result.", detail].filter(Boolean).join("\n\n"));
  }
  if (failureKind === "empty") {
    const detail = stripLaunchNoise(job?.result?.stderr || "");
    return withAuth(detail || "Claude finished without a task result.");
  }
  const warnings = (job?.warnings ?? []).filter((warning) => !isLaunchNoiseText(warning));
  const answer = claudeTaskText({
    parsed: job?.result?.parsedOutput,
    rawOutput: job?.result?.rawOutput,
    stderr: job?.result?.stderr,
    failureKind
  });
  const parts = [];
  if (warnings.length) {
    parts.push(warnings.map((warning) => `- ${warning}`).join("\n"));
  }
  if (answer) {
    parts.push(answer);
  }
  if (parts.length) {
    return withAuth(parts.join("\n\n"));
  }
  if (status === "completed" || status === "completed-with-warnings") {
    return withAuth("Claude is ready.");
  }
  return withAuth(stripLaunchNoise(job?.rendered || "") || "Claude finished without a task result.");
}

function projectJob(job, { brief = false } = {}) {
  const ready = isReadyStatus(job?.status);
  const projected = {
    ready,
    status: job?.status ?? null,
    id: job?.id ?? null,
    mode: job?.mode ?? null
  };
  const failureKind = job?.result?.failureKind;
  if (failureKind) {
    projected.failureKind = failureKind;
  }
  projected.output = brief
    ? (String(job?.summary || job?.title || "").trim() || (ready ? "Claude is ready." : hostJobOutput(job)))
    : hostJobOutput(job);
  return projected;
}

function projectSetup(report) {
  const steps = (report.nextSteps ?? []).filter((step) => !isLaunchNoiseText(step));
  return {
    ready: Boolean(report.ready),
    status: report.ready ? "ready" : "needs attention",
    output: report.ready ? "Claude is ready." : (steps.join("\n") || "Claude is not ready.")
  };
}

function projectRunResult(value) {
  const status = value.jobStatus ?? (value.exitStatus === 0 ? "completed" : "failed");
  const output = stripLaunchNoise(value.rendered || "")
    || (status === "completed" || status === "completed-with-warnings" ? "Claude is ready." : "Claude finished without a task result.");
  const projected = {
    ready: status === "completed" || status === "completed-with-warnings",
    status,
    mode: value.payload?.mode ?? null,
    output
  };
  if (value.payload?.failureKind) {
    projected.failureKind = value.payload.failureKind;
  }
  return projected;
}

function isSetupReport(value) {
  return Boolean(value && typeof value.ready === "boolean" && value.node && value.claude && value.auth && !value.id);
}

function isJobRecord(value) {
  return Boolean(
    value
    && typeof value.id === "string"
    && typeof value.status === "string"
    && (value.request || value.result || value.rendered || value.jobClass || value.kindLabel)
  );
}

function isJobList(value) {
  return Boolean(value && Array.isArray(value.jobs));
}

function isRunResult(value) {
  return Boolean(value && !value.id && value.payload && typeof value.rendered === "string" && (value.jobStatus || value.exitStatus !== undefined));
}

export function projectHostValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => projectHostValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (isSetupReport(value)) {
    return projectSetup(value);
  }
  if (isJobList(value)) {
    return {
      jobs: value.jobs.map((job) => (isJobRecord(job) ? projectJob(job, { brief: true }) : projectHostValue(job))),
      total: value.total,
      truncated: value.truncated
    };
  }
  if (isJobRecord(value)) {
    return projectJob(value);
  }
  if (isRunResult(value)) {
    return projectRunResult(value);
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "mcp_servers" || key === "mcpServers") {
      continue;
    }
    if ((key === "stderr" || key === "error") && typeof child === "string") {
      const cleaned = stripLaunchNoise(child);
      if (cleaned) {
        out[key] = cleaned;
      }
      continue;
    }
    out[key] = projectHostValue(child);
  }
  return out;
}

export function projectCompanionStdout(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return `${JSON.stringify(projectHostValue(JSON.parse(text)), null, 2)}\n`;
    } catch {
      return `${stripLaunchNoise(text)}\n`;
    }
  }
  return `${stripLaunchNoise(text)}\n`;
}
