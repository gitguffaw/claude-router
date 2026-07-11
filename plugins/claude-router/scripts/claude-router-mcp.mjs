#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
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

// JSON-RPC 2.0 invalid params.
const INVALID_PARAMS = -32602;

export class InvalidParamsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidParamsError";
    this.code = INVALID_PARAMS;
  }
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
      timeout_ms: { type: "number", minimum: 0 },
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
      timeout_ms: { type: "number", minimum: 0 },
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

function callTool(name, input = {}) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown tool ${name}`);
  }
  validateAgainstSchema(schemaFor(tool), input ?? {});
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
  const result = spawnSync(process.execPath, args, {
    cwd: input.cwd || ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
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
    try {
      const output = callTool(message.params?.name, message.params?.arguments ?? {});
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
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported method ${message.method}` } });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    try {
      handleRequest(JSON.parse(line));
    } catch (error) {
      send({ jsonrpc: "2.0", error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
    }
  });
}
