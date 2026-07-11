#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { runProcess } from "./lib/process.mjs";
import { MCP_TOOLS, ROUTED_COMMAND_NAMES } from "./lib/router-commands.mjs";
import {
  MCP_ROUTED_BOOLEAN_CONTROLS,
  MCP_ROUTED_OPTIONAL_VALUE_CONTROLS,
  MCP_ROUTED_VALUE_CONTROLS,
  routedFlagEntries,
  routedInputSchemaProperties
} from "./lib/routed-controls.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPANION = path.join(ROOT, "scripts", "claude-companion.mjs");
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;

const tools = MCP_TOOLS;
const ROUTED_COMMANDS = ROUTED_COMMAND_NAMES;
const VALUE_FLAGS = routedFlagEntries(MCP_ROUTED_VALUE_CONTROLS);
const OPTIONAL_VALUE_FLAGS = routedFlagEntries(MCP_ROUTED_OPTIONAL_VALUE_CONTROLS);
const BOOLEAN_FLAGS = routedFlagEntries(MCP_ROUTED_BOOLEAN_CONTROLS);

// Outer bound on companion invocations so a wedged child cannot block forever.
// Exceeds companion managed default (30 min) plus kill grace.
const DEFAULT_OUTER_TIMEOUT_MS = 35 * 60 * 1000;
const OUTER_TIMEOUT_INPUT_GRACE_MS = 60000;
// Match historical spawnSync maxBuffer for companion stdout+stderr.
const COMPANION_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
// Bound concurrent tools/call dispatches; excess queue FIFO.
const MAX_CONCURRENT_TOOL_CALLS = 16;

const TIMEOUT_MS_DESCRIPTION =
  "0 disables the inner companion timeout but the MCP outer timeout (CLAUDE_ROUTER_MCP_OUTER_TIMEOUT_MS, default 35 minutes) still applies.";

// JSON-RPC 2.0 invalid params.
const INVALID_PARAMS = -32602;

/** In-flight companion process groups for shutdown sweep. Entries are { pid, processGroup }. */
const inFlightChildren = new Set();
let activeToolCalls = 0;
const toolCallQueue = [];

/**
 * Register a just-spawned companion. Must not throw (runProcess onSpawn contract).
 * @returns {object|null} entry to pass to untrackInFlightChild
 */
export function trackInFlightChild(record) {
  const pid = Number(record?.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }
  const entry = { pid, processGroup: Boolean(record?.processGroup) };
  inFlightChildren.add(entry);
  return entry;
}

export function untrackInFlightChild(entry) {
  if (entry) {
    inFlightChildren.delete(entry);
  }
}

export function getInFlightChildren() {
  return [...inFlightChildren];
}

/** Best-effort SIGTERM (or signal) to each in-flight process group; does not wait. */
export function sweepInFlightChildren(signal = "SIGTERM") {
  for (const entry of inFlightChildren) {
    try {
      if (entry.processGroup && process.platform !== "win32") {
        process.kill(-entry.pid, signal);
      } else {
        process.kill(entry.pid, signal);
      }
    } catch {
      // Already gone or not signalable.
    }
  }
}

function runWithToolCallLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeToolCalls += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          activeToolCalls -= 1;
          if (toolCallQueue.length > 0) {
            const next = toolCallQueue.shift();
            next();
          }
        });
    };
    if (activeToolCalls < MAX_CONCURRENT_TOOL_CALLS) {
      run();
    } else {
      toolCallQueue.push(run);
    }
  });
}

export class InvalidParamsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidParamsError";
    this.code = INVALID_PARAMS;
  }
}

