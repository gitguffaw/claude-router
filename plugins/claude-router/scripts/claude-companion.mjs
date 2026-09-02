#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { parseClaudeArgv } from "./lib/command-parser.mjs";
import { getClaudeAuthStatus, getClaudeAvailability, getClaudeMcpStatus, getClaudePluginStatus, runClaudePrintJob, runClaudeUltrareview } from "./lib/claude.mjs";
import { createContextPack } from "./lib/context-pack.mjs";
import { handleCancel, handleResult, handleStatus } from "./lib/job-commands.mjs";
import { renderModelCatalog, renderSetupReport, renderStartedJob } from "./lib/render.mjs";
import { ROUTER_COMMANDS } from "./lib/router-commands.mjs";
import { ROUTER_OWNED_CONTROLS } from "./lib/routed-controls.mjs";
import { buildRouterRequest } from "./lib/router.mjs";
import { binaryAvailable, runCommand, runProcess, spawnDetached, terminateProcessTree } from "./lib/process.mjs";
import { generateJobId, readJobFile, resolveJobFile, transitionJob } from "./lib/state.mjs";
import { appendLogLine, cancelledJobResult, createJobLogFile, isCancelInProgress, runTrackedJob, TERMINAL_JOB_STATUSES } from "./lib/tracked-jobs.mjs";
import { readGitStatus, resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { getModelCatalog } from "./lib/model-catalog.mjs";
import {
  assertLiveControlSafety,
  discoverClaudeControls,
  liveControlParseConfig,
  mergeNativeCatalog
} from "./lib/live-controls.mjs";
import { parseClaudeHelp } from "./lib/claude-surface.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;

function normalizeArgv(argv) {
  if (argv[0] !== "--raw-arg-string") {
    return argv;
  }
  if (argv.length !== 2) {
    throw new Error(
      "--raw-arg-string requires exactly one following token: the raw argument string"
    );
  }
  return splitRawArgumentString(argv[1]);
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: { C: "cwd", ...(config.aliasMap ?? {}) },
    repeatableOptions: config.repeatableOptions ?? [],
    optionalValueOptions: config.optionalValueOptions ?? []
  });
}

function resolveCwd(options) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
}

