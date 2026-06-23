#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPANION = path.join(ROOT, "scripts", "claude-companion.mjs");

const tools = [
  { name: "claude_router_setup", description: "Check local Claude CLI setup.", command: "setup" },
  { name: "claude_router_surface", description: "Report the local Claude CLI version, top-level help, and Claude Router coverage.", command: "surface" },
  { name: "claude_router_help", description: "Show local Claude CLI help for a command path.", command: "help" },
  { name: "claude_router_raw", description: "Run a raw Claude CLI command with guardrails for mutating and dangerous operations.", command: "raw" },
  { name: "claude_router_analyze", description: "Run read-only Claude analysis.", command: "analyze", prompt: true },
  { name: "claude_router_plan", description: "Run read-only Claude planning.", command: "plan", prompt: true },
  { name: "claude_router_exec", description: "Run write-capable Claude execution.", command: "exec", prompt: true },
  { name: "claude_router_review", description: "Run read-only Claude review.", command: "review", prompt: true },
  { name: "claude_router_ultrareview", description: "Run Claude ultrareview.", command: "ultrareview" },
  { name: "claude_router_status", description: "Show Claude Router jobs.", command: "status" },
  { name: "claude_router_result", description: "Show Claude Router job result.", command: "result" },
  { name: "claude_router_cancel", description: "Cancel a Claude Router job.", command: "cancel" }
];

const ROUTED_COMMANDS = new Set(["analyze", "plan", "exec", "review"]);
const VALUE_FLAGS = [
  ["--model", "model"],
  ["--effort", "effort"],
  ["--permission-mode", "permission_mode", "permission-mode"],
  ["--plugin-dir", "plugin_dir", "plugin-dir"],
  ["--plugin-url", "plugin_url", "plugin-url"],
  ["--mcp-config", "mcp_config", "mcp-config"],
  ["--settings", "settings"],
  ["--setting-sources", "setting_sources", "setting-sources"],
  ["--add-dir", "add_dir", "add-dir"],
  ["--agent", "agent"],
  ["--agents", "agents"],
  ["--allowed-tools", "allowed_tools", "allowed-tools"],
  ["--disallowed-tools", "disallowed_tools", "disallowed-tools"],
  ["--tools", "tools"],
  ["--append-system-prompt", "append_system_prompt", "append-system-prompt"],
  ["--betas", "betas"],
  ["--debug", "debug"],
  ["--debug-file", "debug_file", "debug-file"],
  ["--fallback-model", "fallback_model", "fallback-model"],
  ["--file", "file"],
  ["--from-pr", "from_pr", "from-pr"],
  ["--input-format", "input_format", "input-format"],
  ["--json-schema", "json_schema", "json-schema"],
  ["--max-budget-usd", "max_budget_usd", "max-budget-usd"],
  ["--name", "name"],
  ["--output-format", "output_format", "output-format"],
  ["--prompt-suggestions", "prompt_suggestions", "prompt-suggestions"],
  ["--remote-control", "remote_control", "remote-control"],
  ["--remote-control-session-name-prefix", "remote_control_session_name_prefix", "remote-control-session-name-prefix"],
  ["--resume", "resume"],
  ["--session-id", "session_id", "session-id"],
  ["--system-prompt", "system_prompt", "system-prompt"],
  ["--tmux", "tmux"],
  ["--worktree", "worktree"]
];
const BOOLEAN_FLAGS = [
  ["--background", "background"],
  ["--best", "best"],
  ["--sonnet", "sonnet"],
  ["--opus", "opus"],
  ["--haiku", "haiku"],
  ["--long-context", "long_context", "long-context"],
  ["--chrome", "chrome"],
  ["--no-chrome", "no_chrome", "no-chrome"],
  ["--bare", "bare"],
  ["--ultrathink", "ultrathink"],
  ["--strict-mcp-config", "strict_mcp_config", "strict-mcp-config"],
  ["--dangerously-skip-permissions", "dangerously_skip_permissions", "dangerously-skip-permissions", "bypass_permissions", "bypass-permissions"],
  ["--allow-dangerous", "allow_dangerous", "allow-dangerous"],
  ["--allow-dangerously-skip-permissions", "allow_dangerously_skip_permissions", "allow-dangerously-skip-permissions"],
  ["--ax-screen-reader", "ax_screen_reader", "ax-screen-reader"],
  ["--brief", "brief"],
  ["--continue", "continue"],
  ["--disable-slash-commands", "disable_slash_commands", "disable-slash-commands"],
  ["--exclude-dynamic-system-prompt-sections", "exclude_dynamic_system_prompt_sections", "exclude-dynamic-system-prompt-sections"],
  ["--fork-session", "fork_session", "fork-session"],
  ["--ide", "ide"],
  ["--include-hook-events", "include_hook_events", "include-hook-events"],
  ["--include-partial-messages", "include_partial_messages", "include-partial-messages"],
  ["--no-session-persistence", "no_session_persistence", "no-session-persistence"],
  ["--replay-user-messages", "replay_user_messages", "replay-user-messages"],
  ["--safe-mode", "safe_mode", "safe-mode"],
  ["--verbose", "verbose"]
];

function schemaFor(tool) {
  const properties = {
    cwd: { type: "string" },
    job_id: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    target: { type: "string" },
    background: { type: "boolean" },
    model: { type: "string" },
    effort: { type: "string" },
    chrome: { type: "boolean" },
    timeout: { type: "string" },
    timeout_ms: { type: "number" },
    wait: { type: "boolean" },
    allow_mutating: { type: "boolean" },
    allow_dangerous: { type: "boolean" },
    permission_mode: { type: "string" },
    output_format: { type: "string" },
    input_format: { type: "string" },
    mcp_config: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    plugin_dir: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    plugin_url: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    settings: { type: "string" },
    setting_sources: { type: "string" },
    add_dir: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    tools: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    allowed_tools: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    disallowed_tools: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    agent: { type: "string" },
    agents: { type: "string" },
    json_schema: { type: "string" },
    resume: { type: "string" },
    session_id: { type: "string" }
  };
  if (tool.prompt) {
    properties.prompt = { type: "string" };
  }
  return {
    type: "object",
    additionalProperties: true,
    properties,
    required: tool.command === "raw" ? ["args"] : tool.prompt ? ["prompt"] : []
  };
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

function appendRoutedFlags(args, input) {
  for (const [flag, ...keys] of VALUE_FLAGS) {
    appendValue(args, input, flag, keys);
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
  const args = [COMPANION, tool.command, "--json"];
  if (input.cwd) {
    args.push("--cwd", input.cwd);
  }
  if (ROUTED_COMMANDS.has(tool.command)) {
    appendRoutedFlags(args, input);
  }
  if (tool.command === "raw") {
    if (input.timeout_ms) {
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
    if (input.timeout_ms) {
      args.push("--timeout-ms", String(input.timeout_ms));
    }
    if (input.poll_interval_ms) {
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
  } else if (input.job_id) {
    args.push(input.job_id);
  }
  if (input.prompt) {
    args.push(input.prompt);
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
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "claude-router", version: "0.1.0" } } });
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
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
    }
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported method ${message.method}` } });
  }
}

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
