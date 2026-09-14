import path from "node:path";
import { nativeArgsFromParsedOptions } from "./live-controls.mjs";
import { NATIVE_EMIT_SKIP } from "./routed-controls.mjs";
import { binaryAvailable, runCommand, runProcess } from "./process.mjs";
import {
  discoverClaudeSession,
  extractSessionIdFromText,
  resolveClaudeSessionPath,
  sessionIdFromParsed,
  sessionIdFromResumeValue,
  snapshotClaudeSessionIds
} from "./claude-sessions.mjs";

export const DEFAULT_MANAGED_TIMEOUT_MS = 30 * 60 * 1000;
export const SMOKE_TEST_TIMEOUT_MS = 180000;

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function managedTimeoutMs(value) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_MANAGED_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid timeout "${value}". Use a non-negative millisecond value.`);
  }
  return parsed;
}

export function getClaudeAvailability(cwd, env = process.env) {
  return binaryAvailable("claude", ["--version"], { cwd, env });
}

export function getClaudeAuthStatus(cwd, env = process.env) {
  const result = runCommand("claude", ["auth", "status"], { cwd, env });
  const parsed = parseJsonOrNull(result.stdout);
  if (result.error?.code === "ENOENT") {
    return { loggedIn: false, detail: "claude not found", raw: "" };
  }
  if (result.status !== 0) {
    return { loggedIn: false, detail: (result.stderr || result.stdout || `exit ${result.status}`).trim(), raw: result.stdout };
  }
  if (parsed) {
    return {
      loggedIn: Boolean(parsed.loggedIn),
      authMethod: parsed.authMethod ?? null,
      apiProvider: parsed.apiProvider ?? null,
      subscriptionType: parsed.subscriptionType ?? null,
      detail: parsed.loggedIn ? `${parsed.authMethod ?? "authenticated"} (${parsed.subscriptionType ?? "unknown plan"})` : "not logged in"
    };
  }
  return { loggedIn: true, detail: result.stdout.trim() || "authenticated", raw: result.stdout };
}

export function getClaudeMcpStatus(cwd, env = process.env) {
  const result = runCommand("claude", ["mcp", "list"], { cwd, env });
  return { ok: !result.error && result.status === 0, detail: (result.stdout || result.stderr).trim() };
}

export function getClaudePluginStatus(cwd, env = process.env) {
  const result = runCommand("claude", ["plugin", "list"], { cwd, env });
  return { ok: !result.error && result.status === 0, detail: (result.stdout || result.stderr).trim() };
}

// --tools "" is a deliberate Claude security control (disable built-in tools).
// Preserve an explicit empty string as the two argv entries: --tools, "".
function appendTools(args, values) {
  if (values === "") {
    args.push("--tools", "");
    return;
  }
  if (Array.isArray(values)) {
    for (const value of values) {
      args.push("--tools", String(value));
    }
    return;
  }
  if (values !== null && values !== undefined && values !== false) {
    args.push("--tools", String(values));
  }
}

function appendValue(args, flag, value) {
  if (value !== null && value !== undefined && value !== false && value !== "") {
    args.push(flag, String(value));
  }
}

function appendBoolean(args, flag, enabled) {
  if (enabled) {
    args.push(flag);
  }
}

export function buildClaudePrintArgs(request) {
  const args = ["-p", "--output-format", request.outputFormat ?? "json", "--permission-mode", request.permissionMode ?? "default"];
  const controls = request.controls ?? {};
  appendValue(args, "--model", controls.model);
  appendValue(args, "--effort", controls.effort);
  appendBoolean(args, "--bare", controls.bare);
  appendBoolean(args, "--safe-mode", controls.safeMode);
  appendTools(args, controls.tools);
  appendValue(args, "--system-prompt", controls.systemPrompt);
  const nativeControls = (request.nativeControls ?? []).filter((control) => !NATIVE_EMIT_SKIP.has(control.option));
  args.push(...nativeArgsFromParsedOptions(request.nativeOptions ?? {}, nativeControls));
  // Claude treats --add-dir / --tools / other `...` flags as variadic. A bare
  // trailing prompt is eaten as another directory. `--` ends option parsing.
  const prompt = request.prompt == null ? "" : String(request.prompt);
  args.push("--", prompt);
  return args;
}

function resumeSessionIdFromRequest(request) {
  return sessionIdFromResumeValue(request?.nativeOptions?.resume ?? request?.controls?.resume);
}

function resolveJobSession(cwd, request, result, options = {}) {
  const env = options.env ?? process.env;
  const parsed = parseJsonOrNull(result.stdout?.trim?.() ? result.stdout.trim() : result.stdout);
  const fromParsed = sessionIdFromParsed(parsed);
  const fromStdout = extractSessionIdFromText(result.stdout);
  const fromStderr = extractSessionIdFromText(result.stderr);
  const fromResume = resumeSessionIdFromRequest(request);
  let claudeSessionId = fromParsed ?? fromStdout ?? fromStderr ?? fromResume ?? null;
  const discovered = discoverClaudeSession(cwd, {
    env,
    excludeIds: options.sessionSnapshot ?? [],
    startedAtMs: options.startedAtMs
  });
  if (!claudeSessionId && discovered) {
    claudeSessionId = discovered.sessionId;
  }
  const claudeSessionPath = discovered?.path
    ?? (claudeSessionId ? resolveClaudeSessionPath(cwd, claudeSessionId, env) : null);
  return { parsed, claudeSessionId, claudeSessionPath };
}

export function isClaudeAuthFailure(parsed, rawOutput = "", stderr = "") {
  const text = [parsed?.result, parsed?.error, rawOutput, stderr]
    .map((value) => String(value ?? ""))
    .join("\n");
  return /not logged in/i.test(text) || /please run \/login/i.test(text);
}

export function classifyClaudePrintFailure({
  timedOut = false,
  rawOutput = "",
  claudeSessionId = null,
  parsed = null,
  stderr = ""
} = {}) {
  const hasOutput = Boolean(String(rawOutput ?? "").trim());
  const hasSession = Boolean(claudeSessionId);
  if (timedOut && (hasSession || hasOutput)) {
    return "killed-in-progress";
  }
  if (timedOut && !hasOutput && !hasSession) {
    return "timed-out-empty";
  }
  if (isClaudeAuthFailure(parsed, rawOutput, stderr)) {
    return "auth-failed";
  }
  if (parsed && typeof parsed === "object" && parsed.is_error === true) {
    return "claude-error";
  }
  if (!hasOutput && !hasSession) {
    return "empty";
  }
  return null;
}

export async function runClaudePrintJob(cwd, request, options = {}) {
  const args = buildClaudePrintArgs(request);
  const timeoutMs = managedTimeoutMs(options.timeoutMs ?? request.controls?.timeoutMs);
  const env = options.env ?? process.env;
  const startedAtMs = Date.now();
  const sessionSnapshot = snapshotClaudeSessionIds(cwd, env);
  const result = await runProcess("claude", args, {
    cwd,
    env,
    timeoutMs,
    detached: options.detached,
    onSpawn: options.onSpawn,
    onStdout: (chunk) => options.onProgress?.({ message: "Claude stdout", logBody: chunk }),
    onStderr: (chunk) => options.onProgress?.({ message: chunk.trim(), logBody: chunk })
  });
  const { parsed, claudeSessionId, claudeSessionPath } = resolveJobSession(cwd, request, result, {
    env,
    sessionSnapshot,
    startedAtMs
  });
  if (result.trackingFailed) {
    const message = result.trackingError instanceof Error
      ? result.trackingError.message
      : String(result.trackingError ?? "Failed to persist Claude process identity.");
    const processGone = Boolean(result.processGone);
    const warning = processGone
      ? "Claude process tracking failed; child process tree was terminated."
      : "Claude process tracking failed; child process tree could not be confirmed terminated.";
    const rawOutput = "";
    const failureKind = classifyClaudePrintFailure({ timedOut: false, rawOutput, claudeSessionId, parsed: null, stderr: message });
    return {
      exitStatus: 1,
      jobStatus: "failed",
      phase: "failed",
      payload: {
        mode: request.mode,
        workflow: request.workflow,
        command: "claude",
        args,
        timedOut: false,
        signal: result.signal,
        rawOutput,
        parsedOutput: null,
        stderr: message,
        trackingFailed: true,
        processGone,
        pid: result.pid ?? null,
        verification: result.verification ?? null,
        gitAfter: options.readGitStatus?.(),
        failureKind,
        killedInProgress: false,
        claudeSessionPath
      },
      warnings: [warning],
      rendered: `# Claude Job Failed\n\n${message}\n`,
      claudeSessionId,
      claudeSessionPath
    };
  }
  const rawOutput = result.stdout.trim();
  const gitAfter = options.readGitStatus?.();
  const timedOut = Boolean(result.timedOut);
  const stderrText = result.stderr.trim();
  const failureKind = classifyClaudePrintFailure({
    timedOut,
    rawOutput,
    claudeSessionId,
    parsed,
    stderr: stderrText
  });
  const warnings = [];
  if (timedOut) {
    warnings.push(
      failureKind === "killed-in-progress"
        ? "Claude process timed out while a session was still in progress and was terminated before final output."
        : "Claude process timed out and was terminated."
    );
    if (claudeSessionId) {
      options.onProgress?.({
        message: `Timeout kill left Claude session ${claudeSessionId}${claudeSessionPath ? ` at ${claudeSessionPath}` : ""}. Resume with: claude --resume ${claudeSessionId}`
      });
    }
  }
  if (failureKind === "auth-failed") {
    warnings.push("Claude is not logged in. This is not a model result.");
  } else if (failureKind === "claude-error") {
    warnings.push("Claude reported an error in print-mode JSON (is_error).");
  }
  if (!request.write && options.gitBefore?.available && gitAfter?.available && options.gitBefore.short !== gitAfter.short) {
    warnings.push("Read-only Claude route changed git status.");
  }
  const jobFailed = Boolean(timedOut || result.status !== 0 || failureKind);
  const jobStatus = jobFailed ? "failed" : (warnings.length ? "completed-with-warnings" : "completed");
  return {
    exitStatus: jobFailed ? (result.status === 0 ? 1 : result.status) : 0,
    jobStatus,
    phase: timedOut ? "timed-out" : undefined,
    payload: {
      mode: request.mode,
      workflow: request.workflow,
      command: "claude",
      args,
      timedOut,
      signal: result.signal,
      rawOutput,
      parsedOutput: parsed,
      stderr: result.stderr.trim(),
      gitAfter,
      failureKind,
      killedInProgress: failureKind === "killed-in-progress",
      claudeSessionPath
    },
    warnings,
    rendered: renderClaudePayload(request, rawOutput, parsed, result.stderr, warnings, {
      timedOut,
      failureKind,
      claudeSessionId,
      claudeSessionPath,
      logFile: options.logFile,
      cwd
    }),
    claudeSessionId,
    claudeSessionPath
  };
}

