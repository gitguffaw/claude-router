import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSchema } from "./support/schema-validator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "schemas", "claude-router-v2.schema.json");
const fixtureDir = path.join(root, "tests", "fixtures", "v2-data");

const schema = readJson(schemaPath);
const manifest = readJson(path.join(fixtureDir, "manifest.json"));
const fixtures = new Map(manifest.records.map((record) => [record.definition, record.fixture]));

test("V2 fixtures validate against the public schema", () => {
  assert.deepEqual(schema["x-recordDefinitions"], [...fixtures.keys()]);
  for (const definitionName of schema["x-recordDefinitions"]) {
    assert.ok(schema.$defs[definitionName], `missing $defs.${definitionName}`);
  }

  const expected = new Set(["manifest.json", ...fixtures.values()]);
  const actual = new Set(fs.readdirSync(fixtureDir).filter((entry) => entry.endsWith(".json")));
  assert.deepEqual(actual, expected);

  for (const [definitionName, fixtureName] of fixtures) {
    const fixture = readJson(path.join(fixtureDir, fixtureName));
    assert.deepEqual(validateSchema(schema, fixture, definitionName), [], fixtureName);
  }

  const routeIntent = readJson(path.join(fixtureDir, fixtures.get("RouteIntent")));
  assert.deepEqual(validateSchema(schema, routeIntent), []);
  assert.notDeepEqual(validateSchema(schema, { arbitrary: true }), []);

  delete routeIntent.id;
  assert.match(validateSchema(schema, routeIntent, "RouteIntent").join("\n"), /RouteIntent.id is required/);

  const policyDecision = readJson(path.join(fixtureDir, fixtures.get("PolicyDecision")));
  policyDecision.extra = true;
  assert.match(
    validateSchema(schema, policyDecision, "PolicyDecision").join("\n"),
    /PolicyDecision.extra is not allowed/
  );

  const approvalRecord = readJson(path.join(fixtureDir, fixtures.get("ApprovalRecord")));
  approvalRecord.classification = ["config_mutation", "typoed_risk"];
  assert.match(
    validateSchema(schema, approvalRecord, "ApprovalRecord").join("\n"),
    /ApprovalRecord.classification\[1\] must be one of/
  );
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