function parseNonNegativeTimeoutMs(value, defaultValue) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  // Number(" ") coerces to 0, which would silently disable the timeout.
  const parsed = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid timeout "${value}". Use a non-negative millisecond value.`);
  }
  return parsed;
}

async function buildSetupReport(cwd) {
  const node = binaryAvailable("node", ["--version"], { cwd });
  const claude = getClaudeAvailability(cwd);
  const auth = claude.available ? getClaudeAuthStatus(cwd) : { loggedIn: false, detail: "claude unavailable" };
  const rawPlugins = claude.available ? getClaudePluginStatus(cwd) : { ok: false, detail: "" };
  const rawMcp = claude.available ? getClaudeMcpStatus(cwd) : { ok: false, detail: "" };
  const plugins = {
    ...rawPlugins,
    ok: rawPlugins.ok && /claude-router/i.test(rawPlugins.detail || ""),
    checked: rawPlugins.ok
  };
  const mcp = {
    ...rawMcp,
    ok: rawMcp.ok && /claude-router/i.test(rawMcp.detail || ""),
    checked: rawMcp.ok
  };
  const nextSteps = [];
  if (!claude.available) {
    nextSteps.push("Install Claude Code, then rerun setup.");
  }
  if (claude.available && !auth.loggedIn) {
    nextSteps.push("Run `claude auth login` or the appropriate Claude Code auth flow.");
  }
  if (claude.available && !plugins.ok) {
    nextSteps.push("Install or enable the Claude Router Claude Code plugin, then rerun setup.");
  }
  if (claude.available && !mcp.ok) {
    nextSteps.push("Register or reconnect the claude-router MCP server if this host should expose router tools through Claude MCP.");
  }
  return {
    ready: node.available && claude.available && auth.loggedIn && plugins.ok && mcp.ok,
    coreReady: node.available && claude.available && auth.loggedIn,
    node,
    claude,
    auth,
    plugins,
    mcp,
    nextSteps
  };
}

async function handleSetup(argv) {
  return runSetup(parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
}

async function runSetup({ options }) {
  const cwd = resolveCwd(options);
  const report = await buildSetupReport(cwd);
  output(options.json ? report : renderSetupReport(report), Boolean(options.json));
}

function normalizeRepeatables(options, repeatableOptions = []) {
  for (const key of repeatableOptions) {
    if (options[key] && !Array.isArray(options[key])) {
      options[key] = [options[key]];
    }
  }
  return options;
}

function discoverRoutedSurface(cwd = process.cwd()) {
  const liveHelpResult = runCommand("claude", ["--help"], { cwd });
  const liveHelp = liveHelpResult.status === 0 && !liveHelpResult.error
    ? (liveHelpResult.stdout || liveHelpResult.stderr)
    : "";
  return {
    liveHelp,
    nativeControls: mergeNativeCatalog(liveHelp)
  };
}

function parseRoutedInput(argv, nativeControls) {
  const liveConfig = liveControlParseConfig([...ROUTER_OWNED_CONTROLS, ...nativeControls]);
  const parsed = parseCommandInput(argv, {
    valueOptions: liveConfig.valueOptions,
    booleanOptions: liveConfig.booleanOptions,
    repeatableOptions: liveConfig.repeatableOptions,
    optionalValueOptions: liveConfig.optionalValueOptions,
    aliasMap: liveConfig.aliasMap
  });
  normalizeRepeatables(parsed.options, liveConfig.repeatableOptions);
  return parsed;
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
      "--model <selector> and --effort <value> pass opaque values to the installed Claude CLI; run models to inspect its current examples and choices.",
      "--lean[=auto|oauth|api] starts a minimal-context profile. OAuth uses --safe-mode; API credentials use --bare.",
      "--tools and --system-prompt override the lean profile's minimal defaults.",
      "--best, --sonnet, --opus, --haiku, --long-context, and --ultrathink remain legacy router conveniences; prefer live native selectors and fields.",
      "--timeout-ms <milliseconds> bounds managed routed print jobs; use 0 to disable the managed timeout for that job."
    ],
    examples: [
      "claude-companion.mjs version",
      "claude-companion.mjs models",
      "claude-companion.mjs help mcp add",
      "claude-companion.mjs analyze --lean --model fable --effort max \"inspect this repository\"",
      "claude-companion.mjs exec --lean=api --model fable --tools Bash,Read,Edit,Write \"implement the narrow fix\"",
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
  return runRouterHelp(parseCommandInput(argv, { booleanOptions: ["json"] }));
}

function runRouterHelp({ options } = { options: {} }) {
  const payload = routerHelpPayload();
  output(options.json ? payload : renderRouterHelp(payload), Boolean(options.json));
}

async function handleVersion(argv) {
  return runVersion(parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
}

async function runVersion({ options }) {
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
    `- Managed work: ${payload.router.managedWorkTools.join(", ")}`,
    `- Live discovery: ${payload.router.discoveryTools.join(", ")}`,
    `- Job lifecycle: ${payload.router.jobTools.join(", ")}`,
    `- Guarded full surface: ${payload.router.fullSurfaceTools.join(", ")}`,
    `- ${payload.router.note}`
  ];
  if (payload.help.stdout || payload.help.stderr || payload.help.error) {
    lines.push("", "Claude CLI help:", "```", commandText(payload.help), "```");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function rawCommandClassification(args, parserOptions = {}) {
  const parsed = parseClaudeArgv(args, parserOptions);
  const [first, second] = parsed.commandPath;
  const third = parsed.positionals[0];
  const allFlags = [...parsed.globalFlags, ...parsed.flags];
  const flagValue = (name) => allFlags.find((flag) => flag.name === name)?.value;
  const helpOnly = parsed.helpOnly;
  const dryRun = parsed.dryRun;
  const dangerous = ["dangerously-skip-permissions", "allow-dangerously-skip-permissions", "bypass-permissions"].some((name) => flagValue(name) === true) ||
    flagValue("permission-mode") === "bypassPermissions";
  let mutating = false;
  const pluginCommand = first === "plugin" || first === "plugins";
  if (!helpOnly) {
    mutating = [
      first === "auth" && ["login", "logout"].includes(second),
      first === "setup-token",
      ["rm", "stop", "respawn"].includes(first),
      ["install", "update", "upgrade"].includes(first),
      first === "mcp" && ["add", "add-json", "add-from-claude-desktop", "login", "logout", "remove", "reset-project-choices"].includes(second),
      pluginCommand && ["init", "new", "install", "i", "enable", "disable", "uninstall", "remove", "update", "prune", "autoremove"].includes(second),
      pluginCommand && second === "marketplace" && ["add", "remove", "rm", "update"].includes(third),
      pluginCommand && second === "tag" && !dryRun,
      first === "project" && second === "purge" && !dryRun
    ].some(Boolean);
  }
  const safeRead = [
    first === "auth" && second === "status",
    first === "doctor",
    first === "mcp" && ["get", "list"].includes(second),
    pluginCommand && ["details", "list", "validate"].includes(second),
    first === "auto-mode" && ["config", "critique", "defaults"].includes(second)
  ].some(Boolean);
  const hasUnknownSurface = parsed.unknown.commands.length > 0 || parsed.unknown.flags.length > 0;
  const unclassifiedCommand = !helpOnly && !mutating && (
    (parsed.commandPath.length > 0 && !safeRead) || hasUnknownSurface
  );
  return { helpOnly, dryRun, dangerous, mutating, unclassifiedCommand, commandPath: parsed.commandPath, unknown: parsed.unknown };
}

function assertRawClaudeArgs(args, options = {}, parserOptions = {}) {
  if (!args.length) {
    throw new Error("Provide Claude CLI args after --.");
  }
  if (args[0] === "claude") {
    throw new Error("Do not include the claude binary name; provide only Claude CLI args.");
  }
  const classification = rawCommandClassification(args, parserOptions);
  if (classification.dangerous && !options["allow-dangerous"]) {
    throw new Error("Raw Claude command requests dangerous permission bypass. Re-run with --allow-dangerous only if the user explicitly accepts that risk.");
  }
  if (classification.mutating && !options["allow-mutating"]) {
    throw new Error("Raw Claude command may mutate Claude/project configuration. Re-run with --allow-mutating only when the user explicitly requested this action.");
  }
  if (classification.unclassifiedCommand && !options["allow-mutating"]) {
    throw new Error("Raw Claude command is present in the live CLI but has no router safety classification yet. Re-run with --allow-mutating only when the user explicitly requested it.");
  }
  return classification;
}

async function handleSurface(argv) {
  return runSurface(parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
}

async function runSurface({ options }) {
  const cwd = resolveCwd(options);
  const version = runCommand("claude", ["--version"], { cwd });
  const help = runCommand("claude", ["--help"], { cwd });
  const payload = {
    router: {
      name: "claude-router",
      version: PLUGIN_VERSION,
      managedWorkTools: ["analyze", "plan", "exec", "review", "adversarial-review", "ultrareview"],
      discoveryTools: ["setup", "models", "surface", "help", "version"],
      jobTools: ["status", "result", "cancel"],
      fullSurfaceTools: ["raw", "cli"],
      note: "Managed work modes enforce job and permission boundaries. Discovery reads the installed CLI. Raw access keeps mutation and permission-bypass guardrails."
    },
    version: commandPayload(version),
    help: commandPayload(help)
  };
  output(options.json ? payload : renderSurfacePayload(payload), Boolean(options.json));
}

async function handleClaudeHelp(argv) {
  return runClaudeHelp(parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
}

async function runClaudeHelp({ options, positionals }) {
  const cwd = resolveCwd(options);
  const args = [...positionals, "--help"];
  const result = runCommand("claude", args, { cwd });
  const payload = commandPayload(result);
  output(options.json ? payload : renderCommandPayload(`claude ${args.join(" ")}`, payload), Boolean(options.json));
}

async function handleHelp(argv) {
  return runHelp(parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "help"],
    aliasMap: { h: "help" }
  }));
}

async function runHelp({ options, positionals }) {
  if (!positionals.length || options.help) {
    const payload = routerHelpPayload();
    output(options.json ? payload : renderRouterHelp(payload), Boolean(options.json));
    return;
  }
  await runClaudeHelp({ options, positionals });
}

async function handleRawClaude(argv) {
  return runRawClaude(parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms"],
    booleanOptions: ["json", "allow-mutating", "allow-dangerous"]
  }));
}

async function runRawClaude({ options, positionals }) {
  const cwd = resolveCwd(options);
  const args = positionals;
  const help = runCommand("claude", ["--help"], { cwd });
  const helpText = help.status === 0 && !help.error ? (help.stdout || help.stderr) : "";
  const liveControls = discoverClaudeControls(helpText);
  const parsedHelp = parseClaudeHelp(helpText);
  const classification = assertRawClaudeArgs(args, options, {
    valueFlags: liveControls.filter((control) => control.kind === "value").flatMap((control) => [control.option, ...control.optionAliases]),
    booleanFlags: liveControls.filter((control) => control.kind !== "value").flatMap((control) => [control.option, ...control.optionAliases]),
    commands: parsedHelp.commands.flatMap((command) => [command.name, ...command.aliases])
  });
  const timeoutMs = parseNonNegativeTimeoutMs(options["timeout-ms"], 300000);
  const result = await runProcess("claude", args, { cwd, env: process.env, timeoutMs });
  const payload = { ...commandPayload(result), classification };
  output(options.json ? payload : renderCommandPayload(`claude ${args.join(" ")}`, payload), Boolean(options.json));
}

async function runStoredJob(workspaceRoot, jobId, options = {}) {
  const env = options.env ?? process.env;
  const backgroundWorker = Boolean(options.backgroundWorker);
  const stored = readJobFile(workspaceRoot, jobId);
  if (!stored) {
    throw new Error(`Missing stored job ${jobId}`);
  }
  const logFile = stored.logFile;
  const result = await runTrackedJob(stored, async (hooks) => {
    appendLogLine(logFile, `Invoking Claude ${stored.mode}.`);
    return runClaudePrintJob(workspaceRoot, stored.request, {
      env,
      // Background workers are themselves process-group leaders; Claude stays attached.
      // Foreground companions detach Claude on POSIX and persist the child identity for cancel.
      detached: backgroundWorker ? false : undefined,
      gitBefore: stored.request.gitBefore,
      readGitStatus: () => readGitStatus(workspaceRoot),
      onProgress: (event) => appendLogLine(logFile, event.logBody ?? event.message),
      onSpawn: backgroundWorker
        ? undefined
        : (processRecord) => {
          hooks.updateProcess(processRecord);
        }
    });
  }, { processGroup: backgroundWorker, trackChildProcess: !backgroundWorker });
  return result;
}

async function handleRouted(mode, argv) {
  // Claude's top-level surface is binary-scoped, so discover it before parsing
  // routed values. A preliminary --cwd parse could mistake a quoted flag-like
  // value (for example a system prompt equal to "--cwd") for router control.
  const { nativeControls, liveHelp } = discoverRoutedSurface();
  const parsed = parseRoutedInput(argv, nativeControls);
  return runRouted(mode, parsed, { nativeControls, liveHelp });
}

async function runRouted(mode, { options, positionals }, { nativeControls, liveHelp } = {}) {
  const catalog = nativeControls ?? mergeNativeCatalog(liveHelp ?? "");
  assertLiveControlSafety(options, catalog);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const prompt = positionals.join(" ");
  const gitBefore = readGitStatus(workspaceRoot);
  const auth = options.lean ? getClaudeAuthStatus(cwd) : null;
  const availableFlags = liveHelp
    ? new Set(discoverClaudeControls(liveHelp).map((control) => control.flag))
    : null;
  const request = buildRouterRequest({
    mode,
    prompt,
    options,
    gitBefore,
    runtime: { auth, env: process.env, availableFlags },
    nativeControls: catalog
  });
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
  const created = transitionJob(workspaceRoot, jobId, (current) => {
    if (current && (current.status === "cancelled" || isCancelInProgress(current) || TERMINAL_JOB_STATUSES.has(current.status))) {
      return { apply: false, reason: "exists-terminal", job: current };
    }
    return {
      apply: true,
      reason: "create-queued",
      job: {
        ...(current ?? {}),
        ...job
      }
    };
  });
  if (!created.applied) {
    throw new Error(`Unable to create job ${jobId}: ${created.reason}`);
  }

  if (options.background) {
    const processRecord = spawnDetached(process.execPath, [SCRIPT, "run-job", "--cwd", workspaceRoot, jobId], {
      cwd: workspaceRoot,
      env: { ...process.env, CLAUDE_ROUTER_BACKGROUND: "1" }
    });
    const transition = transitionJob(workspaceRoot, jobId, (current) => {
      if (!current) {
        return { apply: false, reason: "missing" };
      }
      if (current.status === "cancelled" || isCancelInProgress(current) || TERMINAL_JOB_STATUSES.has(current.status)) {
        return {
          apply: false,
          reason: current.status === "cancelled" || isCancelInProgress(current) ? "cancelled" : "terminal",
          job: current
        };
      }
      return {
        apply: true,
        reason: "background-running",
        job: {
          ...current,
          status: "running",
          phase: "background",
          pid: processRecord.pid,
          processStartTime: processRecord.processStartTime,
          processGroup: processRecord.processGroup
        }
      };
    });
    if (!transition.applied) {
      await terminateProcessTree(processRecord, {
        allowUnverified: true,
        stopGraceMs: 200,
        hardTimeoutMs: 2000,
        pollIntervalMs: 25
      });
      if (transition.job?.status === "cancelled" || isCancelInProgress(transition.job)) {
        const cancelled = cancelledJobResult(transition.job);
        output(options.json ? cancelled : `Cancelled Claude Router job ${cancelled.id}.\n`, Boolean(options.json));
        return;
      }
      throw new Error(`Unable to record background job ${jobId}: ${transition.reason}`);
    }
    output(options.json ? transition.job : renderStartedJob(transition.job), Boolean(options.json));
    return;
  }

  const completed = await runStoredJob(workspaceRoot, jobId);
  if (options.json) {
    output(completed, true);
    return;
  }
  const rendered = completed.rendered
    ?? (completed.status === "cancelled" ? `Cancelled Claude Router job ${completed.id}.\n` : null)
    ?? `# Claude Job ${completed.status}\n\nJob ${completed.id} finished with status ${completed.status}.\n`;
  output(rendered, false);
}

