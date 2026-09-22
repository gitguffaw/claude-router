import test from "node:test";
import assert from "node:assert/strict";
import { renderClaudePayload } from "../scripts/lib/claude.mjs";
import {
  blockingAuthNotice,
  parseClaudeStdout,
  projectCompanionStdout,
  startupAuthNotices,
  stripLaunchNoise
} from "../scripts/lib/host-view.mjs";

test("blockingAuthNotice names servers from Claude's live status lines", () => {
  assert.equal(
    blockingAuthNotice("claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication"),
    "claude.ai Notion needs authentication"
  );
  assert.equal(
    blockingAuthNotice("plugin:cloudflare:cloudflare-api: https://mcp.cloudflare.com/mcp (HTTP) - ! Needs authentication"),
    "plugin:cloudflare:cloudflare-api needs authentication"
  );
  assert.equal(blockingAuthNotice("claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected"), "");
});

test("startupAuthNotices names needs-auth servers inside a Claude init event", () => {
  const line = JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["Read"],
    mcp_servers: [
      { name: "plugin:cloudflare:cloudflare-api", status: "needs-auth" },
      { name: "plugin:cloudflare:cloudflare-docs", status: "connected" },
      { name: "homelab", status: "connected" },
      { name: "claude.ai Notion", status: "pending" }
    ]
  });
  assert.deepEqual(startupAuthNotices({ stdout: `[2026-09-22T15:52:37.066Z] ${line}` }), [
    "plugin:cloudflare:cloudflare-api needs authentication"
  ]);
});

test("stripLaunchNoise drops MCP disconnects and keeps blocking authentication", () => {
  const cleaned = stripLaunchNoise([
    "MCP servers:",
    "  cloudflare-api: failed",
    "  cursor: not connected",
    "  linear: needs authentication",
    "",
    "The parser fix is in router.mjs."
  ].join("\n"));
  assert.equal(cleaned, "linear needs authentication\nThe parser fix is in router.mjs.");
});

test("parseClaudeStdout keeps the result event and drops system init", () => {
  const stdout = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      mcp_servers: [{ name: "cursor", status: "not connected" }],
      permissionMode: "plan"
    }),
    JSON.stringify({
      type: "result",
      result: "The parser fix is in router.mjs.",
      session_id: "00000000-0000-4000-8000-000000000000",
      mcp_servers: [{ name: "cursor", status: "not connected" }]
    })
  ].join("\n");
  const extracted = parseClaudeStdout(stdout);
  assert.equal(extracted.parsed.result, "The parser fix is in router.mjs.");
  assert.doesNotMatch(extracted.rawOutput, /"type":"system"/);
});

test("renderClaudePayload keeps a blocking authentication error and drops disconnects", () => {
  const text = renderClaudePayload(
    { workflow: "Analyze" },
    "",
    { result: "The parser fix is in router.mjs." },
    [
      'MCP server "cloudflare-api" failed to connect: auth required',
      "cursor: not connected",
      "docs: failed to connect"
    ].join("\n"),
    [],
    {}
  );
  assert.match(text, /The parser fix is in router\.mjs\./);
  assert.match(text, /cloudflare-api needs authentication/);
  assert.doesNotMatch(text, /not connected|failed to connect|cursor|docs:/i);
});

test("renderClaudePayload does not repeat stderr startup noise when a result exists", () => {
  const text = renderClaudePayload(
    { workflow: "Analyze" },
    JSON.stringify({ result: "The parser fix is in router.mjs.", mcp_servers: [{ name: "cursor", status: "failed" }] }),
    { result: "The parser fix is in router.mjs.", mcp_servers: [{ name: "cursor", status: "failed" }] },
    'MCP server "cloudflare-api" failed to connect\ncursor: not connected\n',
    [],
    {}
  );
  assert.match(text, /The parser fix is in router\.mjs\./);
  assert.doesNotMatch(text, /not connected|failed to connect|mcp_servers|Job log:|Claude session:/i);
});

test("projectCompanionStdout returns ready plus the task result", () => {
  const text = projectCompanionStdout(JSON.stringify({
    id: "analyze-1",
    status: "completed",
    mode: "analyze",
    jobClass: "claude",
    request: { prompt: "<task>inspect</task>", args: ["--permission-mode", "plan"] },
    result: {
      args: ["-p", "--permission-mode", "plan", "--", "inspect"],
      stderr: "cursor: not connected\nMCP server \"linear\" needs authentication",
      rawOutput: "{\"type\":\"system\",\"mcp_servers\":[]}",
      parsedOutput: {
        result: "The parser fix is in router.mjs.",
        mcp_servers: [
          { name: "cursor", status: "not connected" },
          { name: "linear", status: "needs-auth" }
        ]
      }
    },
    rendered: "# Claude Analyze\n\nThe parser fix is in router.mjs.\n",
    logFile: "/tmp/analyze.log",
    claudeSessionPath: "/tmp/session.jsonl"
  }));
  const payload = JSON.parse(text);
  assert.deepEqual(payload, {
    ready: true,
    status: "completed",
    id: "analyze-1",
    mode: "analyze",
    output: "The parser fix is in router.mjs.\n\nlinear needs authentication"
  });
});
