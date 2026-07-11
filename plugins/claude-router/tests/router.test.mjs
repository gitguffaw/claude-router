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

test("adversarial-review is read-only and challenges approach", () => {
  const request = buildRouterRequest({ mode: "adversarial-review", prompt: "review this", options: {} });
  assert.equal(request.write, false);
  assert.equal(request.permissionMode, "plan");
  assert.match(request.prompt, /Challenge the implementation approach/);
  assert.match(request.prompt, /Do not edit files or apply fixes/);
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

test("optional Claude flags can be emitted bare or with a value", () => {
  const bare = buildClaudePrintArgs(buildRouterRequest({ mode: "analyze", prompt: "inspect", options: { debug: true } }));
  const valued = buildClaudePrintArgs(buildRouterRequest({ mode: "analyze", prompt: "inspect", options: { resume: "session-1" } }));

  assert.ok(bare.includes("--debug"));
  assert.equal(bare.includes("true"), false);
  assert.equal(valued[valued.indexOf("--resume") + 1], "session-1");
});

test("unsupported web search and dangerous permissions fail clearly", () => {
  assert.throws(() => buildRouterRequest({ mode: "analyze", prompt: "x", options: { search: true } }), /native generic web-search/);
  assert.throws(() => buildRouterRequest({ mode: "analyze", prompt: "x", options: { "web-search": true } }), /native generic web-search/);
  assert.throws(() => buildRouterRequest({ mode: "exec", prompt: "x", options: { "dangerously-skip-permissions": true } }), /Dangerous permission/);
  assert.throws(() => buildRouterRequest({ mode: "exec", prompt: "x", options: { "permission-mode": "bypassPermissions" } }), /Dangerous permission/);
  assert.throws(() => buildRouterRequest({ mode: "exec", prompt: "x", options: { "allow-dangerously-skip-permissions": true } }), /Dangerous permission/);
  assert.throws(() => buildRouterRequest({ mode: "analyze", prompt: "x", options: { timeout: "30" } }), /use --timeout-ms/);
});

test("read-only modes reject write-capable permission modes even with allow-dangerous", () => {
  for (const mode of ["analyze", "plan", "review", "adversarial-review"]) {
    assert.throws(
      () => buildRouterRequest({ mode, prompt: "x", options: { "permission-mode": "acceptEdits" } }),
      /read-only and requires --permission-mode plan/
    );
    assert.throws(
      () => buildRouterRequest({ mode, prompt: "x", options: { "permission-mode": "bypassPermissions" } }),
      /Dangerous permission|read-only and requires --permission-mode plan/
    );
    assert.throws(
      () => buildRouterRequest({
        mode,
        prompt: "x",
        options: { "permission-mode": "bypassPermissions", "allow-dangerous": true }
      }),
      /read-only and requires --permission-mode plan/
    );
    assert.throws(
      () => buildRouterRequest({
        mode,
        prompt: "x",
        options: { "bypass-permissions": true, "allow-dangerous": true }
      }),
      /read-only and requires --permission-mode plan/
    );
    const ok = buildRouterRequest({ mode, prompt: "x", options: { "permission-mode": "plan" } });
    assert.equal(ok.permissionMode, "plan");
    assert.equal(ok.write, false);
  }
});

test("exec retains write-capable permission modes with dangerous override", () => {
  const accept = buildRouterRequest({ mode: "exec", prompt: "x", options: { "permission-mode": "acceptEdits" } });
  assert.equal(accept.permissionMode, "acceptEdits");
  const bypass = buildRouterRequest({
    mode: "exec",
    prompt: "x",
    options: { "permission-mode": "bypassPermissions", "allow-dangerous": true }
  });
  assert.equal(bypass.permissionMode, "bypassPermissions");
  const defaultExec = buildRouterRequest({ mode: "exec", prompt: "x", options: {} });
  assert.equal(defaultExec.permissionMode, "acceptEdits");
});

test("explicit empty tools string is preserved as --tools and empty argv entries", () => {
  for (const tools of ["", [""]]) {
    const request = buildRouterRequest({ mode: "analyze", prompt: "x", options: { tools } });
    const args = buildClaudePrintArgs(request);
    const index = args.indexOf("--tools");
    assert.notEqual(index, -1, "expected --tools flag");
    assert.equal(args[index + 1], "");
  }
  const multi = buildClaudePrintArgs(buildRouterRequest({
    mode: "exec",
    prompt: "x",
    options: { tools: ["Read", ""] }
  }));
  const toolsIndexes = multi.map((arg, index) => (arg === "--tools" ? index : -1)).filter((index) => index >= 0);
  assert.equal(toolsIndexes.length, 2);
  assert.equal(multi[toolsIndexes[0] + 1], "Read");
  assert.equal(multi[toolsIndexes[1] + 1], "");
});

test("review target flags fail instead of pretending to scope the review", () => {
  for (const mode of ["analyze", "plan", "exec", "review", "adversarial-review"]) {
    assert.throws(() => buildRouterRequest({ mode, prompt: "x", options: { base: "main" } }), /does not yet support --base or --scope/);
    assert.throws(() => buildRouterRequest({ mode, prompt: "x", options: { scope: "src" } }), /does not yet support --base or --scope/);
  }
});