async function handleRunJob(argv) {
  return runRunJob(parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: [] }));
}

async function runRunJob({ options, positionals }) {
  const cwd = resolveCwd(options);
  await runStoredJob(cwd, positionals[0], { backgroundWorker: process.env.CLAUDE_ROUTER_BACKGROUND === "1" });
}

async function handleUltrareview(argv) {
  return runUltrareview(parseCommandInput(argv, { valueOptions: ["cwd", "timeout"], booleanOptions: ["json"] }));
}

async function runUltrareview({ options, positionals }) {
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const result = await runClaudeUltrareview(workspaceRoot, { timeout: options.timeout, target: positionals[0] });
  output(options.json ? result : result.rendered, Boolean(options.json));
}

async function handleModels(argv) {
  return runModels(parseCommandInput(argv, {
    valueOptions: ["capability", "cwd"],
    booleanOptions: ["json", "static"]
  }));
}

async function runModels({ options }) {
  if (options.static) {
    throw new Error("--static was removed: the models catalog now always reads the installed Claude CLI so it cannot silently go stale.");
  }
  const cwd = resolveCwd(options);
  let claudeHelp = "";
  let claudeVersion = null;
  let discoveryStatus = null;
  let discoveryError = null;
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
  const catalog = getModelCatalog({
    capability: options.capability || null,
    claudeHelp,
    claudeVersion,
    discoveryStatus,
    discoveryError
  });
  output(options.json ? catalog : renderModelCatalog(catalog), Boolean(options.json));
}

