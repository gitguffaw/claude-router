export const ROUTER_COMMANDS = [
  { name: "setup", summary: "Check Node, Claude CLI, auth, plugin, and MCP availability." },
  { name: "surface", summary: "Show installed Claude CLI version/help plus Claude Router coverage." },
  { name: "help", summary: "Show Claude Router help, or Claude CLI help when a command path is provided." },
  { name: "version", summary: "Show Claude Router and installed Claude CLI versions." },
  { name: "models", summary: "Show model selectors discovered from installed Claude CLI help plus curated controls." },
  { name: "raw", summary: "Run raw Claude CLI args with mutation and dangerous-permission guardrails." },
  { name: "cli", summary: "Alias for raw Claude CLI args with the same guardrails." },
  { name: "analyze", summary: "Run read-only Claude analysis in print mode.", routed: true },
  { name: "plan", summary: "Run read-only Claude planning in print mode.", routed: true },
  { name: "exec", summary: "Run write-capable Claude execution in print mode.", routed: true },
  { name: "review", summary: "Run read-only Claude review in print mode.", routed: true },
  { name: "adversarial-review", summary: "Run read-only Claude challenge review in print mode.", routed: true },
  { name: "ultrareview", summary: "Run Claude's cloud-hosted ultrareview command." },
  { name: "status", summary: "List or inspect Claude Router jobs." },
  { name: "result", summary: "Show a stored Claude Router job result." },
  { name: "cancel", summary: "Cancel an active Claude Router job." }
];

export const MCP_UNEXPOSED_COMMANDS = new Set(["cli"]);
export const ROUTED_COMMAND_NAMES = new Set(ROUTER_COMMANDS.filter((command) => command.routed).map((command) => command.name));

export const MCP_TOOLS = [
  { name: "claude_router_setup", description: "Check local Claude CLI setup.", command: "setup" },
  { name: "claude_router_surface", description: "Report the local Claude CLI version, top-level help, and Claude Router coverage.", command: "surface" },
  { name: "claude_router_help", description: "Show Claude Router help, or local Claude CLI help when args are provided.", command: "help" },
  { name: "claude_router_version", description: "Show Claude Router and installed Claude CLI versions.", command: "version" },
  { name: "claude_router_raw", description: "Run a raw Claude CLI command with guardrails for mutating and dangerous operations.", command: "raw" },
  { name: "claude_router_analyze", description: "Run read-only Claude analysis.", command: "analyze", prompt: true },
  { name: "claude_router_plan", description: "Run read-only Claude planning.", command: "plan", prompt: true },
  { name: "claude_router_exec", description: "Run write-capable Claude execution.", command: "exec", prompt: true },
  { name: "claude_router_review", description: "Run read-only Claude review.", command: "review", prompt: true },
  { name: "claude_router_adversarial_review", description: "Run read-only Claude challenge review.", command: "adversarial-review", prompt: true },
  { name: "claude_router_ultrareview", description: "Run Claude ultrareview.", command: "ultrareview" },
  { name: "claude_router_status", description: "Show Claude Router jobs.", command: "status" },
  { name: "claude_router_result", description: "Show Claude Router job result.", command: "result" },
  { name: "claude_router_cancel", description: "Cancel a Claude Router job.", command: "cancel" },
  { name: "claude_router_models", description: "Return live Claude model selectors plus curated effort levels, permission modes, and modifier flags.", command: "models" }
];
