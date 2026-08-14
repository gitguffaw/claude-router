import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildEnv, installFakeClaude, makeTempDir } from "./helpers.mjs";
import { validateSchema } from "./support/schema-validator.mjs";
import { CATALOG_VERSION, getModelCatalog, parseClaudeHelpModels } from "../scripts/lib/model-catalog.mjs";
import { renderModelCatalog } from "../scripts/lib/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "scripts", "claude-router-mcp.mjs");
const MODELS_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "models-output.schema.json"), "utf8"));
const CLAUDE_HELP = `Usage: claude [options]
Options:
  --model <model>  Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5').
  --effort <level> Effort level (low, medium, high, xhigh, max, future)
  --permission-mode <mode> Permission mode (choices: "acceptEdits", "auto", "manual", "plan")
  --safe-mode Start with customizations disabled while keeping OAuth
  --bare Minimal API-key mode; OAuth is not read
  --future-flag <value> A field introduced after this router release
`;

test("catalog uses installed Claude help as availability authority", () => {
  const catalog = getModelCatalog({ claudeHelp: CLAUDE_HELP, claudeVersion: "9.9.9" });
  assert.equal(catalog.catalog_version, CATALOG_VERSION);
  assert.equal(catalog.discovery.status, "available");
  assert.equal(catalog.discovery.completeness, "documented-examples");
  assert.deepEqual(catalog.models.map((model) => model.selector), ["fable", "opus", "sonnet"]);
  assert.equal(catalog.models.some((model) => model.selector === "haiku"), false);
  assert.equal(catalog.models.find((model) => model.selector === "fable").full_name, "claude-fable-5");
  assert.deepEqual(catalog.effort_levels.map((level) => level.id), ["low", "medium", "high", "xhigh", "max", "future"]);
  assert.deepEqual(catalog.permission_modes.map((mode) => mode.id), ["acceptEdits", "auto", "manual", "plan"]);
  assert.ok(catalog.cli_fields.some((field) => field.flag === "--future-flag"));
  assert.equal(catalog.lean_profiles.find((profile) => profile.id === "oauth").available, true);
  assert.equal(catalog.lean_profiles.find((profile) => profile.id === "api").available, true);
});

test("catalog never invents availability when live discovery did not run", () => {
  const catalog = getModelCatalog();
  assert.equal(catalog.discovery.status, "not-run");
  assert.deepEqual(catalog.models, []);
  assert.deepEqual(catalog.tiers, []);
  assert.deepEqual(catalog.effort_levels, []);
  assert.deepEqual(catalog.permission_modes, []);
  assert.deepEqual(catalog.cli_fields, []);
});

test("parseClaudeHelpModels extracts documented aliases and full names", () => {
  const parsed = parseClaudeHelpModels(CLAUDE_HELP);
  assert.deepEqual(parsed.aliases, ["fable", "opus", "sonnet"]);
  assert.deepEqual(parsed.full_names, ["claude-fable-5"]);
});

test("model and effort values are not filtered through a router capability matrix", () => {
  assert.throws(
    () => getModelCatalog({ claudeHelp: CLAUDE_HELP, capability: "ultrathink" }),
    /capability filtering was removed/i
  );
});

test("catalog output validates against models-output schema", () => {
  for (const catalog of [getModelCatalog(), getModelCatalog({ claudeHelp: CLAUDE_HELP })]) {
    assert.deepEqual(validateSchema(MODELS_SCHEMA, catalog), []);
  }
});

function request(proc, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += String(chunk);
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      proc.stdout.off("data", onData);
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    };
    proc.stdout.on("data", onData);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test("claude_router_models always exposes the live-discovery contract", async () => {
  const bin = makeTempDir();
  installFakeClaude(bin);
  const proc = spawn("node", [SERVER], { cwd: ROOT, env: buildEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  try {
    await request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = await request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const modelsTool = list.result.tools.find((tool) => tool.name === "claude_router_models");
    assert.deepEqual(Object.keys(modelsTool.inputSchema.properties), ["cwd"]);
  } finally {
    proc.kill("SIGTERM");
  }
});

test("renderModelCatalog explains live fields and lean profiles", () => {
  const rendered = renderModelCatalog(getModelCatalog({ claudeHelp: CLAUDE_HELP }));
  assert.match(rendered, /## Model Selectors/);
  assert.match(rendered, /## Live Claude CLI Fields/);
  assert.match(rendered, /## Advertised Tier Annotations/);
  assert.match(rendered, /## Lean Profiles/);
  assert.match(rendered, /--lean=oauth/);
});
