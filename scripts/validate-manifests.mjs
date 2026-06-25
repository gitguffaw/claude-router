#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const agyManifestPath = path.join(root, ".agy", "plugin.json");
const agySkillPath = path.join(root, ".agy", "skills", "claude-router", "SKILL.md");
const codexManifestPath = path.join(root, "plugins", "claude-router", ".codex-plugin", "plugin.json");
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
  [readmePath, "README"],
  [runtimePath, "Claude Router runtime"],
  [mcpPath, "Claude Router MCP server"]
]) {
  requireFile(file, label);
}

const pkg = readJson(packagePath);
const agyManifest = readJson(agyManifestPath);
const codexManifest = readJson(codexManifestPath);

for (const [manifest, label] of [
  [pkg, "package.json"],
  [agyManifest, ".agy/plugin.json"],
  [codexManifest, ".codex-plugin/plugin.json"]
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

for (const [label, version] of [
  ["AGY manifest", agyManifest.version],
  ["Codex plugin manifest", codexManifest.version]
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
for (const required of ["agy plugin validate .agy", "agy plugin install .agy", "agy plugin uninstall claude-router"]) {
  if (!readme.includes(required)) {
    fail(`README is missing required AGY documentation: ${required}`);
  }
}

process.stdout.write(`Manifest validation passed: ${root}\n`);
