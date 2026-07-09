import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, installFakeClaude, makeTempDir } from "./helpers.mjs";
import { validateSchema } from "./support/schema-validator.mjs";
import {
  CATALOG_VERSION,
  EFFORT_LEVELS,
  MODEL_TIERS,
  MODIFIERS,
  PERMISSION_MODES,
  PRESETS,
  getModelCatalog,
  parseClaudeHelpModels
} from "../scripts/lib/model-catalog.mjs";
import { renderModelCatalog } from "../scripts/lib/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "scripts", "claude-router-mcp.mjs");
const PLUGIN = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));
const MODELS_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "schemas", "models-output.schema.json"), "utf8")
);

// Valid tier ids from model-resolution.mjs
const VALID_TIER_IDS = new Set(["haiku", "sonnet", "opus"]);
// Valid effort ids from model-resolution.mjs
const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CLAUDE_HELP_WITH_FABLE = "Usage: claude [options]\nOptions:\n  --model <model>  Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5').\n  --name <name>  Set a display name\n";

// ── Unit tests for getModelCatalog() ──────────────────────────────────────────

test("getModelCatalog returns full catalog with all sections when called with no args", () => {
  const catalog = getModelCatalog();
  assert.ok(catalog.catalog_version);
  assert.ok(Array.isArray(catalog.tiers));
  assert.ok(Array.isArray(catalog.models));
  assert.ok(Array.isArray(catalog.effort_levels));
  assert.ok(Array.isArray(catalog.modifiers));
  assert.ok(Array.isArray(catalog.permission_modes));
  assert.ok(Array.isArray(catalog.presets));
  assert.equal(catalog.tiers.length, MODEL_TIERS.length);
  assert.equal(catalog.discovery.status, "not-run");
  assert.equal(catalog.effort_levels.length, EFFORT_LEVELS.length);
  assert.equal(catalog.modifiers.length, MODIFIERS.length);
  assert.equal(catalog.permission_modes.length, PERMISSION_MODES.length);
  assert.equal(catalog.presets.length, PRESETS.length);
});

test("parseClaudeHelpModels extracts model aliases and full names from Claude help", () => {
  const parsed = parseClaudeHelpModels(CLAUDE_HELP_WITH_FABLE);
  assert.deepEqual(parsed.aliases, ["fable", "opus", "sonnet"]);
  assert.deepEqual(parsed.full_names, ["claude-fable-5"]);
});

test("getModelCatalog merges live Claude model selectors with curated tiers", () => {
  const catalog = getModelCatalog({ claudeHelp: CLAUDE_HELP_WITH_FABLE, claudeVersion: "2.1.198 (Claude Code)" });
  assert.equal(catalog.discovery.status, "available");
  assert.deepEqual(catalog.discovery.aliases, ["fable", "opus", "sonnet"]);
  const fable = catalog.models.find((model) => model.selector === "fable");
  assert.ok(fable, "fable model selector missing");
  assert.equal(fable.full_name, "claude-fable-5");
  assert.equal(fable.source, "claude-help");
  const opus = catalog.models.find((model) => model.selector === "opus");
  assert.equal(opus.source, "curated+claude-help");
});

test("catalog_version is a valid semver string", () => {
  assert.match(CATALOG_VERSION, /^\d+\.\d+\.\d+$/);
  const catalog = getModelCatalog();
  assert.equal(catalog.catalog_version, CATALOG_VERSION);
});

test("all tier ids match valid tier ids from model-resolution", () => {
  for (const tier of MODEL_TIERS) {
    assert.ok(VALID_TIER_IDS.has(tier.id), `tier id "${tier.id}" not in VALID_TIER_IDS`);
  }
});

test("all effort level ids match VALID_EFFORTS from model-resolution", () => {
  for (const level of EFFORT_LEVELS) {
    assert.ok(VALID_EFFORTS.has(level.id), `effort id "${level.id}" not in VALID_EFFORTS`);
  }
});

test("capability filter ultrathink returns only opus", () => {
  const catalog = getModelCatalog({ capability: "ultrathink" });
  assert.equal(catalog.tiers.length, 1);
  assert.equal(catalog.tiers[0].id, "opus");
});

test("capability filter long_context returns sonnet and opus", () => {
  const catalog = getModelCatalog({ capability: "long_context" });
  const ids = catalog.tiers.map((t) => t.id);
  assert.deepEqual(ids, ["sonnet", "opus"]);
});

test("capability filter chrome returns all tiers", () => {
  const catalog = getModelCatalog({ capability: "chrome" });
  assert.equal(catalog.tiers.length, MODEL_TIERS.length);
});

