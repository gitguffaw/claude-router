const TOP_LEVEL_COMMANDS = new Set([
  "agents",
  "auth",
  "auto-mode",
  "doctor",
  "gateway",
  "help",
  "install",
  "mcp",
  "plugin",
  "plugins",
  "project",
  "remote-control",
  "respawn",
  "rm",
  "setup-token",
  "stop",
  "ultrareview",
  "update",
  "upgrade",
  "version"
]);

const VALUE_FLAGS = new Set([
  "add-dir",
  "agent",
  "agents",
  "allowed-tools",
  "allowedTools",
  "append-system-prompt",
  "betas",
  "config",
  "debug-file",
  "disallowed-tools",
  "disallowedTools",
  "effort",
  "exclude-dynamic-system-prompt-sections",
  "fallback-model",
  "file",
  "from-pr",
  "env",
  "header",
  "input-format",
  "json-schema",
  "max-budget-usd",
  "mcp-config",
  "model",
  "name",
  "output-format",
  "permission-mode",
  "plugin-dir",
  "plugin-url",
  "prompt-file",
  "prompt-json",
  "prompt-suggestions",
  "remote-control",
  "remote-control-session-name-prefix",
  "resume",
  "scope",
  "setting-sources",
  "settings",
  "session-id",
  "system-prompt",
  "tmux",
  "tools",
  "transport",
  "worktree"
]);

const BOOLEAN_FLAGS = new Set([
  "allow-dangerously-skip-permissions",
  "allow-dangerous",
  "allow-mutating",
  "always-approve",
  "ax-screen-reader",
  "background",
  "bare",
  "best",
  "brief",
  "bypass-permissions",
  "chrome",
  "continue",
  "dangerously-skip-permissions",
  "debug",
  "disable-slash-commands",
  "dry-run",
  "fork-session",
  "help",
  "ide",
  "include-hook-events",
  "include-partial-messages",
  "json",
  "long-context",
  "no-chrome",
  "no-browser",
  "no-session-persistence",
  "opus",
  "print",
  "replay-user-messages",
  "safe-mode",
  "search",
  "sonnet",
  "strict-mcp-config",
  "ultrathink",
  "verbose",
  "version"
]);

const SHORT_ALIASES = new Map([
  ["c", "continue"],
  ["d", "debug"],
  ["H", "header"],
  ["h", "help"],
  ["m", "model"],
  ["n", "name"],
  ["p", "print"],
  ["r", "resume"],
  ["v", "version"],
  ["w", "worktree"]
]);

const LONG_ALIASES = new Map([
  ["allowedTools", "allowed-tools"],
  ["disallowedTools", "disallowed-tools"]
]);

const SUBCOMMANDS = new Map([
  ["auth", new Set(["login", "logout", "status"])],
  ["auto-mode", new Set(["config", "critique", "defaults"])],
  ["mcp", new Set(["add", "add-json", "add-from-claude-desktop", "get", "list", "login", "logout", "remove", "reset-project-choices", "serve"])],
  ["plugin", new Set(["details", "disable", "enable", "init", "new", "install", "i", "list", "marketplace", "prune", "autoremove", "tag", "uninstall", "remove", "update", "validate"])],
  ["plugins", new Set(["details", "disable", "enable", "init", "new", "install", "i", "list", "marketplace", "prune", "autoremove", "tag", "uninstall", "remove", "update", "validate"])],
  ["project", new Set(["purge"])]
]);

const SUBCOMMAND_ALIASES = new Map([
  ["plugin:i", "install"],
  ["plugin:new", "init"],
  ["plugin:autoremove", "prune"],
  ["plugin:remove", "uninstall"]
]);

