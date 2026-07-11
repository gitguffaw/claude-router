import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS, MCP_UNEXPOSED_COMMANDS, ROUTER_COMMANDS } from "../scripts/lib/router-commands.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Claude Code plugin command palette exposes expected commands", () => {
  const commandFiles = fs.readdirSync(path.join(ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "analyze.md",
    "cancel.md",
    "cli.md",
    "exec.md",
    "help.md",
    "models.md",
    "plan.md",
    "raw.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md",
    "surface.md",
    "ultrareview.md",
    "version.md"
  ]);
});

test("runtime command metadata stays aligned with host adapters", () => {
  const commandFileNames = fs.readdirSync(path.join(ROOT, "commands"))
    .map((file) => file.replace(/\.md$/, ""))
    .sort();
  const runtimeCommands = ROUTER_COMMANDS.map((command) => command.name).sort();
  const mcpCommands = MCP_TOOLS.map((tool) => tool.command).sort();
  const expectedMcpCommands = runtimeCommands.filter((command) => !MCP_UNEXPOSED_COMMANDS.has(command)).sort();

  assert.deepEqual(commandFileNames, runtimeCommands);
  assert.deepEqual(mcpCommands, expectedMcpCommands);
});

test("deterministic command files invoke the shared companion runtime", () => {
  for (const [file, command] of [
    ["setup.md", "setup"],
    ["version.md", "version"],
    ["models.md", "models"],
    ["surface.md", "surface"],
    ["help.md", "help"],
    ["ultrareview.md", "ultrareview"],
    ["status.md", "status"],
    ["result.md", "result"],
    ["cancel.md", "cancel"]
  ]) {
    const source = read(path.join("commands", file));
    assert.match(source, /disable-model-invocation:\s*true/);
    assert.match(source, new RegExp(`claude-companion\\.mjs" ${command} --raw-arg-string "\\\$ARGUMENTS"`));
  }

  const status = read("commands/status.md");
  assert.match(status, /--all/);
});

test("routed command files preserve mode boundaries", () => {
  const analyze = read("commands/analyze.md");
  const plan = read("commands/plan.md");
  const exec = read("commands/exec.md");
  const review = read("commands/review.md");
  const adversarial = read("commands/adversarial-review.md");

  assert.match(analyze, /claude-companion\.mjs" analyze --raw-arg-string "\$ARGUMENTS"/);
  assert.match(analyze, /read-only/i);
  assert.match(analyze, /does not expose a generic native web-search mode/i);
  assert.match(plan, /claude-companion\.mjs" plan --raw-arg-string "\$ARGUMENTS"/);
  assert.match(plan, /read-only/i);
  assert.match(exec, /claude-companion\.mjs" exec --raw-arg-string "\$ARGUMENTS"/);
  assert.match(exec, /write-capable/i);
  assert.match(review, /claude-companion\.mjs" review --raw-arg-string "\$ARGUMENTS"/);
  assert.match(review, /review-only/i);
  assert.match(adversarial, /claude-companion\.mjs" adversarial-review --raw-arg-string "\$ARGUMENTS"/);
  assert.match(adversarial, /challenges implementation approach/i);
});

test("raw and cli commands expose guarded Claude CLI passthrough", () => {
  const raw = read("commands/raw.md");
  const cli = read("commands/cli.md");

  assert.match(raw, /claude-companion\.mjs" raw --raw-arg-string "\$ARGUMENTS"/);
  assert.match(raw, /mcp list/);
  assert.match(raw, /plugin list/);
  assert.match(raw, /Mutating Claude configuration commands and dangerous permission bypasses are blocked by default/i);
  assert.match(cli, /alias for `\/claude-router:raw`/i);
  assert.match(cli, /claude-companion\.mjs" raw --raw-arg-string "\$ARGUMENTS"/);
});

test("Claude Code plugin manifests align with package metadata", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "..", "package.json"), "utf8"));
  const pluginManifest = JSON.parse(read(".claude-plugin/plugin.json"));
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"));

  assert.equal(pluginManifest.name, "claude-router");
  assert.equal(pluginManifest.version, packageJson.version);
  assert.equal(marketplace.version, packageJson.version);
  assert.equal(marketplace.metadata.version, packageJson.version);
  assert.equal(marketplace.plugins[0].version, packageJson.version);
  assert.equal(marketplace.plugins[0].source, "./plugins/claude-router");
});