function jsonRequestToParsed(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("JSON request must be an object.");
  }
  const options = { json: true };
  for (const [key, value] of Object.entries(request)) {
    if (["command", "prompt", "args", "job_id", "target"].includes(key)) {
      continue;
    }
    options[key.replaceAll("_", "-")] = value;
  }
  let positionals = [];
  if (Object.prototype.hasOwnProperty.call(request, "prompt") && request.prompt != null) {
    positionals = [String(request.prompt)];
  } else if (Array.isArray(request.args)) {
    positionals = request.args.map(String);
  } else if (request.job_id) {
    positionals = [String(request.job_id)];
  } else if (request.target) {
    positionals = [String(request.target)];
  }
  return { options, positionals };
}

async function runJobQuery(kind, { options, positionals }) {
  const workspaceRoot = resolveWorkspaceRoot(resolveCwd(options));
  if (kind === "status") {
    await handleStatus(workspaceRoot, {
      reference: positionals[0] ?? "",
      json: Boolean(options.json),
      wait: Boolean(options.wait),
      all: Boolean(options.all),
      timeoutMs: options["timeout-ms"],
      pollIntervalMs: options["poll-interval-ms"]
    });
    return;
  }
  if (kind === "result") {
    handleResult(workspaceRoot, { reference: positionals[0] ?? "", json: Boolean(options.json) });
    return;
  }
  await handleCancel(workspaceRoot, { reference: positionals[0] ?? "", json: Boolean(options.json) });
}

