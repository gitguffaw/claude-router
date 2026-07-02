#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getClaudeAuthStatus, getClaudeAvailability, getClaudeMcpStatus, getClaudePluginStatus, runClaudePrintJob, runClaudeUltrareview } from "./lib/claude.mjs";
import { createContextPack } from "./lib/context-pack.mjs";
import { handleCancel, handleResult, handleStatus } from "./lib/job-commands.mjs";
import { renderModelCatalog, renderSetupReport, renderStartedJob } from "./lib/render.mjs";
import { buildRouterRequest } from "./lib/router.mjs";
import { binaryAvailable, runCommand, runProcess, spawnDetached } from "./lib/process.mjs";
import { generateJobId, readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./lib/state.mjs";
import { appendLogLine, createJobLogFile, runTrackedJob } from "./lib/tracked-jobs.mjs";
import { readGitStatus, resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { getModelCatalog } from "./lib/model-catalog.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;

const ROUTER_COMMANDS = [
  { name: "setup", summary: "Check Node, Claude CLI, auth, plugin, and MCP availability." },
  { name: "surface", summary: "Show installed Claude CLI version/help plus Claude Router coverage." },
  { name: "help", summary: "Show Claude Router help, or Claude CLI help when a command path is provided." },
  { name: "version", summary: "Show Claude Router and installed Claude CLI versions." },
  { name: "models", summary: "Show model selectors discovered from installed Claude CLI help plus curated controls." },
  { name: "raw", summary: "Run raw Claude CLI args with mutation and dangerous-permission guardrails." },
  { name: "cli", summary: "Alias for raw Claude CLI args with the same guardrails." },
  { name: "analyze", summary: "Run read-only Claude analysis in print mode." },
  { name: "plan", summary: "Run read-only Claude planning in print mode." },
  { name: "exec", summary: "Run write-capable Claude execution in print mode." },
  { name: "review", summary: "Run read-only Claude review in print mode." },
  { name: "adversarial-review", summary: "Run read-only Claude challenge review in print mode." },
  { name: "ultrareview", summary: "Run Claude's cloud-hosted ultrareview command." },
  { name: "status", summary: "List or inspect Claude Router jobs." },
  { name: "result", summary: "Show a stored Claude Router job result." },
  { name: "cancel", summary: "Cancel an active Claude Router job." }
];

function normalizeArgv(argv) {
  if (argv.length === 1) {
    return splitRawArgumentString(argv[0]);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: { C: "cwd", ...(config.aliasMap ?? {}) }
  });
}

function resolveCwd(options) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
}

async function buildSetupReport(cwd) {
  const node = binaryAvailable("node", ["--version"], { cwd });
  const claude = getClaudeAvailability(cwd);
  const auth = claude.available ? getClaudeAuthStatus(cwd) : { loggedIn: false, detail: "claude unavailable" };
  const plugins = claude.available ? getClaudePluginStatus(cwd) : { ok: false, detail: "" };
  const mcp = claude.available ? getClaudeMcpStatus(cwd) : { ok: false, detail: "" };
  const nextSteps = [];
  if (!claude.available) {
    nextSteps.push("Install Claude Code, then rerun setup.");
  }
  if (claude.available && !auth.loggedIn) {
    nextSteps.push("Run `claude auth login` or the appropriate Claude Code auth flow.");
  }
  return { ready: node.available && claude.available && auth.loggedIn, node, claude, auth, plugins, mcp, nextSteps };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
  const cwd = resolveCwd(options);
  const report = await buildSetupReport(cwd);
  output(options.json ? report : renderSetupReport(report), Boolean(options.json));
}

const COMMON_VALUES = [
  "cwd",
  "model",
  "effort",
  "permission-mode",
  "plugin-dir",
  "plugin-url",
  "mcp-config",
  "settings",
  "setting-sources",
  "add-dir",
  "base",
  "timeout",
  "agent",
  "agents",
  "allowed-tools",
  "disallowed-tools",
  "tools",
  "append-system-prompt",
  "betas",
  "debug",
  "debug-file",
  "fallback-model",
  "file",
  "from-pr",
  "input-format",
  "json-schema",
  "max-budget-usd",
  "name",
  "output-format",
  "prompt-suggestions",
  "remote-control",
  "remote-control-session-name-prefix",
  "resume",
  "session-id",
  "system-prompt",
  "tmux",
  "worktree"
];
const COMMON_BOOLEANS = [
  "json",
  "background",
  "best",
  "sonnet",
  "opus",
  "haiku",
  "long-context",
  "chrome",
  "no-chrome",
  "bare",
  "ultrathink",
  "strict-mcp-config",
  "dangerously-skip-permissions",
  "bypass-permissions",
  "allow-dangerous",
  "allow-dangerously-skip-permissions",
  "search",
  "ax-screen-reader",
  "brief",
  "continue",
  "disable-slash-commands",
  "exclude-dynamic-system-prompt-sections",
  "fork-session",
  "ide",
  "include-hook-events",
  "include-partial-messages",
  "no-session-persistence",
  "replay-user-messages",
  "safe-mode",
  "verbose"
];

