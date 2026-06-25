import { resolveClaudeControls } from "./model-resolution.mjs";

const MODE_CONFIG = {
  analyze: { workflow: "Analyze", write: false, defaultPermissionMode: "plan", outputFormat: "json" },
  plan: { workflow: "Plan", write: false, defaultPermissionMode: "plan", outputFormat: "json" },
  exec: { workflow: "Exec", write: true, defaultPermissionMode: "acceptEdits", outputFormat: "json" },
  review: { workflow: "Review", write: false, defaultPermissionMode: "plan", outputFormat: "json" }
};

function requirePrompt(prompt) {
  if (!String(prompt ?? "").trim()) {
    throw new Error("Provide a prompt.");
  }
}

function rejectDangerous(options) {
  if ((options["dangerously-skip-permissions"] || options["bypass-permissions"]) && !options["allow-dangerous"]) {
    throw new Error("Dangerous permission bypass was requested. Re-run with --allow-dangerous only if the user explicitly accepts that risk.");
  }
}

function buildPrompt(mode, prompt, controls) {
  const text = String(prompt ?? "").trim();
  const parts = ["<task>", text, "</task>"];
  if (controls.ultrathink) {
    parts.push("", "<reasoning_request>", "Use an ultrathink pass for this turn.", "</reasoning_request>");
  }
  if (mode === "analyze") {
    parts.push("", "<contract>", "Return observed facts, inferences, tradeoffs, recommendation, and next action. Do not edit files.", "</contract>");
  } else if (mode === "plan") {
    parts.push("", "<contract>", "Return a concrete implementation plan with phases, risks, validation, and open questions. Do not edit files.", "</contract>");
  } else if (mode === "exec") {
    parts.push("", "<contract>", "Implement the requested change narrowly. Return summary, touched files, verification, and residual risks.", "</contract>");
  } else if (mode === "review") {
    parts.push("", "<contract>", "Review only. Return findings first, ordered by severity. Do not edit files or apply fixes.", "</contract>");
  }
  return parts.join("\n");
}

export function buildRouterRequest({ mode, prompt, options = {}, gitBefore = null }) {
  const config = MODE_CONFIG[mode];
  if (!config) {
    throw new Error(`Unsupported Claude Router mode "${mode}".`);
  }
  if (options.search || options.webSearch) {
    throw new Error("Claude Router does not expose a native generic web-search mode. Use --chrome for browser work or ask for MCP/docs verification.");
  }
  rejectDangerous(options);
  requirePrompt(prompt);
  const controls = resolveClaudeControls(options);
  const permissionMode = controls.permissionMode ?? config.defaultPermissionMode;
  const outputFormat = controls.outputFormat ?? config.outputFormat;
  const routedPrompt = buildPrompt(mode, prompt, controls);
  return {
    mode,
    workflow: config.workflow,
    write: config.write,
    outputFormat,
    permissionMode,
    prompt: routedPrompt,
    userRequest: prompt,
    controls: {
      ...controls,
      permissionMode,
      pluginDirs: options["plugin-dir"] ?? [],
      pluginUrls: options["plugin-url"] ?? [],
      mcpConfigs: options["mcp-config"] ?? [],
      settings: options.settings ?? null,
      settingSources: options["setting-sources"] ?? null,
      addDirs: options["add-dir"] ?? [],
      strictMcpConfig: Boolean(options["strict-mcp-config"])
    },
    gitBefore,
    nonGoals: config.write ? ["Avoid unrelated refactors."] : ["Do not edit files."],
    constraints: ["Preserve user changes.", "Do not synthesize a Codex substitute if Claude fails."]
  };
}