export async function runClaudeUltrareview(cwd, options = {}) {
  const args = ["ultrareview", "--json"];
  if (options.timeout) {
    args.push("--timeout", String(options.timeout));
  }
  if (options.target) {
    args.push(String(options.target));
  }
  const result = await runProcess("claude", args, { cwd, env: options.env ?? process.env });
  const rawOutput = result.stdout.trim();
  return {
    exitStatus: result.status,
    jobStatus: result.status === 0 ? "completed" : "failed",
    payload: {
      mode: "ultrareview",
      workflow: "Ultrareview",
      command: "claude",
      args,
      rawOutput,
      parsedOutput: parseJsonOrNull(rawOutput),
      stderr: result.stderr.trim()
    },
    warnings: [],
    rendered: `# Claude Ultrareview\n\n${rawOutput || result.stderr.trim() || "No output."}\n`
  };
}

export function renderClaudePayload(request, rawOutput, parsed, stderr, warnings, meta = {}) {
  const lines = [`# Claude ${request.workflow}`, ""];
  if (warnings.length) {
    lines.push("Warnings:");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }
  if (meta.failureKind === "killed-in-progress" || (meta.timedOut && meta.claudeSessionId)) {
    lines.push("The managed job was killed in progress. This is not a hard empty model failure.");
    lines.push("");
  } else if (meta.failureKind === "timed-out-empty") {
    lines.push("The managed job timed out with no captured Claude output or session.");
    lines.push("");
  } else if (meta.failureKind === "auth-failed") {
    lines.push("Claude is not logged in. This is not a model result.");
    lines.push("");
  } else if (meta.failureKind === "claude-error") {
    lines.push("Claude reported a print-mode error. This is not a successful model result.");
    lines.push("");
  }
  if (parsed?.result && meta.failureKind !== "killed-in-progress") {
    lines.push(String(parsed.result).trim());
  } else if (parsed && typeof parsed === "object" && meta.failureKind !== "killed-in-progress") {
    lines.push("```json");
    lines.push(JSON.stringify(parsed, null, 2));
    lines.push("```");
  } else if (rawOutput && meta.failureKind !== "killed-in-progress") {
    lines.push(rawOutput);
  } else if (!meta.timedOut && stderr) {
    lines.push(stderr.trim());
  } else if (!meta.timedOut && meta.failureKind !== "killed-in-progress") {
    lines.push("Claude returned no output.");
  }
  if (meta.logFile) {
    lines.push("", `Job log: ${meta.logFile}`);
  }
  if (meta.claudeSessionPath) {
    lines.push(`Claude session: ${meta.claudeSessionPath}`);
  }
  const resume = buildResumeHint(meta.claudeSessionId, meta.cwd);
  if (resume) {
    lines.push(`Resume: ${resume}`);
  } else if (meta.timedOut) {
    lines.push("No Claude session id was captured; inspect ~/.claude/projects if a session was created outside the usual project directory.");
  }
  if (meta.timedOut) {
    lines.push(
      "",
      `The default managed timeout is ${DEFAULT_MANAGED_TIMEOUT_MS / 60000} minutes (${DEFAULT_MANAGED_TIMEOUT_MS}ms). Values around ${SMOKE_TEST_TIMEOUT_MS}ms (3 minutes) are only appropriate for short smoke tests; raise --timeout-ms for medium effort or Explore/subagent fan-out.`
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildResumeHint(sessionId, cwd) {
  if (!sessionId) {
    return null;
  }
  return `claude --resume ${sessionId}${cwd ? ` # from ${path.basename(cwd)}` : ""}`;
}