function normalizeRepeatables(options) {
  for (const key of ["plugin-dir", "plugin-url", "mcp-config", "add-dir", "allowed-tools", "disallowed-tools", "tools", "betas", "file"]) {
    if (options[key] && !Array.isArray(options[key])) {
      options[key] = [options[key]];
    }
  }
  return options;
}

function commandPayload(result) {
  return {
    command: result.command,
    args: result.args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: Boolean(result.timedOut),
    error: result.error ? result.error.message : null
  };
}

function renderCommandPayload(title, payload) {
  const lines = [`# ${title}`, "", `Status: ${payload.status}${payload.timedOut ? " (timed out)" : ""}`];
  if (payload.stdout) {
    lines.push("", "STDOUT:", "```", payload.stdout.trimEnd(), "```");
  }
  if (payload.stderr) {
    lines.push("", "STDERR:", "```", payload.stderr.trimEnd(), "```");
  }
  if (payload.error) {
    lines.push("", `Error: ${payload.error}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function commandText(payload) {
  return (payload.stdout || payload.stderr || payload.error || `exit ${payload.status}`).trim();
}

function routerHelpPayload() {
  return {
    router: { name: "claude-router", version: PLUGIN_VERSION },
    usage: [
      "claude-companion.mjs [--help|-h]",
      "claude-companion.mjs [--version|-v]",
      "claude-companion.mjs <command> [args]"
    ],
    commands: ROUTER_COMMANDS,
    model_controls: [
      "--model <selector> passes any selector accepted by the installed Claude CLI, including aliases discovered from Claude help such as fable, opus, or sonnet.",
      "--best resolves to --opus.",
      "--sonnet, --opus, and --haiku are compatibility shortcuts.",
      "--effort <low|medium|high|xhigh|max> controls reasoning depth."
    ],
    examples: [
      "claude-companion.mjs version",
      "claude-companion.mjs models",
      "claude-companion.mjs help mcp add",
      "claude-companion.mjs analyze --model fable \"inspect this repository\"",
      "claude-companion.mjs adversarial-review \"challenge this design\"",
      "claude-companion.mjs exec --background \"implement the narrow fix\""
    ]
  };
}

function renderRouterHelp(payload) {
  const lines = [
    "# Claude Router",
    "",
    `Version: ${payload.router.version}`,
    "",
    "Usage:",
    ...payload.usage.map((line) => `  ${line}`),
    "",
    "Commands:",
    ...payload.commands.map((command) => `  ${command.name.padEnd(12)} ${command.summary}`),
    "",
    "Model controls:",
    ...payload.model_controls.map((control) => `  - ${control}`),
    "",
    "Examples:",
    ...payload.examples.map((example) => `  ${example}`)
  ];
  return `${lines.join("\n")}\n`;
}

function handleRouterHelp(argv) {
  const { options } = parseCommandInput(argv, { booleanOptions: ["json"] });
  const payload = routerHelpPayload();
  output(options.json ? payload : renderRouterHelp(payload), Boolean(options.json));
}

async function handleVersion(argv) {
  const { options } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
  const cwd = resolveCwd(options);
  const version = runCommand("claude", ["--version"], { cwd });
  const payload = {
    router: { name: "claude-router", version: PLUGIN_VERSION },
    claude: commandPayload(version)
  };
  if (options.json) {
    output(payload, true);
    return;
  }
  output([
    `Claude Router: ${PLUGIN_VERSION}`,
    `Claude CLI: ${commandText(payload.claude)}`,
    ""
  ].join("\n"), false);
}

function renderSurfacePayload(payload) {
  const lines = [
    "# Claude Router Surface",
    "",
    `Claude Router: ${payload.router.version}`,
    `Claude CLI: ${commandText(payload.version)}`,
    "",
    "Router commands:",
    `- Curated: ${payload.router.curatedTools.join(", ")}`,
    `- Passthrough: ${payload.router.fullSurfaceTools.join(", ")}`,
    `- ${payload.router.note}`
  ];
  if (payload.help.stdout || payload.help.stderr || payload.help.error) {
    lines.push("", "Claude CLI help:", "```", commandText(payload.help), "```");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function hasFlag(args, ...flags) {
  return args.some((arg) => flags.includes(arg) || flags.some((flag) => arg.startsWith(`${flag}=`)));
}

function rawCommandClassification(args) {
  const [first, second, third] = args;
  const helpOnly = hasFlag(args, "-h", "--help") || first === "help" || second === "help" || third === "help";
  const dryRun = hasFlag(args, "--dry-run");
  const dangerous = hasFlag(args, "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions") ||
    args.some((arg, index) => (arg === "--permission-mode" && args[index + 1] === "bypassPermissions") || arg === "--permission-mode=bypassPermissions");
  let mutating = false;
  const pluginCommand = first === "plugin" || first === "plugins";
  if (!helpOnly) {
    mutating = [
      first === "auth" && ["login", "logout"].includes(second),
      first === "setup-token",
      ["install", "update", "upgrade"].includes(first),
      first === "mcp" && ["add", "add-json", "add-from-claude-desktop", "login", "logout", "remove", "reset-project-choices"].includes(second),
      pluginCommand && ["init", "new", "install", "i", "enable", "disable", "uninstall", "remove", "update", "prune", "autoremove"].includes(second),
      pluginCommand && second === "marketplace" && ["add", "remove", "rm", "update"].includes(third),
      pluginCommand && second === "tag" && !dryRun,
      first === "project" && second === "purge" && !dryRun
    ].some(Boolean);
  }
  return { helpOnly, dryRun, dangerous, mutating };
}

function assertRawClaudeArgs(args, options = {}) {
  if (!args.length) {
    throw new Error("Provide Claude CLI args after --.");
  }
  if (args[0] === "claude") {
    throw new Error("Do not include the claude binary name; provide only Claude CLI args.");
  }
  const classification = rawCommandClassification(args);
  if (classification.dangerous && !options["allow-dangerous"]) {
    throw new Error("Raw Claude command requests dangerous permission bypass. Re-run with --allow-dangerous only if the user explicitly accepts that risk.");
  }
  if (classification.mutating && !options["allow-mutating"]) {
    throw new Error("Raw Claude command may mutate Claude/project configuration. Re-run with --allow-mutating only when the user explicitly requested this action.");
  }
  return classification;
}

async function handleSurface(argv) {
  const { options } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
  const cwd = resolveCwd(options);
  const version = runCommand("claude", ["--version"], { cwd });
  const help = runCommand("claude", ["--help"], { cwd });
  const payload = {
    router: {
      name: "claude-router",
      version: PLUGIN_VERSION,
      curatedTools: ["setup", "analyze", "plan", "exec", "review", "adversarial-review", "ultrareview", "status", "result", "cancel", "models"],
      fullSurfaceTools: ["surface", "help", "raw", "cli", "version"],
      note: "Use curated tools for managed print-mode jobs. Use help/raw for Claude CLI features not represented as curated tools."
    },
    version: commandPayload(version),
    help: commandPayload(help)
  };
  output(options.json ? payload : renderSurfacePayload(payload), Boolean(options.json));
}

async function handleClaudeHelp(argv) {
  const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
  const cwd = resolveCwd(options);
  const args = [...positionals, "--help"];
  const result = runCommand("claude", args, { cwd });
  const payload = commandPayload(result);
  output(options.json ? payload : renderCommandPayload(`claude ${args.join(" ")}`, payload), Boolean(options.json));
}

async function handleHelp(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "help"],
    aliasMap: { h: "help" }
  });
  if (!positionals.length || options.help) {
    const payload = routerHelpPayload();
    output(options.json ? payload : renderRouterHelp(payload), Boolean(options.json));
    return;
  }
  await handleClaudeHelp(argv);
}

async function handleRawClaude(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms"],
    booleanOptions: ["json", "allow-mutating", "allow-dangerous"]
  });
  const cwd = resolveCwd(options);
  const args = positionals;
  const classification = assertRawClaudeArgs(args, options);
  const timeoutMs = Math.max(1000, Number(options["timeout-ms"]) || 300000);
  const result = await runProcess("claude", args, { cwd, env: process.env, timeoutMs });
  const payload = { ...commandPayload(result), classification };
  output(options.json ? payload : renderCommandPayload(`claude ${args.join(" ")}`, payload), Boolean(options.json));
}

async function runStoredJob(workspaceRoot, jobId, env = process.env) {
  const stored = readJobFile(workspaceRoot, jobId);
  if (!stored) {
    throw new Error(`Missing stored job ${jobId}`);
  }
  const logFile = stored.logFile;
  const result = await runTrackedJob(stored, async () => {
    appendLogLine(logFile, `Invoking Claude ${stored.mode}.`);
    return runClaudePrintJob(workspaceRoot, stored.request, {
      env,
      gitBefore: stored.request.gitBefore,
      readGitStatus: () => readGitStatus(workspaceRoot),
      onProgress: (event) => appendLogLine(logFile, event.logBody ?? event.message)
    });
  });
  return result;
}

async function handleRouted(mode, argv) {
  const { options, positionals } = parseCommandInput(argv, { valueOptions: COMMON_VALUES, booleanOptions: COMMON_BOOLEANS });
  normalizeRepeatables(options);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const prompt = positionals.join(" ");
  const gitBefore = readGitStatus(workspaceRoot);
  const request = buildRouterRequest({ mode, prompt, options, gitBefore });
  const contextPack = createContextPack(workspaceRoot, request);
  const jobId = generateJobId(mode);
  const logFile = createJobLogFile(workspaceRoot, jobId, `Claude ${request.workflow}`);
  const job = {
    id: jobId,
    jobClass: "claude",
    kindLabel: request.workflow,
    mode,
    title: prompt.slice(0, 96),
    summary: prompt.slice(0, 96),
    workspaceRoot,
    status: "queued",
    phase: "queued",
    write: request.write,
    request,
    contextPack,
    logFile
  };
  upsertJob(workspaceRoot, job);
  writeJobFile(workspaceRoot, jobId, job);

  if (options.background) {
    const pid = spawnDetached(process.execPath, [SCRIPT, "run-job", "--cwd", workspaceRoot, jobId], { cwd: workspaceRoot, env: process.env });
    const backgroundJob = { ...job, status: "running", phase: "background", pid };
    upsertJob(workspaceRoot, backgroundJob);
    writeJobFile(workspaceRoot, jobId, backgroundJob);
    output(options.json ? backgroundJob : renderStartedJob(backgroundJob), Boolean(options.json));
    return;
  }

  const completed = await runStoredJob(workspaceRoot, jobId);
  output(options.json ? completed : completed.rendered, Boolean(options.json));
}

async function handleRunJob(argv) {
  const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: [] });
  const cwd = resolveCwd(options);
  await runStoredJob(cwd, positionals[0]);
}

async function handleUltrareview(argv) {
  const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd", "timeout"], booleanOptions: ["json"] });
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const result = await runClaudeUltrareview(workspaceRoot, { timeout: options.timeout, target: positionals[0] });
  output(options.json ? result : result.rendered, Boolean(options.json));
}

async function handleModels(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["capability", "cwd"],
    booleanOptions: ["json", "static"]
  });
  const cwd = resolveCwd(options);
  let claudeHelp = "";
  let claudeVersion = null;
  let discoveryStatus = options.static ? "not-run" : null;
  let discoveryError = null;
  if (!options.static) {
    const version = runCommand("claude", ["--version"], { cwd });
    if (version.status === 0 && !version.error) {
      claudeVersion = commandText(commandPayload(version));
    }
    const help = runCommand("claude", ["--help"], { cwd });
    if (help.status === 0 && !help.error) {
      claudeHelp = help.stdout || help.stderr;
    } else {
      discoveryStatus = "unavailable";
      discoveryError = commandText(commandPayload(help));
    }
  }
  const catalog = getModelCatalog({
    capability: options.capability || null,
    claudeHelp,
    claudeVersion,
    discoveryStatus,
    discoveryError
  });
  output(options.json ? catalog : renderModelCatalog(catalog), Boolean(options.json));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    handleRouterHelp(argv);
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    await handleVersion(argv);
    return;
  }
  if (command === "setup") {
    await handleSetup(argv);
  } else if (command === "surface") {
    await handleSurface(argv);
  } else if (command === "help") {
    await handleHelp(argv);
  } else if (command === "raw" || command === "cli") {
    await handleRawClaude(argv);
  } else if (["analyze", "plan", "exec", "review", "adversarial-review"].includes(command)) {
    await handleRouted(command, argv);
  } else if (command === "run-job") {
    await handleRunJob(argv);
  } else if (command === "ultrareview") {
    await handleUltrareview(argv);
  } else if (command === "status") {
    const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"], booleanOptions: ["json", "wait", "all"] });
    await handleStatus(resolveWorkspaceRoot(resolveCwd(options)), {
      reference: positionals[0] ?? "",
      json: Boolean(options.json),
      wait: Boolean(options.wait),
      all: Boolean(options.all),
      timeoutMs: options["timeout-ms"],
      pollIntervalMs: options["poll-interval-ms"]
    });
  } else if (command === "result") {
    const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
    handleResult(resolveWorkspaceRoot(resolveCwd(options)), { reference: positionals[0] ?? "", json: Boolean(options.json) });
  } else if (command === "cancel") {
    const { options, positionals } = parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] });
    handleCancel(resolveWorkspaceRoot(resolveCwd(options)), { reference: positionals[0] ?? "", json: Boolean(options.json) });
  } else if (command === "models") {
    await handleModels(argv);
  } else {
    throw new Error(`Unknown command "${command}".`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