export function defaultOuterTimeoutMs() {
  const raw = Number(process.env.CLAUDE_ROUTER_MCP_OUTER_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_OUTER_TIMEOUT_MS;
}

/**
 * Outer deadline for a companion invocation.
 * Prefer max(timeout_ms + 60s, default) so the outer never fires before the inner.
 */
export function resolveOuterTimeoutMs(inputTimeoutMs, defaultMs = defaultOuterTimeoutMs()) {
  if (inputTimeoutMs === undefined || inputTimeoutMs === null) {
    return defaultMs;
  }
  const n = Number(inputTimeoutMs);
  if (!Number.isFinite(n) || n < 0) {
    return defaultMs;
  }
  return Math.max(n + OUTER_TIMEOUT_INPUT_GRACE_MS, defaultMs);
}

/** Prefer spawn error message, then stderr/stdout, then exit status (avoids "exit null"). */
export function formatProcessFailure(result) {
  const parts = [
    result?.error?.message,
    result?.stderr,
    result?.stdout,
    result?.status === undefined || result?.status === null ? null : `exit ${result.status}`
  ];
  for (const part of parts) {
    if (part === undefined || part === null) {
      continue;
    }
    const text = String(part).trim();
    if (text) {
      return text;
    }
  }
  return "process failed";
}

export function schemaFor(tool) {
  const properties = {
    cwd: { type: "string" }
  };
  let required = [];
  if (tool.command === "models") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        capability: {
          type: "string",
          enum: ["long_context", "ultrathink", "chrome"],
          description: "Filter models to those supporting a specific capability."
        },
        static: {
          type: "boolean",
          description: "Skip live Claude CLI help discovery and return only curated model data."
        }
      },
      required: []
    };
  }
  if (ROUTED_COMMANDS.has(tool.command)) {
    Object.assign(
      properties,
      routedInputSchemaProperties({ mcpOnly: true, command: tool.command }),
      { prompt: { type: "string" } }
    );
    required = tool.prompt ? ["prompt"] : [];
  } else if (tool.command === "raw") {
    Object.assign(properties, {
      args: { type: "array", items: { type: "string" } },
      timeout_ms: {
        type: "number",
        minimum: 0,
        description: TIMEOUT_MS_DESCRIPTION
      },
      allow_mutating: { type: "boolean" },
      allow_dangerous: { type: "boolean" }
    });
    required = ["args"];
  } else if (tool.command === "help") {
    properties.args = { type: "array", items: { type: "string" } };
  } else if (tool.command === "status") {
    Object.assign(properties, {
      job_id: { type: "string" },
      wait: { type: "boolean" },
      all: { type: "boolean" },
      timeout_ms: {
        type: "number",
        minimum: 0,
        description: TIMEOUT_MS_DESCRIPTION
      },
      poll_interval_ms: { type: "number", minimum: 0 }
    });
  } else if (tool.command === "result") {
    properties.job_id = { type: "string" };
  } else if (tool.command === "cancel") {
    properties.job_id = { type: "string" };
    required = ["job_id"];
  } else if (tool.command === "ultrareview") {
    Object.assign(properties, {
      target: { type: "string" },
      timeout: { type: "string" }
    });
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function typeName(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

export function validateAgainstSchema(schema, value, path = "arguments") {
  if (!schema || typeof schema !== "object") {
    return;
  }
  if (schema.oneOf) {
    const errors = [];
    for (const variant of schema.oneOf) {
      try {
        validateAgainstSchema(variant, value, path);
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new InvalidParamsError(`${path} does not match any allowed schema variant`);
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new InvalidParamsError(`${path} must be an object`);
    }
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) {
        throw new InvalidParamsError(`Missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key)) {
          throw new InvalidParamsError(`Unknown property "${key}"`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) {
        validateAgainstSchema(propSchema, value[key], path === "arguments" ? key : `${path}.${key}`);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new InvalidParamsError(`${path} must be an array (got ${typeName(value)})`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateAgainstSchema(schema.items, item, `${path}[${index}]`);
      });
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      throw new InvalidParamsError(`${path} must be a string (got ${typeName(value)})`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new InvalidParamsError(`${path} must be one of: ${schema.enum.join(", ")}`);
    }
    return;
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidParamsError(`${path} must be a finite number (got ${typeName(value)})`);
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new InvalidParamsError(`${path} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new InvalidParamsError(`${path} must be <= ${schema.maximum}`);
    }
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new InvalidParamsError(`${path} must be a boolean (got ${typeName(value)})`);
    }
  }
}

function firstDefined(input, keys) {
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== false) {
      return input[key];
    }
  }
  return undefined;
}

function appendValue(args, input, flag, keys) {
  // Control-specific: --tools "" disables all built-in tools and must be preserved.
  if (flag === "--tools") {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        continue;
      }
      const raw = input[key];
      if (raw === "") {
        args.push(flag, "");
        return;
      }
      if (Array.isArray(raw)) {
        for (const item of raw) {
          args.push(flag, String(item));
        }
        return;
      }
    }
  }
  const value = firstDefined(input, keys);
  if (value === undefined || value === "") {
    return;
  }
  for (const item of Array.isArray(value) ? value : [value]) {
    args.push(flag, String(item));
  }
}

function appendBoolean(args, input, flag, keys) {
  if (firstDefined(input, keys) === true) {
    args.push(flag);
  }
}

function appendOptionalValue(args, input, flag, keys) {
  const value = firstDefined(input, keys);
  if (value === undefined || value === "") {
    return;
  }
  args.push(flag);
  if (value !== true) {
    args.push(String(value));
  }
}

