#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SERVER = path.join(ROOT, "scripts", "claude-router-mcp.mjs");
const NODE = process.execPath;

function usage() {
  return `Usage: node scripts/install-codex-mcp.mjs [options]

Options:
  --name <name>     MCP server name to register. Default: claude-router
  --codex <path>    Codex executable to use. Default: codex
  --dry-run         Print the command that would be run without changing config
  --json            Print machine-readable output
  -h, --help        Show this help
`;
}

function parseArgv(argv) {
  const options = {
    name: "claude-router",
    codex: "codex",
    dryRun: false,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--name") {
      options.name = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--name=")) {
      options.name = arg.slice("--name=".length);
    } else if (arg === "--codex") {
      options.codex = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--codex=")) {
      options.codex = arg.slice("--codex=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(options.name)) {
    throw new Error("MCP server name may only contain letters, numbers, dots, underscores, and hyphens.");
  }

  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function installCommand(options) {
  return [options.codex, "mcp", "add", options.name, "--", NODE, SERVER];
}

function formatCommand(command) {
  return command.map(shellQuote).join(" ");
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

function commandResult(result) {
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : null
  };
}

function fail(message, options = {}, details = {}) {
  if (options.json) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function print(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : value);
}

let options;
try {
  options = parseArgv(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (options.help) {
  print(usage(), false);
  process.exit(0);
}

if (!fs.existsSync(SERVER)) {
  fail(`Missing MCP server script: ${SERVER}`, options);
}

const command = installCommand(options);
const payload = {
  ok: true,
  name: options.name,
  node: NODE,
  server: SERVER,
  command,
  commandText: formatCommand(command),
  dryRun: options.dryRun
};

if (options.dryRun) {
  print(options.json ? payload : `${payload.commandText}\n`, options.json);
  process.exit(0);
}

const add = run(options.codex, ["mcp", "add", options.name, "--", NODE, SERVER]);
if (add.status !== 0 || add.error) {
  fail(`Failed to register MCP server '${options.name}'.`, options, { add: commandResult(add), command: payload.commandText });
}

const get = run(options.codex, ["mcp", "get", options.name]);
if (get.status !== 0 || get.error) {
  fail(`Registered '${options.name}', but verification failed.`, options, { add: commandResult(add), get: commandResult(get) });
}

const result = {
  ...payload,
  dryRun: false,
  add: commandResult(add),
  get: commandResult(get),
  nextStep: "Start a new Codex session so the MCP tools are loaded."
};

if (options.json) {
  print(result, true);
} else {
  print(
    [
      `Registered MCP server '${options.name}'.`,
      "",
      "Codex stored:",
      get.stdout.trimEnd(),
      "",
      "Next step: start a new Codex session so the claude_router_* tools are loaded.",
      ""
    ].join("\n"),
    false
  );
}
