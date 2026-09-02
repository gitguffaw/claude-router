function parseTimeoutMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  // Number(" ") coerces to 0, which would silently disable the managed timeout.
  const parsed = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid timeout "${value}". Use a non-negative millisecond value.`);
  }
  return parsed;
}

function leanSelection(value, runtime) {
  if (!value) {
    return null;
  }
  const requested = value === true ? "auto" : String(value).trim().toLowerCase();
  if (!["auto", "oauth", "api"].includes(requested)) {
    throw new Error(`Invalid --lean value "${value}". Use auto, oauth, or api.`);
  }
  if (requested !== "auto") {
    return requested;
  }
  const providerCredentials = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY"
  ].some((name) => runtime.env?.[name]);
  if (runtime.env?.ANTHROPIC_API_KEY || providerCredentials) {
    return "api";
  }
  if (runtime.auth?.loggedIn || /claude\.ai|oauth/i.test(runtime.auth?.authMethod ?? "")) {
    return "oauth";
  }
  throw new Error("--lean could not determine the active Claude authentication path. Use --lean=oauth for subscription/OAuth or --lean=api for API-key bare mode.");
}

function assertLeanFlagAvailable(flag, runtime) {
  if (runtime.availableFlags && !runtime.availableFlags.has(flag)) {
    throw new Error(`The installed Claude CLI does not advertise ${flag}; update Claude or choose a different lean authentication path.`);
  }
}

export function resolveClaudeControls(options = {}, runtime = {}) {
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

  // Model and effort values are intentionally opaque pass-through strings. The
  // installed Claude CLI, not the router release, owns their accepted values.
  const effort = options.effort ? String(options.effort).trim() : null;
  const permissionMode = options["dangerously-skip-permissions"] || options["bypass-permissions"]
    ? "bypassPermissions"
    : options["permission-mode"] || null;

  const lean = leanSelection(options.lean, runtime);
  let safeMode = Boolean(options["safe-mode"]);
  let bare = Boolean(options.bare);
  if (safeMode && bare) {
    throw new Error("--safe-mode and --bare are different authentication paths and cannot be combined.");
  }
  if (lean === "oauth") {
    assertLeanFlagAvailable("--safe-mode", runtime);
    if (bare) {
      throw new Error("--lean=oauth conflicts with --bare. OAuth lean mode uses Claude --safe-mode.");
    }
    safeMode = true;
  } else if (lean === "api") {
    assertLeanFlagAvailable("--bare", runtime);
    if (safeMode) {
      throw new Error("--lean=api conflicts with --safe-mode. API lean mode uses Claude --bare.");
    }
    bare = true;
  }

  const toolsSpecified = Object.prototype.hasOwnProperty.call(options, "tools");
  const defaultLeanTools = runtime.mode === "exec" ? "Bash,Read,Edit,Write" : "Bash,Read";
  const tools = toolsSpecified ? options.tools : lean ? defaultLeanTools : [];
  const systemPrompt = options["system-prompt"] || (lean ? "You are a concise expert coding assistant." : null);

  return {
    model: model || null,
    effort,
    permissionMode,
    bare,
    safeMode,
    ultrathink: Boolean(options.ultrathink),
    // Preserve explicit empty string for --tools "" (disable all built-in tools).
    tools: options.tools === "" ? "" : tools,
    systemPrompt,
    leanProfile: lean ? {
      id: lean,
      authPath: lean === "oauth" ? "OAuth/subscription" : "API key or apiKeyHelper",
      isolationFlag: lean === "oauth" ? "--safe-mode" : "--bare",
      defaultToolsApplied: !toolsSpecified,
      defaultSystemPromptApplied: !options["system-prompt"]
    } : null,
    timeoutMs: parseTimeoutMs(options["timeout-ms"] ?? null)
  };
}
