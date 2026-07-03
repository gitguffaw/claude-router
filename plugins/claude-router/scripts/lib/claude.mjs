import path from "node:path";
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

function appendRepeatable(args, flag, values) {
  for (const value of Array.isArray(values) ? values : values ? [values] : []) {
    args.push(flag, String(value));
  }
}

function appendValue(args, flag, value) {
  if (value !== null && value !== undefined && value !== false && value !== "") {
    args.push(flag, String(value));
  }
}

function appendOptionalValue(args, flag, value) {
  if (value === true) {
    args.push(flag);
  } else {
    appendValue(args, flag, value);
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
  appendBoolean(args, "--chrome", controls.chrome);
  appendBoolean(args, "--no-chrome", controls.noChrome);
  appendBoolean(args, "--bare", controls.bare);
  appendValue(args, "--settings", controls.settings);
  appendValue(args, "--setting-sources", controls.settingSources);
  appendBoolean(args, "--strict-mcp-config", controls.strictMcpConfig);
  appendValue(args, "--agent", controls.agent);
  appendValue(args, "--agents", controls.agents);
  appendRepeatable(args, "--allowedTools", controls.allowedTools);
  appendRepeatable(args, "--disallowedTools", controls.disallowedTools);
  appendRepeatable(args, "--tools", controls.tools);
  appendValue(args, "--append-system-prompt", controls.appendSystemPrompt);
  appendBoolean(args, "--ax-screen-reader", controls.axScreenReader);
  appendRepeatable(args, "--betas", controls.betas);
  appendBoolean(args, "--brief", controls.brief);
  appendBoolean(args, "--continue", controls.continue);
  appendOptionalValue(args, "--debug", controls.debug);
  appendValue(args, "--debug-file", controls.debugFile);
  appendBoolean(args, "--disable-slash-commands", controls.disableSlashCommands);
  appendBoolean(args, "--exclude-dynamic-system-prompt-sections", controls.excludeDynamicSystemPromptSections);
  appendValue(args, "--fallback-model", controls.fallbackModel);
  appendRepeatable(args, "--file", controls.files);
  appendBoolean(args, "--fork-session", controls.forkSession);
  appendValue(args, "--from-pr", controls.fromPr);
  appendBoolean(args, "--ide", controls.ide);
  appendBoolean(args, "--include-hook-events", controls.includeHookEvents);
  appendBoolean(args, "--include-partial-messages", controls.includePartialMessages);
  appendValue(args, "--input-format", controls.inputFormat);
  appendValue(args, "--json-schema", controls.jsonSchema);
  appendValue(args, "--max-budget-usd", controls.maxBudgetUsd);
  appendValue(args, "--name", controls.name);
  appendBoolean(args, "--no-session-persistence", controls.noSessionPersistence);
  appendValue(args, "--prompt-suggestions", controls.promptSuggestions);
  appendValue(args, "--remote-control", controls.remoteControl);
  appendValue(args, "--remote-control-session-name-prefix", controls.remoteControlSessionNamePrefix);
  appendBoolean(args, "--replay-user-messages", controls.replayUserMessages);
  appendOptionalValue(args, "--resume", controls.resume);
  appendBoolean(args, "--safe-mode", controls.safeMode);
  appendValue(args, "--session-id", controls.sessionId);
  appendValue(args, "--system-prompt", controls.systemPrompt);
  appendOptionalValue(args, "--tmux", controls.tmux);
  appendBoolean(args, "--verbose", controls.verbose);
  appendOptionalValue(args, "--worktree", controls.worktree);
  appendBoolean(args, "--allow-dangerously-skip-permissions", controls.allowDangerouslySkipPermissions);
  appendRepeatable(args, "--plugin-dir", controls.pluginDirs);
  appendRepeatable(args, "--plugin-url", controls.pluginUrls);
  appendRepeatable(args, "--mcp-config", controls.mcpConfigs);
  appendRepeatable(args, "--add-dir", controls.addDirs);
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
    onStdout: (chunk) => options.onProgress?.({ message: "Claude stdout", logBody: chunk }),
    onStderr: (chunk) => options.onProgress?.({ message: chunk.trim(), logBody: chunk })
  });
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