async function dispatchParsed(command, parsed) {
  if (!command || command === "--help" || command === "-h" || command === "help") {
    if (!command || command === "--help" || command === "-h" || !parsed.positionals.length || parsed.options.help) {
      runRouterHelp(parsed);
      return;
    }
    await runHelp(parsed);
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    await runVersion(parsed);
    return;
  }
  if (command === "setup") {
    await runSetup(parsed);
  } else if (command === "surface") {
    await runSurface(parsed);
  } else if (command === "raw" || command === "cli") {
    await runRawClaude(parsed);
  } else if (["analyze", "plan", "exec", "review", "adversarial-review"].includes(command)) {
    const cwd = parsed.options.cwd ? resolveCwd(parsed.options) : process.cwd();
    const surface = discoverRoutedSurface(cwd);
    normalizeRepeatables(parsed.options, liveControlParseConfig([...ROUTER_OWNED_CONTROLS, ...surface.nativeControls]).repeatableOptions);
    await runRouted(command, parsed, surface);
  } else if (command === "run-job") {
    await runRunJob(parsed);
  } else if (command === "ultrareview") {
    await runUltrareview(parsed);
  } else if (command === "status" || command === "result" || command === "cancel") {
    await runJobQuery(command, parsed);
  } else if (command === "models") {
    await runModels(parsed);
  } else {
    throw new Error(`Unknown command "${command}".`);
  }
}

function readStdinUtf8() {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const bytesRead = fs.readSync(0, buf, 0, buf.length, null);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    } catch (error) {
      if (error.code !== "EAGAIN" && error.code !== "EWOULDBLOCK") {
        throw error;
      }
      if (Date.now() >= deadline) {
        if (chunks.length) {
          break;
        }
        throw new Error("JSON request stdin was empty.");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleJsonRequest() {
  const request = JSON.parse(readStdinUtf8());
  if (!request?.command) {
    throw new Error("JSON request missing command.");
  }
  await dispatchParsed(request.command, jsonRequestToParsed(request));
}

async function main() {
  if (process.argv[2] === "--json-request") {
    await handleJsonRequest();
    return;
  }
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
    await runJobQuery("status", parseCommandInput(argv, {
      valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
      booleanOptions: ["json", "wait", "all"]
    }));
  } else if (command === "result") {
    await runJobQuery("result", parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
  } else if (command === "cancel") {
    await runJobQuery("cancel", parseCommandInput(argv, { valueOptions: ["cwd"], booleanOptions: ["json"] }));
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
