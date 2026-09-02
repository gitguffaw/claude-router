import path from "node:path";
import { nativeArgsFromParsedOptions } from "./live-controls.mjs";
import { NATIVE_EMIT_SKIP } from "./routed-controls.mjs";
import { binaryAvailable, runCommand, runProcess } from "./process.mjs";

const DEFAULT_MANAGED_TIMEOUT_MS = 30 * 60 * 1000;

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
  args.push(request.prompt);
  return args;
}

export async function runClaudePrintJob(cwd, request, options = {}) {
  const args = buildClaudePrintArgs(request);
  const timeoutMs = managedTimeoutMs(options.timeoutMs ?? request.controls?.timeoutMs);
  const result = await runProcess("claude", args, {
    cwd,
    env: options.env ?? process.env,
    timeoutMs,
    detached: options.detached,
    onSpawn: options.onSpawn,
    onStdout: (chunk) => options.onProgress?.({ message: "Claude stdout", logBody: chunk }),
    onStderr: (chunk) => options.onProgress?.({ message: chunk.trim(), logBody: chunk })
  });
  if (result.trackingFailed) {
    const message = result.trackingError instanceof Error
      ? result.trackingError.message
      : String(result.trackingError ?? "Failed to persist Claude process identity.");
    const processGone = Boolean(result.processGone);
    const warning = processGone
      ? "Claude process tracking failed; child process tree was terminated."
      : "Claude process tracking failed; child process tree could not be confirmed terminated.";
    return {
      exitStatus: 1,
      jobStatus: "failed",
      payload: {
        mode: request.mode,
        workflow: request.workflow,
        command: "claude",
        args,
        timedOut: false,
        signal: result.signal,
        rawOutput: "",
        parsedOutput: null,
        stderr: message,
        trackingFailed: true,
        processGone,
        pid: result.pid ?? null,
        verification: result.verification ?? null,
        gitAfter: options.readGitStatus?.()
      },
      warnings: [warning],
      rendered: `# Claude Job Failed\n\n${message}\n`,
      claudeSessionId: null
    };
  }
  const rawOutput = result.stdout.trim();
  const parsed = parseJsonOrNull(rawOutput);
  const gitAfter = options.readGitStatus?.();
  const warnings = [];
  if (result.timedOut) {
    warnings.push("Claude process timed out and was terminated.");
  }
  if (!request.write && options.gitBefore?.available && gitAfter?.available && options.gitBefore.short !== gitAfter.short) {
    warnings.push("Read-only Claude route changed git status.");
  }
  return {
    exitStatus: result.status,
    jobStatus: !result.timedOut && result.status === 0 ? (warnings.length ? "completed-with-warnings" : "completed") : "failed",
    payload: {
      mode: request.mode,
      workflow: request.workflow,
      command: "claude",
      args,
      timedOut: Boolean(result.timedOut),
      signal: result.signal,
      rawOutput,
      parsedOutput: parsed,
      stderr: result.stderr.trim(),
      gitAfter
    },
    warnings,
    rendered: renderClaudePayload(request, rawOutput, parsed, result.stderr, warnings),
    claudeSessionId: parsed?.session_id ?? parsed?.sessionId ?? null
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

function renderClaudePayload(request, rawOutput, parsed, stderr, warnings) {
  const lines = [`# Claude ${request.workflow}`, ""];
  if (warnings.length) {
    lines.push("Warnings:");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }
  if (parsed?.result) {
    lines.push(String(parsed.result).trim());
  } else if (parsed && typeof parsed === "object") {
    lines.push("```json");
    lines.push(JSON.stringify(parsed, null, 2));
    lines.push("```");
  } else if (rawOutput) {
    lines.push(rawOutput);
  } else if (stderr) {
    lines.push(stderr.trim());
  } else {
    lines.push("Claude returned no output.");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildResumeHint(sessionId, cwd) {
  if (!sessionId) {
    return null;
  }
  return `claude --resume ${sessionId}${cwd ? ` # from ${path.basename(cwd)}` : ""}`;
}
