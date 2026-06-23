import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createContextPack } from "../scripts/lib/context-pack.mjs";
import { makeTempDir } from "./helpers.mjs";

test("context pack records policy hash and request", () => {
  const workspace = makeTempDir();
  const pack = createContextPack(workspace, {
    mode: "analyze",
    workflow: "Analyze",
    userRequest: "inspect",
    prompt: "routed",
    controls: { model: "opus" }
  });
  assert.match(pack.id, /^ctx-/);
  assert.ok(pack.policyHash);
  const stored = JSON.parse(fs.readFileSync(pack.file, "utf8"));
  assert.equal(stored.mode, "analyze");
  assert.ok(stored.policyFiles.some((file) => file.path === "SKILL.md"));
});
