const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function parseTimeoutMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid timeout "${value}". Use a non-negative millisecond value.`);
  }
  return parsed;
}

export function resolveClaudeControls(options = {}) {
  let model = options.model ? String(options.model).trim() : null;
  if (options.best) {
    model = "opus";
  }
  if (options.sonnet) {
    model = "sonnet";
  }
  if (options.opus) {
    model = "opus";
  }
  if (options.haiku) {
    model = "haiku";
  }
  if (options["long-context"]) {
    model = model === "sonnet" ? "sonnet[1m]" : "opus[1m]";
  }

  const effort = options.effort ? String(options.effort).trim().toLowerCase() : null;
  if (effort && !VALID_EFFORTS.has(effort)) {
    throw new Error(`Unsupported Claude effort "${options.effort}". Use one of: low, medium, high, xhigh, max.`);
  }
  const permissionMode = options["dangerously-skip-permissions"] || options["bypass-permissions"]
    ? "bypassPermissions"
    : options["permission-mode"] || null;

  return {
    model: model || null,
    effort,
    permissionMode,
    chrome: Boolean(options.chrome),
    noChrome: Boolean(options["no-chrome"]),
    bare: Boolean(options.bare),
    ultrathink: Boolean(options.ultrathink),
    agent: options.agent || null,
    agents: options.agents || null,
    allowedTools: options["allowed-tools"] ?? [],
    disallowedTools: options["disallowed-tools"] ?? [],
    tools: options.tools ?? [],
    appendSystemPrompt: options["append-system-prompt"] || null,
    axScreenReader: Boolean(options["ax-screen-reader"]),
    betas: options.betas ?? [],
    brief: Boolean(options.brief),
    continue: Boolean(options.continue),
    debug: options.debug || null,
    debugFile: options["debug-file"] || null,
    disableSlashCommands: Boolean(options["disable-slash-commands"]),
    excludeDynamicSystemPromptSections: Boolean(options["exclude-dynamic-system-prompt-sections"]),
    fallbackModel: options["fallback-model"] || null,
    files: options.file ?? [],
    forkSession: Boolean(options["fork-session"]),
    fromPr: options["from-pr"] || null,
    ide: Boolean(options.ide),
    includeHookEvents: Boolean(options["include-hook-events"]),
    includePartialMessages: Boolean(options["include-partial-messages"]),
    inputFormat: options["input-format"] || null,
    jsonSchema: options["json-schema"] || null,
    maxBudgetUsd: options["max-budget-usd"] || null,
    name: options.name || null,
    noSessionPersistence: Boolean(options["no-session-persistence"]),
    outputFormat: options["output-format"] || null,
    promptSuggestions: options["prompt-suggestions"] || null,
    remoteControl: options["remote-control"] || null,
    remoteControlSessionNamePrefix: options["remote-control-session-name-prefix"] || null,
    replayUserMessages: Boolean(options["replay-user-messages"]),
    resume: options.resume || null,
    safeMode: Boolean(options["safe-mode"]),
    sessionId: options["session-id"] || null,
    systemPrompt: options["system-prompt"] || null,
    tmux: options.tmux || null,
    verbose: Boolean(options.verbose),
    worktree: options.worktree || null,
    allowDangerouslySkipPermissions: Boolean(options["allow-dangerously-skip-permissions"]),
    timeoutMs: parseTimeoutMs(options["timeout-ms"] ?? null)
  };
}
