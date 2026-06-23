import os from "node:os";
import process from "node:process";
import { runCommand } from "./process.mjs";

const DEFAULT_HELP_COMMANDS = ["mcp", "plugin", "agents", "auto-mode", "auth", "project"];

export function captureClaudeSurface(options = {}) {
  const command = options.command ?? "claude";
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const version = runCommand(command, ["--version"], { cwd, env });
  const help = runCommand(command, ["--help"], { cwd, env });
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const versionText = extractVersion(version.stdout || version.stderr);
  const topLevel = parseClaudeHelp(help.stdout);
  const subcommandHelp = [];
  const leafHelp = [];
  const parseWarnings = [...topLevel.parseWarnings];

  if (help.status === 0) {
    for (const subcommand of options.subcommands ?? DEFAULT_HELP_COMMANDS) {
      const subHelp = runCommand(command, [subcommand, "--help"], { cwd, env });
      if (subHelp.status !== 0) {
        parseWarnings.push(`claude ${subcommand} --help exited ${subHelp.status}`);
        continue;
      }
      const parsed = parseClaudeHelp(subHelp.stdout);
      parseWarnings.push(...parsed.parseWarnings.map((warning) => `${subcommand}: ${warning}`));
      subcommandHelp.push({ subcommand, result: subHelp, parsed });
      for (const commandInfo of parsed.commands) {
        const leaf = runCommand(command, [subcommand, commandInfo.name, "--help"], { cwd, env });
        if (leaf.status !== 0) {
          continue;
        }
        const leafParsed = parseClaudeHelp(leaf.stdout);
        parseWarnings.push(...leafParsed.parseWarnings.map((warning) => `${subcommand} ${commandInfo.name}: ${warning}`));
        leafHelp.push({ subcommand, command: commandInfo.name, result: leaf, parsed: leafParsed });
      }
    }
  }

  const id = options.id ?? buildSurfaceId(versionText, help.stdout, capturedAt);
  const commandSpecs = [
    ...topLevel.commands.map((command) => commandSpecFromHelp([command.name], id, {
      aliases: command.aliases,
      flags: topLevel.flags,
      positionals: []
    })),
    ...subcommandHelp.flatMap(({ subcommand, parsed }) => parsed.commands.map((command) => {
      const leaf = leafHelp.find((item) => item.subcommand === subcommand && item.command === command.name);
      return commandSpecFromHelp([subcommand, command.name], id, {
        aliases: command.aliases,
        flags: leaf?.parsed.flags ?? parsed.flags,
        positionals: leaf?.parsed.positionals ?? parsed.positionals
      });
    }))
  ];
  const flags = topLevel.flags.map((flag) => flagSpecFromHelp(flag));

  return {
    id,
    schemaVersion: 1,
    capturedAt,
    binary: command,
    version: versionText,
    platform: {
      os: os.platform(),
      arch: os.arch(),
      node: process.version
    },
    commands: commandSpecs,
    flags,
    parseWarnings,
    drift: {
      status: parseWarnings.length ? "degraded" : "current",
      docsAheadOfLocal: [],
      unknownCommands: []
    },
    source: {
      localHelp: help.status === 0,
      officialDocsCheckedAt: options.officialDocsCheckedAt ?? "",
      officialDocsUrls: options.officialDocsUrls ?? []
    }
  };
}

export function parseClaudeHelp(text) {
  const commands = [];
  const flags = [];
  const positionals = [];
  const parseWarnings = [];
  let section = null;
  let skippingExamples = false;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^usage:/i.test(trimmed)) {
      positionals.push(...parseUsagePositionals(trimmed));
      continue;
    }
    if (/^commands:/i.test(trimmed)) {
      section = "commands";
      continue;
    }
    if (/^(options|flags):/i.test(trimmed)) {
      section = "options";
      continue;
    }
    if (/^[A-Z][A-Za-z ]+:$/.test(trimmed)) {
      if (section === "commands" && /^examples:/i.test(trimmed)) {
        skippingExamples = true;
        continue;
      }
      section = null;
      continue;
    }
    if (skippingExamples) {
      if (!(section === "commands" && matchCommandEntry(line))) {
        continue;
      }
      skippingExamples = false;
    }
    if (section === "commands") {
      const match = matchCommandEntry(line);
      if (match) {
        const [name, ...aliases] = match[1].split("|");
        commands.push({ name, aliases });
      } else if (/^\s{0,4}\S/.test(line)) {
        parseWarnings.push(`unparsed command line: ${trimmed}`);
      }
      continue;
    }
    if ((section === "options" || trimmed.startsWith("-")) && /^\s{0,4}-/.test(line)) {
      const flag = parseFlagHelpLine(trimmed);
      if (flag) {
        flags.push(flag);
      } else if (trimmed.startsWith("-")) {
        parseWarnings.push(`unparsed flag line: ${trimmed}`);
      }
    }
  }

  return { commands: dedupeCommands(commands), flags: dedupeFlags(flags), positionals: unique(positionals), parseWarnings };
}