export function parseClaudeArgv(argv, options = {}) {
  const tokens = [...argv];
  const result = {
    originalArgv: tokens,
    binaryIncluded: tokens[0] === "claude",
    globalFlags: [],
    commandPath: [],
    flags: [],
    positionals: [],
    passthrough: [],
    unknown: {
      commands: [],
      flags: []
    },
    helpOnly: false,
    dryRun: false
  };
  const parseOptions = {
    valueFlags: new Set([...VALUE_FLAGS, ...(options.valueFlags ?? [])]),
    booleanFlags: new Set([...BOOLEAN_FLAGS, ...(options.booleanFlags ?? [])]),
    commands: new Set([...TOP_LEVEL_COMMANDS, ...(options.commands ?? [])]),
    subcommands: mergeSubcommands(options.subcommands)
  };
  let index = result.binaryIncluded ? 1 : 0;
  let afterCommand = false;
  let passthrough = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (passthrough) {
      result.passthrough.push(token);
      index += 1;
      continue;
    }
    if (token === "--") {
      passthrough = true;
      index += 1;
      continue;
    }
    if (isFlagToken(token)) {
      const parsed = parseFlag(tokens, index, parseOptions);
      const target = afterCommand ? result.flags : result.globalFlags;
      target.push(parsed.flag);
      if ((parsed.flag.name === "help" || parsed.flag.name === "version") && parsed.flag.value === true) {
        result.helpOnly = true;
      }
      if (parsed.flag.name === "dry-run") {
        result.dryRun = parsed.flag.value === true;
      }
      if (parsed.unknown) {
        result.unknown.flags.push(parsed.flag.rawName);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (!afterCommand && !isPrintInvocation(result) && isCommandToken(token, parseOptions.commands)) {
      result.commandPath.push(normalizeCommand(token));
      afterCommand = true;
      index += 1;
      continue;
    }
    if (!afterCommand && result.commandPath.length === 0 && !isPrintInvocation(result)) {
      result.unknown.commands.push(token);
      result.positionals.push(token);
      index += 1;
      continue;
    }
    if (afterCommand && result.commandPath.length === 1 && isKnownSubcommand(result.commandPath[0], token, parseOptions.subcommands)) {
      result.commandPath.push(normalizeSubcommand(result.commandPath[0], token));
      index += 1;
      continue;
    }
    if (afterCommand && result.commandPath.length === 1 && hasKnownSubcommands(result.commandPath[0], parseOptions.subcommands)) {
      result.unknown.commands.push(`${result.commandPath[0]} ${token}`);
      result.positionals.push(token);
      index += 1;
      continue;
    }
    result.positionals.push(token);
    index += 1;
  }

  if (result.commandPath[0] === "help") {
    result.helpOnly = true;
  }
  if (result.commandPath[1] === "help") {
    result.helpOnly = true;
  }
  return result;
}

export function normalizeFlagName(name) {
  return LONG_ALIASES.get(name) ?? name;
}

function parseFlag(tokens, index, options) {
  const token = tokens[index];
  const long = token.startsWith("--");
  const body = token.slice(long ? 2 : 1);
  const equalsIndex = body.indexOf("=");
  const rawName = equalsIndex === -1 ? body : body.slice(0, equalsIndex);
  const inlineValue = equalsIndex === -1 ? undefined : body.slice(equalsIndex + 1);
  const canonicalName = normalizeFlagName(long ? rawName : (SHORT_ALIASES.get(rawName) ?? rawName));
  const flag = {
    rawName: long ? `--${rawName}` : `-${rawName}`,
    name: canonicalName,
    value: null,
    inline: inlineValue !== undefined,
    index
  };
  const isValue = options.valueFlags.has(rawName) || options.valueFlags.has(canonicalName);
  const isBoolean = options.booleanFlags.has(rawName) || options.booleanFlags.has(canonicalName);
  if (isValue) {
    flag.value = inlineValue ?? tokens[index + 1] ?? null;
    return { flag, nextIndex: inlineValue === undefined && flag.value !== null ? index + 2 : index + 1, unknown: false };
  }
  if (isBoolean) {
    flag.value = inlineValue === undefined ? true : inlineValue !== "false";
    return { flag, nextIndex: index + 1, unknown: false };
  }
  flag.value = inlineValue ?? null;
  return { flag, nextIndex: index + 1, unknown: true };
}

function isFlagToken(token) {
  return token.startsWith("-") && token !== "-";
}

function isCommandToken(token, commands) {
  return commands.has(normalizeCommand(token));
}

function normalizeCommand(token) {
  return token === "plugins" ? "plugin" : token;
}

function isKnownSubcommand(command, token, subcommands) {
  return subcommands.get(command)?.has(token) ?? false;
}

function normalizeSubcommand(command, token) {
  return SUBCOMMAND_ALIASES.get(`${command}:${token}`) ?? token;
}

function hasKnownSubcommands(command, subcommands) {
  return Boolean(subcommands.get(command)?.size);
}

function isPrintInvocation(parsed) {
  return parsed.globalFlags.some((flag) => flag.name === "print");
}

function mergeSubcommands(extra = {}) {
  const merged = new Map();
  for (const [command, values] of SUBCOMMANDS) {
    merged.set(command, new Set(values));
  }
  for (const [command, values] of Object.entries(extra)) {
    merged.set(normalizeCommand(command), new Set([...(merged.get(normalizeCommand(command)) ?? []), ...values]));
  }
  return merged;
}
