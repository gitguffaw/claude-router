import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFlagName, parseClaudeArgv } from "../scripts/lib/command-parser.mjs";

test("parseClaudeArgv separates global flags from command flags", () => {
  const parsed = parseClaudeArgv(["--permission-mode", "plan", "mcp", "list", "--json"]);

  assert.deepEqual(parsed.commandPath, ["mcp", "list"]);
  assert.deepEqual(parsed.globalFlags.map((flag) => [flag.name, flag.value]), [["permission-mode", "plan"]]);
  assert.deepEqual(parsed.flags.map((flag) => [flag.name, flag.value]), [["json", true]]);
  assert.deepEqual(parsed.unknown, { commands: [], flags: [] });
});

test("parseClaudeArgv canonicalizes aliases and inline values", () => {
  const parsed = parseClaudeArgv(["claude", "--allowedTools=Bash,Read", "--permission-mode=bypassPermissions", "--prompt-json={\"env\":\"A=B\"}", "-p", "review"]);

  assert.equal(parsed.binaryIncluded, true);
  assert.equal(normalizeFlagName("allowedTools"), "allowed-tools");
  assert.deepEqual(parsed.globalFlags.map((flag) => [flag.rawName, flag.name, flag.value, flag.inline]), [
    ["--allowedTools", "allowed-tools", "Bash,Read", true],
    ["--permission-mode", "permission-mode", "bypassPermissions", true],
    ["--prompt-json", "prompt-json", "{\"env\":\"A=B\"}", true],
    ["-p", "print", true, false]
  ]);
  assert.deepEqual(parsed.commandPath, []);
  assert.deepEqual(parsed.positionals, ["review"]);
});

test("parseClaudeArgv captures passthrough after double dash", () => {
  const parsed = parseClaudeArgv(["mcp", "add", "server", "--", "npx", "pkg", "--flag"]);

  assert.deepEqual(parsed.commandPath, ["mcp", "add"]);
  assert.deepEqual(parsed.positionals, ["server"]);
  assert.deepEqual(parsed.passthrough, ["npx", "pkg", "--flag"]);
});

test("parseClaudeArgv records unknown commands and flags", () => {
  const parsed = parseClaudeArgv(["future-command", "--future-flag"]);

  assert.deepEqual(parsed.commandPath, []);
  assert.deepEqual(parsed.positionals, ["future-command"]);
  assert.deepEqual(parsed.unknown.commands, ["future-command"]);
  assert.deepEqual(parsed.unknown.flags, ["--future-flag"]);
});

test("parseClaudeArgv detects help and dry-run requests", () => {
  const parsed = parseClaudeArgv(["plugin", "tag", "--dry-run", "--help"]);

  assert.deepEqual(parsed.commandPath, ["plugin", "tag"]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.helpOnly, true);
});

test("parseClaudeArgv does not classify print prompts as commands or help", () => {
  const commandPrompt = parseClaudeArgv(["-p", "mcp", "list"]);
  const helpPrompt = parseClaudeArgv(["-p", "help"]);

  assert.deepEqual(commandPrompt.commandPath, []);
  assert.deepEqual(commandPrompt.positionals, ["mcp", "list"]);
  assert.deepEqual(commandPrompt.unknown.commands, []);
  assert.equal(helpPrompt.helpOnly, false);
  assert.deepEqual(helpPrompt.positionals, ["help"]);
});

test("parseClaudeArgv only treats enabled dry-run as dry-run", () => {
  const disabled = parseClaudeArgv(["plugin", "tag", "--dry-run=false"]);

  assert.equal(disabled.globalFlags.length, 0);
  assert.deepEqual(disabled.flags.map((flag) => [flag.name, flag.value]), [["dry-run", false]]);
  assert.equal(disabled.dryRun, false);
});

test("parseClaudeArgv does not treat a literal help argument as help-only", () => {
  const parsed = parseClaudeArgv(["mcp", "add", "help", "node"]);

  assert.deepEqual(parsed.commandPath, ["mcp", "add"]);
  assert.deepEqual(parsed.positionals, ["help", "node"]);
  assert.equal(parsed.helpOnly, false);
});

test("parseClaudeArgv records unknown subcommands under known commands", () => {
  const parsed = parseClaudeArgv(["mcp", "future-subcommand", "--json"]);

  assert.deepEqual(parsed.commandPath, ["mcp"]);
  assert.deepEqual(parsed.unknown.commands, ["mcp future-subcommand"]);
  assert.deepEqual(parsed.positionals, ["future-subcommand"]);
});

test("parseClaudeArgv canonicalizes known subcommand aliases", () => {
  const install = parseClaudeArgv(["plugin", "i", "example"]);
  const prune = parseClaudeArgv(["plugins", "autoremove"]);
  const uninstall = parseClaudeArgv(["plugin", "remove", "example"]);

  assert.deepEqual(install.commandPath, ["plugin", "install"]);
  assert.deepEqual(install.positionals, ["example"]);
  assert.deepEqual(prune.commandPath, ["plugin", "prune"]);
  assert.deepEqual(uninstall.commandPath, ["plugin", "uninstall"]);
});

test("parseClaudeArgv understands command-specific value flags", () => {
  const mcp = parseClaudeArgv(["mcp", "add", "--transport", "http", "-H", "Authorization: Bearer token", "server"]);
  const plugin = parseClaudeArgv(["plugin", "install", "example", "--scope", "project"]);

  assert.deepEqual(mcp.commandPath, ["mcp", "add"]);
  assert.deepEqual(mcp.flags.map((flag) => [flag.name, flag.value]), [
    ["transport", "http"],
    ["header", "Authorization: Bearer token"]
  ]);
  assert.deepEqual(mcp.positionals, ["server"]);
  assert.deepEqual(mcp.unknown.flags, []);
  assert.deepEqual(plugin.flags.map((flag) => [flag.name, flag.value]), [["scope", "project"]]);
});

test("parseClaudeArgv recognizes current Claude lifecycle and MCP commands", () => {
  const mcpLogin = parseClaudeArgv(["mcp", "login", "sentry", "--no-browser"]);
  const remoteControl = parseClaudeArgv(["remote-control", "--name", "Demo"]);
  const stop = parseClaudeArgv(["stop", "abc123"]);
  const gateway = parseClaudeArgv(["gateway", "--config", "gateway.yaml"]);

  assert.deepEqual(mcpLogin.commandPath, ["mcp", "login"]);
  assert.deepEqual(mcpLogin.positionals, ["sentry"]);
  assert.deepEqual(remoteControl.commandPath, ["remote-control"]);
  assert.deepEqual(stop.commandPath, ["stop"]);
  assert.deepEqual(gateway.commandPath, ["gateway"]);
  assert.deepEqual([...mcpLogin.unknown.commands, ...remoteControl.unknown.commands, ...stop.unknown.commands, ...gateway.unknown.commands], []);
});