function matchCommandEntry(line) {
  return line.match(/^\s{2,}([a-z][a-z0-9-]*(?:\|[a-z][a-z0-9-]*)*)(?=\s{2,}|\s+\[|\s+<)/);
}

function parseFlagHelpLine(line) {
  const prefix = line.match(/^((?:-{1,2}[A-Za-z][A-Za-z0-9-]*)(?:,\s*-{1,2}[A-Za-z][A-Za-z0-9-]*)*)(?:[=\s](?:<([^>]+)>|\[([^\]]+)\]))?/);
  if (!prefix) {
    return null;
  }
  const names = prefix[1].split(",").map((name) => ({ name: name.trim(), valueHint: prefix[2] ?? prefix[3] ?? null, optional: Boolean(prefix[3]) }));
  if (!names.length) {
    return null;
  }
  return {
    names: unique(names.map((item) => item.name)),
    requiresValue: names.some((item) => Boolean(item.valueHint) && !item.optional),
    valueHint: names.find((item) => item.valueHint)?.valueHint ?? null,
    description: line.replace(/^[-,\sA-Za-z0-9=<>\[\]_]+/, "").trim()
  };
}

function flagSpecFromHelp(flag, appliesTo = ["global"]) {
  const riskByValue = riskByFlag(flag.names);
  return {
    id: `flag.claude.${flag.names[flag.names.length - 1].replace(/^-+/, "")}`,
    names: flag.names,
    type: flag.requiresValue ? "string" : "boolean",
    repeatable: false,
    requiresValue: flag.requiresValue,
    appliesTo,
    ...(riskByValue ? { riskByValue } : {}),
    sensitive: isSensitiveFlag(flag.names),
    source: "local-help"
  };
}

function commandSpecFromHelp(commandPath, snapshotId, options = {}) {
  const safeRead = isSafeReadCommand(commandPath);
  return {
    id: `command.claude.${commandPath.join(".")}`,
    commandPath,
    aliases: options.aliases ?? [],
    summary: "",
    interactionKind: safeRead ? "noninteractive" : "admin",
    availability: {
      minClaudeVersion: null,
      source: "local-help",
      snapshotId
    },
    risk: {
      classes: safeRead ? ["safe_read"] : ["unknown_high_risk"],
      mutability: safeRead ? "none" : "unknown",
      writesWorkspace: false,
      writesClaudeConfig: false,
      usesExternalCode: false,
      requiresNetwork: false,
      permissionBypass: false,
      requiresTTY: false
    },
    flags: (options.flags ?? []).map((flag) => flagSpecFromHelp(flag, [commandPath.join(" ")])),
    positionals: options.positionals ?? [],
    outputs: ["text"],
    defaultDecision: safeRead ? "allow" : "block"
  };
}

function isSafeReadCommand(commandPath) {
  const leaf = commandPath[commandPath.length - 1];
  return ["help", "version", "list", "get", "details", "validate", "status", "doctor"].includes(leaf);
}

function isSensitiveFlag(names) {
  return names.some((name) => /token|key|secret|password|header/i.test(name));
}

function riskByFlag(names) {
  if (names.includes("--permission-mode")) {
    return {
      plan: ["workspace_read"],
      acceptEdits: ["workspace_write"],
      bypassPermissions: ["privilege_bypass"]
    };
  }
  if (names.some((name) => /dangerously-skip-permissions|bypass-permissions|always-approve/.test(name))) {
    return { true: ["privilege_bypass"] };
  }
  if (names.some((name) => /plugin-url|mcp-config|chrome/.test(name))) {
    return { "*": ["external_code_or_network"] };
  }
  return null;
}

function extractVersion(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : trimmed;
}

function buildSurfaceId(version, help, capturedAt) {
  const basis = `${version}\n${capturedAt}\n${help}`.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 48);
  return `surface_${basis || "unknown"}`;
}

function unique(values) {
  return [...new Set(values)];
}

function dedupeCommands(commands) {
  const seen = new Set();
  return commands.filter((command) => {
    if (seen.has(command.name)) {
      return false;
    }
    seen.add(command.name);
    return true;
  });
}

function parseUsagePositionals(line) {
  const usage = line.replace(/^usage:\s*/i, "");
  return [...usage.matchAll(/(?:^|\s)(?:<([^>-][^>]*)>|\[([^-\]][^\]]*)\])/g)]
    .map((match) => (match[1] ?? match[2]).replace(/\.\.\.$/, ""))
    .filter((name) => !["options", "command", "commands"].includes(name.toLowerCase()));
}

function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((flag) => {
    const key = flag.names.join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
