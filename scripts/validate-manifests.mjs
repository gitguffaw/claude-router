#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const agyManifestPath = path.join(root, ".agy", "plugin.json");
const agySkillPath = path.join(root, ".agy", "skills", "claude-router", "SKILL.md");
const codexManifestPath = path.join(root, "plugins", "claude-router", ".codex-plugin", "plugin.json");
const claudeMarketplacePath = path.join(root, ".claude-plugin", "marketplace.json");
const claudeManifestPath = path.join(root, "plugins", "claude-router", ".claude-plugin", "plugin.json");
const claudeCommandsPath = path.join(root, "plugins", "claude-router", "commands");
const readmePath = path.join(root, "README.md");
const runtimePath = path.join(root, "plugins", "claude-router", "scripts", "claude-companion.mjs");
const mcpPath = path.join(root, "plugins", "claude-router", "scripts", "claude-router-mcp.mjs");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${file}: ${error.message}`);
  }
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) {
    fail(`Missing ${label}: ${path.relative(root, file)}`);
  }
}

function requireString(object, key, label) {
  if (typeof object[key] !== "string" || !object[key].trim()) {
    fail(`Missing required string in ${label}: ${key}`);
  }
}

for (const [file, label] of [
  [packagePath, "package manifest"],
  [agyManifestPath, "AGY manifest"],
  [agySkillPath, "AGY claude-router skill"],
  [codexManifestPath, "Codex plugin manifest"],
  [claudeMarketplacePath, "Claude Code marketplace manifest"],
  [claudeManifestPath, "Claude Code plugin manifest"],
  [claudeCommandsPath, "Claude Code commands directory"],
  [readmePath, "README"],
  [runtimePath, "Claude Router runtime"],
  [mcpPath, "Claude Router MCP server"]
]) {
  requireFile(file, label);
}

const pkg = readJson(packagePath);
const agyManifest = readJson(agyManifestPath);
const codexManifest = readJson(codexManifestPath);
const claudeMarketplace = readJson(claudeMarketplacePath);
const claudeManifest = readJson(claudeManifestPath);

for (const [manifest, label] of [
  [pkg, "package.json"],
  [agyManifest, ".agy/plugin.json"],
  [codexManifest, ".codex-plugin/plugin.json"],
  [claudeMarketplace, ".claude-plugin/marketplace.json"],
  [claudeManifest, "plugins/claude-router/.claude-plugin/plugin.json"]
]) {
  requireString(manifest, "name", label);
  requireString(manifest, "version", label);
}

if (agyManifest.name !== "claude-router") {
  fail("AGY manifest name must be claude-router.");
}

if (codexManifest.name !== "claude-router") {
  fail("Codex plugin manifest name must be claude-router.");
}

if (claudeManifest.name !== "claude-router") {
  fail("Claude Code plugin manifest name must be claude-router.");
}

if (!Array.isArray(claudeMarketplace.plugins) || !claudeMarketplace.plugins.some((plugin) => plugin.name === "claude-router" && plugin.source === "./plugins/claude-router")) {
  fail("Claude Code marketplace must list claude-router with source ./plugins/claude-router.");
}

for (const [label, version] of [
  ["AGY manifest", agyManifest.version],
  ["Codex plugin manifest", codexManifest.version],
  ["Claude Code plugin manifest", claudeManifest.version],
  ["Claude Code marketplace", claudeMarketplace.version],
  ["Claude Code marketplace metadata", claudeMarketplace.metadata?.version],
  ["Claude Code marketplace plugin", claudeMarketplace.plugins.find((plugin) => plugin.name === "claude-router")?.version]
]) {
  if (version !== pkg.version) {
    fail(`${label} version ${version} must match package version ${pkg.version}.`);
  }
}

const agySkill = fs.readFileSync(agySkillPath, "utf8");
for (const required of ["name: claude-router", "claude-companion.mjs", "claude-router-mcp.mjs"]) {
  if (!agySkill.includes(required)) {
    fail(`AGY skill is missing required text: ${required}`);
  }
}

const readme = fs.readFileSync(readmePath, "utf8");
for (const required of ["claude plugin marketplace add", "/claude-router:models", "agy plugin validate .agy", "agy plugin install .agy", "agy plugin uninstall claude-router"]) {
  if (!readme.includes(required)) {
    fail(`README is missing required host documentation: ${required}`);
  }
}

for (const command of ["setup", "version", "models", "surface", "help", "analyze", "plan", "exec", "review", "adversarial-review", "ultrareview", "status", "result", "cancel", "raw", "cli"]) {
  const commandPath = path.join(claudeCommandsPath, `${command}.md`);
  if (!fs.existsSync(commandPath)) {
    fail(`Missing Claude Code command: ${path.relative(root, commandPath)}`);
  }
}

process.stdout.write(`Manifest validation passed: ${root}\n`);