test("unknown capability value throws an error", () => {
  assert.throws(
    () => getModelCatalog({ capability: "nonexistent_capability" }),
    /Unknown capability "nonexistent_capability"/
  );
});

test("no arguments returns same result as empty object", () => {
  const noArgs = getModelCatalog();
  const emptyObj = getModelCatalog({});
  assert.deepEqual(noArgs, emptyObj);
});

test("modifiers reference only valid tier ids in compatible_tiers", () => {
  for (const mod of MODIFIERS) {
    for (const tierId of mod.compatible_tiers) {
      assert.ok(VALID_TIER_IDS.has(tierId), `modifier "${mod.id}" references unknown tier "${tierId}"`);
    }
  }
});

test("presets reference only valid tier ids in resolves_to.tier", () => {
  for (const preset of PRESETS) {
    assert.ok(
      VALID_TIER_IDS.has(preset.resolves_to.tier),
      `preset "${preset.id}" resolves to unknown tier "${preset.resolves_to.tier}"`
    );
  }
});

test("bypassPermissions mode requires allow-dangerous", () => {
  const bypass = PERMISSION_MODES.find((m) => m.id === "bypassPermissions");
  assert.ok(bypass, "bypassPermissions mode not found in PERMISSION_MODES");
  assert.equal(bypass.requires_allow_dangerous, true);
  const safe = PERMISSION_MODES.filter((m) => m.id !== "bypassPermissions");
  for (const mode of safe) {
    assert.equal(mode.requires_allow_dangerous, false, `${mode.id} should not require allow-dangerous`);
  }
});

// ── Schema validation tests ──────────────────────────────────────────────────

test("full catalog output validates against models-output schema", () => {
  const catalog = getModelCatalog();
  const errors = validateSchema(MODELS_SCHEMA, catalog);
  assert.deepEqual(errors, []);
});

test("filtered catalog output also validates against models-output schema", () => {
  for (const capability of ["ultrathink", "long_context", "chrome"]) {
    const catalog = getModelCatalog({ capability });
    const errors = validateSchema(MODELS_SCHEMA, catalog);
    assert.deepEqual(errors, [], `schema validation failed for capability "${capability}"`);
  }
});

// ── MCP tool tests ───────────────────────────────────────────────────────────

function request(proc, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += String(chunk);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          proc.stdout.off("data", onData);
          try {
            resolve(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
          return;
        }
        newline = buffer.indexOf("\n");
      }
    };
    proc.stdout.on("data", onData);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test("claude_router_models appears in tools/list response", async () => {
  const bin = makeTempDir();
  installFakeClaude(bin);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const modelsTool = list.result.tools.find((tool) => tool.name === "claude_router_models");
    assert.ok(modelsTool, "claude_router_models not found in tools/list");
    const versionTool = list.result.tools.find((tool) => tool.name === "claude_router_version");
    assert.ok(versionTool, "claude_router_version not found in tools/list");
  } finally {
    proc.kill("SIGTERM");
  }
});

test("claude_router_models tool schema includes capability enum parameter", async () => {
  const bin = makeTempDir();
  installFakeClaude(bin);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const modelsTool = list.result.tools.find((tool) => tool.name === "claude_router_models");
    assert.ok(modelsTool.inputSchema.properties.capability, "capability property missing from schema");
    assert.deepEqual(modelsTool.inputSchema.properties.capability.enum, [
      "long_context",
      "ultrathink",
      "chrome"
    ]);
    assert.ok(modelsTool.inputSchema.properties.cwd, "cwd property missing from schema");
    assert.ok(modelsTool.inputSchema.properties.static, "static property missing from schema");
  } finally {
    proc.kill("SIGTERM");
  }
});

// ── Render tests ─────────────────────────────────────────────────────────────

test("renderModelCatalog produces string containing expected section headers", () => {
  const catalog = getModelCatalog();
  const rendered = renderModelCatalog(catalog);
  assert.equal(typeof rendered, "string");
  assert.match(rendered, /# Claude Router Model Catalog/);
  assert.match(rendered, /## Model Tiers/);
  assert.match(rendered, /## Effort Levels/);
  assert.match(rendered, /## Modifiers/);
  assert.match(rendered, /## Permission Modes/);
  assert.match(rendered, /## Presets/);
});

test("renderModelCatalog handles a catalog with empty tiers array without crashing", () => {
  const catalog = getModelCatalog({ capability: "ultrathink" });
  // Reduce to empty tiers to test edge case
  const emptyCatalog = { ...catalog, tiers: [] };
  const rendered = renderModelCatalog(emptyCatalog);
  assert.equal(typeof rendered, "string");
  assert.match(rendered, /## Model Tiers/);
  assert.match(rendered, /## Effort Levels/);
});
