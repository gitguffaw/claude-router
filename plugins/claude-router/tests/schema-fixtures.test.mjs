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

test("V2 schema exposes all planned record definitions", () => {
  assert.deepEqual(schema["x-recordDefinitions"], [...fixtures.keys()]);

  for (const definitionName of schema["x-recordDefinitions"]) {
    assert.ok(schema.$defs[definitionName], `missing $defs.${definitionName}`);
  }
});

test("V2 fixture manifest accounts for every fixture file", () => {
  const expected = new Set(["manifest.json", ...fixtures.values()]);
  const actual = new Set(fs.readdirSync(fixtureDir).filter((entry) => entry.endsWith(".json")));

  assert.deepEqual(actual, expected);
});

for (const [definitionName, fixtureName] of fixtures) {
  test(`${fixtureName} validates against ${definitionName}`, () => {
    const fixture = readJson(path.join(fixtureDir, fixtureName));
    const errors = validateSchema(schema, fixture, definitionName);
    assert.deepEqual(errors, []);
  });
}

test("root V2 schema accepts a known record and rejects unrelated JSON", () => {
  const fixture = readJson(path.join(fixtureDir, fixtures.get("RouteIntent")));

  assert.deepEqual(validateSchema(schema, fixture), []);
  assert.notDeepEqual(validateSchema(schema, { arbitrary: true }), []);
});

test("V2 schema rejects missing required fields", () => {
  const fixture = readJson(path.join(fixtureDir, fixtures.get("RouteIntent")));
  delete fixture.id;

  assert.match(validateSchema(schema, fixture, "RouteIntent").join("\n"), /RouteIntent.id is required/);
});

test("V2 schema rejects additional properties on strict records", () => {
  const fixture = readJson(path.join(fixtureDir, fixtures.get("PolicyDecision")));
  fixture.extra = true;

  assert.match(
    validateSchema(schema, fixture, "PolicyDecision").join("\n"),
    /PolicyDecision.extra is not allowed/
  );
});

test("V2 schema rejects invalid risk classes everywhere they are typed", () => {
  const fixture = readJson(path.join(fixtureDir, fixtures.get("ApprovalRecord")));
  fixture.classification = ["config_mutation", "typoed_risk"];

  assert.match(
    validateSchema(schema, fixture, "ApprovalRecord").join("\n"),
    /ApprovalRecord.classification\[1\] must be one of/
  );
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