function appendRoutedFlags(args, input) {
  for (const [flag, ...keys] of VALUE_FLAGS) {
    appendValue(args, input, flag, keys);
  }
  for (const [flag, ...keys] of OPTIONAL_VALUE_FLAGS) {
    appendOptionalValue(args, input, flag, keys);
  }
  for (const [flag, ...keys] of BOOLEAN_FLAGS) {
    appendBoolean(args, input, flag, keys);
  }
}

function buildCompanionArgs(tool, input = {}) {
  const args = [COMPANION, tool.command, "--json"];
  if (input.cwd) {
    args.push("--cwd", input.cwd);
  }
  if (ROUTED_COMMANDS.has(tool.command)) {
    appendRoutedFlags(args, input);
    // Argument boundary: every MCP prompt is data, including strings that begin with dashes.
    if (input.prompt !== undefined && input.prompt !== null) {
      args.push("--", String(input.prompt));
    }
  } else if (tool.command === "raw") {
    if (input.timeout_ms !== undefined && input.timeout_ms !== null) {
      args.push("--timeout-ms", String(input.timeout_ms));
    }
    if (input.allow_mutating || input["allow-mutating"]) {
      args.push("--allow-mutating");
    }
    if (input.allow_dangerous || input["allow-dangerous"]) {
      args.push("--allow-dangerous");
    }
    args.push("--", ...(Array.isArray(input.args) ? input.args.map(String) : []));
  } else if (tool.command === "help") {
    args.push("--", ...(Array.isArray(input.args) ? input.args.map(String) : []));
  } else if (tool.command === "status") {
    if (input.wait) {
      args.push("--wait");
    }
    if (input.all) {
      args.push("--all");
    }
    if (input.timeout_ms !== undefined && input.timeout_ms !== null) {
      args.push("--timeout-ms", String(input.timeout_ms));
    }
    if (input.poll_interval_ms !== undefined && input.poll_interval_ms !== null) {
      args.push("--poll-interval-ms", String(input.poll_interval_ms));
    }
    if (input.job_id) {
      args.push(input.job_id);
    }
  } else if (tool.command === "ultrareview") {
    if (input.timeout) {
      args.push("--timeout", String(input.timeout));
    }
    if (input.target) {
      args.push(String(input.target));
    }
  } else if (tool.command === "models") {
    if (input.capability) {
      args.push("--capability", input.capability);
    }
    if (input.static) {
      args.push("--static");
    }
  } else if (input.job_id) {
    args.push(input.job_id);
  }
  return args;
}

async function callTool(name, input = {}) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown tool ${name}`);
  }
  validateAgainstSchema(schemaFor(tool), input ?? {});
  const args = buildCompanionArgs(tool, input);
  const outerTimeoutMs = resolveOuterTimeoutMs(input.timeout_ms);
  let inFlightEntry = null;
  let result;
  try {
    result = await runProcess(process.execPath, args, {
      cwd: input.cwd || ROOT,
      env: process.env,
      timeoutMs: outerTimeoutMs,
      maxOutputBytes: COMPANION_MAX_OUTPUT_BYTES,
      // onSpawn must not throw — tracking is best-effort for shutdown sweep only.
      onSpawn: (record) => {
        inFlightEntry = trackInFlightChild(record);
      }
    });
  } finally {
    untrackInFlightChild(inFlightEntry);
  }
  if (result.outputTruncated) {
    throw new Error(
      `Claude Router MCP companion output exceeded ${COMPANION_MAX_OUTPUT_BYTES} bytes (stdout+stderr); child terminated`
    );
  }
  if (result.timedOut) {
    throw new Error(`Claude Router MCP outer timeout after ${outerTimeoutMs}ms`);
  }
  if (result.status !== 0) {
    throw new Error(formatProcessFailure(result));
  }
  return result.stdout.trim();
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleRequest(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "claude-router", version: PLUGIN_VERSION } } });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: schemaFor(tool) }))
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    // Fire-and-respond: concurrent tools/call complete independently (out-of-order OK).
    // Cap in-flight dispatches; excess queue FIFO.
    void (async () => {
      try {
        const output = await runWithToolCallLimit(() =>
          callTool(message.params?.name, message.params?.arguments ?? {})
        );
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: output }] } });
      } catch (error) {
        const code = error && typeof error === "object" && error.code === INVALID_PARAMS ? INVALID_PARAMS : -32000;
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    })();
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported method ${message.method}` } });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rl = readline.createInterface({ input: process.stdin });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // Best-effort: companions are detached process-group leaders; signal groups then exit.
    sweepInFlightChildren("SIGTERM");
    try {
      rl.close();
    } catch {
      // Already closed.
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    try {
      handleRequest(JSON.parse(line));
    } catch (error) {
      // JSON-RPC 2.0: parse errors must include id: null.
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
    }
  });
  rl.on("close", shutdown);
}
