#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, ".codex-plugin", "plugin.json");

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

function requireString(object, key) {
  if (typeof object[key] !== "string" || !object[key].trim()) {
    fail(`Missing required string: ${key}`);
  }
}

if (!fs.existsSync(manifestPath)) {
  fail("Missing .codex-plugin/plugin.json");
}

const manifest = readJson(manifestPath);
for (const key of ["name", "version", "description"]) {
  requireString(manifest, key);
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.name)) {
  fail("Plugin name must be lower-case kebab-case and <= 64 characters.");
}
if (!manifest.author || typeof manifest.author.name !== "string" || !manifest.author.name.trim()) {
  fail("Missing author.name");
}
if (!manifest.interface || typeof manifest.interface !== "object") {
  fail("Missing interface object");
}
for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
  requireString(manifest.interface, key);
}

for (const key of ["skills", "mcpServers"]) {
  if (manifest[key] && typeof manifest[key] === "string") {
    const target = path.join(root, manifest[key]);
    if (!fs.existsSync(target)) {
      fail(`Manifest path does not exist: ${manifest[key]}`);
    }
  }
}

const skillsDir = path.join(root, "skills");
if (fs.existsSync(skillsDir)) {
  const skillFiles = [];
  for (const entry of fs.readdirSync(skillsDir)) {
    const file = path.join(skillsDir, entry, "SKILL.md");
    if (fs.existsSync(file)) {
      skillFiles.push(file);
    }
  }
  if (skillFiles.length === 0) {
    fail("skills/ exists but contains no SKILL.md files.");
  }
}

process.stdout.write(`Plugin validation passed: ${root}\n`);
