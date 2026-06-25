#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, ".agy", "plugin.json");
const skillPath = path.join(root, ".agy", "skills", "claude-router", "SKILL.md");
const packagePath = path.join(root, "package.json");
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

function requireString(object, key) {
  if (typeof object[key] !== "string" || !object[key].trim()) {
    fail(`Missing required string: ${key}`);
  }
}

requireFile(manifestPath, "AGY manifest");
requireFile(skillPath, "AGY claude-router skill");
requireFile(runtimePath, "Claude Router runtime");
requireFile(mcpPath, "Claude Router MCP server");

const manifest = readJson(manifestPath);
const pkg = readJson(packagePath);

for (const key of ["name", "version"]) {
  requireString(manifest, key);
}

if (manifest.name !== "claude-router") {
  fail("AGY manifest name must be claude-router.");
}

if (manifest.version !== pkg.version) {
  fail(`AGY manifest version ${manifest.version} must match package version ${pkg.version}.`);
}

const skill = fs.readFileSync(skillPath, "utf8");
for (const required of ["name: claude-router", "claude-companion.mjs", "claude-router-mcp.mjs"]) {
  if (!skill.includes(required)) {
    fail(`AGY skill is missing required text: ${required}`);
  }
}

process.stdout.write(`AGY validation passed: ${root}\n`);
