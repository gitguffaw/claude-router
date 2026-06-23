import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudePrintArgs } from "../scripts/lib/claude.mjs";
import { buildRouterRequest } from "../scripts/lib/router.mjs";

test("analyze and plan are read-only", () => {
  const analyze = buildRouterRequest({ mode: "analyze", prompt: "inspect", options: {} });
  const plan = buildRouterRequest({ mode: "plan", prompt: "plan it", options: {} });
  assert.equal(analyze.write, false);
  assert.equal(analyze.permissionMode, "plan");
  assert.equal(plan.write, false);
  assert.equal(plan.permissionMode, "plan");
});

test("exec is write-capable", () => {
  const request = buildRouterRequest({ mode: "exec", prompt: "fix it", options: {} });
  assert.equal(request.write, true);
  assert.equal(request.permissionMode, "acceptEdits");
});

test("model and effort controls normalize", () => {
  const request = buildRouterRequest({ mode: "analyze", prompt: "x", options: { best: true, effort: "xhigh", "long-context": true } });
  assert.equal(request.controls.model, "opus[1m]");
  assert.equal(request.controls.effort, "xhigh");
});

test("managed print jobs pass through advanced claude controls", () => {
  const request = buildRouterRequest({
    mode: "analyze",
    prompt: "x",
    options: {
      "allowed-tools": ["Read", "Bash(git *)"],
      "mcp-config": ["mcp.json"],
      "json-schema": "{\"type\":\"object\"}",
      "fallback-model": "sonnet",
      "output-format": "stream-json",
      "include-partial-messages": true
    }
  });
  const args = buildClaudePrintArgs(request);
  assert.deepEqual(args.slice(0, 4), ["-p", "--output-format", "stream-json", "--permission-mode"]);
  assert.ok(args.includes("--allowedTools"));
  assert.ok(args.includes("Bash(git *)"));
  assert.ok(args.includes("--mcp-config"));
  assert.ok(args.includes("mcp.json"));
  assert.ok(args.includes("--json-schema"));
  assert.ok(args.includes("{\"type\":\"object\"}"));
  assert.ok(args.includes("--fallback-model"));
  assert.ok(args.includes("--include-partial-messages"));
});

test("unsupported web search and dangerous permissions fail clearly", () => {
  assert.throws(() => buildRouterRequest({ mode: "analyze", prompt: "x", options: { search: true } }), /native generic web-search/);
  assert.throws(() => buildRouterRequest({ mode: "exec", prompt: "x", options: { "dangerously-skip-permissions": true } }), /Dangerous permission/);
});
