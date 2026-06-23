import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureClaudeSurface, parseClaudeHelp } from "../scripts/lib/claude-surface.mjs";
import { buildEnv, makeTempDir } from "./helpers.mjs";
import { validateSchema } from "./support/schema-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "claude-router-v2.schema.json"), "utf8"));

test("parseClaudeHelp extracts commands and flags from help text", () => {
  const parsed = parseClaudeHelp(`Usage: claude [options] [command]

Commands:
  mcp       Manage MCP servers
  plugin|plugins  Manage plugins
            projected descriptions should not become commands
            configuration
  agents    Manage background agents

Options:
  -p, --print                 Print and exit
  --permission-mode <mode>    Permission mode
  --allowedTools <tools...>   Allowed tools
  --always-approve            Skip approval prompts
      --settings should not be parsed from wrapped descriptions
`);

  assert.deepEqual(parsed.commands, [
    { name: "mcp", aliases: [] },
    { name: "plugin", aliases: ["plugins"] },
    { name: "agents", aliases: [] }
  ]);
  assert.deepEqual(parsed.flags.map((flag) => flag.names), [["-p", "--print"], ["--permission-mode"], ["--allowedTools"], ["--always-approve"]]);
  assert.equal(parsed.flags[1].requiresValue, true);
  assert.deepEqual(parsed.flags[1].valueHint, "mode");
  assert.equal(parsed.flags[2].requiresValue, true);
});

test("captureClaudeSurface builds a V2 surface snapshot from fake claude help", () => {
  const bin = makeTempDir();
  const fake = path.join(bin, "claude");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2.1.185 (Claude Code)");
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "add" && args.includes("--help")) {
  console.log("Usage: claude mcp add <name> <commandOrUrl> [args...]\\n\\nOptions:\\n  --transport <transport> Transport type\\n  -H, --header <header...> Secret header\\n\\nExamples:\\n  claude mcp add example --header \\"Authorization: Bearer token\\"");
  process.exit(0);
}
if (args[0] === "mcp" && args.includes("--help")) {
  console.log("Usage: claude mcp [command]\\n\\nCommands:\\n  list      List servers\\n  get       Get server\\n  add [options] <name> <commandOrUrl> [args...]\\n\\nExamples:\\n  claude mcp add example node server.js\\n\\n  remove    Remove server\\n  serve     Serve MCP\\n           specific continuation text should not become a command\\n           available\\n\\nOptions:\\n  --json    JSON output");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Usage: claude [options] [command] [prompt]\\n\\nCommands:\\n  mcp       Manage MCP servers\\n  plugin|plugins    Manage plugins\\n\\nOptions:\\n  -p, --print                 Print and exit\\n  --permission-mode <mode>    Permission mode\\n  --always-approve            Skip approval prompts");
  process.exit(0);
}
console.log("fake claude");
`, "utf8");
  fs.chmodSync(fake, 0o755);

  const snapshot = captureClaudeSurface({
    cwd: bin,
    env: buildEnv(bin),
    capturedAt: "2026-06-23T14:00:00.000Z",
    subcommands: ["mcp"]
  });

  assert.equal(snapshot.version, "2.1.185");
  assert.equal(snapshot.binary, "claude");
  assert.deepEqual(validateSchema(SCHEMA, snapshot, "ClaudeSurfaceSnapshot"), []);
  assert.equal(Object.hasOwn(snapshot, "raw"), false);
  assert.deepEqual(snapshot.flags.map((flag) => flag.names), [["-p", "--print"], ["--permission-mode"], ["--always-approve"]]);
  assert.deepEqual(snapshot.commands.find((command) => command.id === "command.claude.mcp").positionals, []);
  assert.deepEqual(snapshot.commands.find((command) => command.id === "command.claude.plugin").aliases, ["plugins"]);
  assert.deepEqual(snapshot.commands.map((command) => command.commandPath), [["mcp"], ["plugin"], ["mcp", "list"], ["mcp", "get"], ["mcp", "add"], ["mcp", "remove"], ["mcp", "serve"]]);
  assert.deepEqual(snapshot.commands.find((command) => command.id === "command.claude.mcp.add").flags.map((flag) => flag.names), [["--transport"], ["-H", "--header"]]);
  assert.deepEqual(snapshot.commands.find((command) => command.id === "command.claude.mcp.add").flags[0].appliesTo, ["mcp add"]);
  assert.deepEqual(snapshot.commands.find((command) => command.id === "command.claude.mcp.add").positionals, ["name", "commandOrUrl", "args"]);
  assert.equal(snapshot.commands.find((command) => command.id === "command.claude.mcp.add").flags.find((flag) => flag.names.includes("--header")).sensitive, true);
  assert.deepEqual(snapshot.flags.find((flag) => flag.names.includes("--permission-mode")).riskByValue.bypassPermissions, ["privilege_bypass"]);
  assert.deepEqual(snapshot.flags.find((flag) => flag.names.includes("--always-approve")).riskByValue.true, ["privilege_bypass"]);
  assert.equal(snapshot.commands.find((command) => command.id === "command.claude.mcp.list").defaultDecision, "allow");
  assert.equal(snapshot.commands.find((command) => command.id === "command.claude.mcp.add").defaultDecision, "block");
});
