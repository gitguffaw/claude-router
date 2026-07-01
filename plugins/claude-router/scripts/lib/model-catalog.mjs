export const CATALOG_VERSION = "1.0.0";

export const MODEL_TIERS = [
  {
    id: "haiku",
    flag: "--haiku",
    display_name: "Claude Haiku",
    context_window: "200k",
    long_context_window: null,
    supports_ultrathink: false,
    supports_long_context: false,
    cost_tier: "low",
    notes: "Fastest, cheapest. Best for simple tasks, quick lookups, high-volume batch work."
  },
  {
    id: "sonnet",
    flag: "--sonnet",
    display_name: "Claude Sonnet",
    context_window: "200k",
    long_context_window: "1M",
    supports_ultrathink: false,
    supports_long_context: true,
    cost_tier: "medium",
    notes: "Default tier. Good balance of speed and capability. Supports long-context via sonnet[1m]."
  },
  {
    id: "opus",
    flag: "--opus",
    display_name: "Claude Opus",
    context_window: "200k",
    long_context_window: "1M",
    supports_ultrathink: true,
    supports_long_context: true,
    cost_tier: "high",
    notes: "Most capable. Required for ultrathink. Supports long-context via opus[1m]."
  }
];

export const EFFORT_LEVELS = [
  { id: "low", flag_value: "low", description: "Minimal reasoning, fast responses", token_budget: "~1k thinking tokens", recommended_for: "Simple lookups, trivial questions" },
  { id: "medium", flag_value: "medium", description: "Standard reasoning depth", token_budget: "~4k thinking tokens", recommended_for: "Typical development tasks" },
  { id: "high", flag_value: "high", description: "Deep reasoning with thorough analysis", token_budget: "~16k thinking tokens", recommended_for: "Complex code review, architectural decisions" },
  { id: "xhigh", flag_value: "xhigh", description: "Extended reasoning for difficult problems", token_budget: "~32k thinking tokens", recommended_for: "Hard debugging, multi-file refactors" },
  { id: "max", flag_value: "max", description: "Maximum reasoning budget", token_budget: "~64k+ thinking tokens", recommended_for: "Research-grade analysis, novel algorithm design" }
];

export const MODIFIERS = [
  {
    id: "long_context",
    flag: "--long-context",
    type: "boolean",
    description: "Extend context window to 1M tokens. Appends [1m] to the model identifier.",
    compatible_tiers: ["sonnet", "opus"],
    conflicts_with: [],
    notes: "Haiku does not support long context. Defaults to opus[1m] when no tier is specified."
  },
  {
    id: "ultrathink",
    flag: "--ultrathink",
    type: "boolean",
    description: "Enable extended thinking pass for deep, multi-step reasoning.",
    compatible_tiers: ["opus"],
    conflicts_with: [],
    notes: "Only supported on Opus."
  },
  {
    id: "chrome",
    flag: "--chrome",
    type: "boolean",
    description: "Enable browser/chrome integration for web-aware tasks.",
    compatible_tiers: [],
    conflicts_with: ["no_chrome"],
    notes: "Provides Claude with browser access for web-based research and interaction."
  },
  {
    id: "no_chrome",
    flag: "--no-chrome",
    type: "boolean",
    description: "Explicitly disable browser/chrome integration.",
    compatible_tiers: [],
    conflicts_with: ["chrome"],
    notes: "Useful to override project-level chrome defaults."
  },
  {
    id: "bare",
    flag: "--bare",
    type: "boolean",
    description: "Strip all system prompts and run with minimal context.",
    compatible_tiers: [],
    conflicts_with: [],
    notes: "Removes CLAUDE.md, dynamic system prompt sections, and other injected context."
  }
];

export const PERMISSION_MODES = [
  {
    id: "default",
    flag_value: "default",
    description: "Normal interactive permissions. Claude asks before file writes, shell commands, and other side effects.",
    requires_allow_dangerous: false,
    notes: "Standard mode. The user approves each action through the Claude CLI permission prompt."
  },
  {
    id: "plan",
    flag_value: "plan",
    description: "Plan-only mode. Claude can read and reason but cannot write files or execute commands.",
    requires_allow_dangerous: false,
    notes: "Use for architecture review, exploration, and planning before committing to edits."
  },
  {
    id: "bypassPermissions",
    flag_value: "bypassPermissions",
    description: "Skip all permission checks. Claude can read, write, and execute without approval.",
    requires_allow_dangerous: true,
    notes: "Dangerous. Use only in trusted sandboxes or when the user explicitly accepts the risk. Requires --allow-dangerous on raw commands."
  }
];

export const PRESETS = [
  {
    id: "best",
    flag: "--best",
    resolves_to: { tier: "opus", effort: null, modifiers: [] },
    description: "Shortcut for --opus. Selects the most capable model."
  }
];

const VALID_CAPABILITIES = new Set(["long_context", "ultrathink", "chrome"]);

export function getModelCatalog(options = {}) {
  const catalog = {
    catalog_version: CATALOG_VERSION,
    tiers: [...MODEL_TIERS],
    effort_levels: [...EFFORT_LEVELS],
    modifiers: [...MODIFIERS],
    permission_modes: [...PERMISSION_MODES],
    presets: [...PRESETS]
  };

  if (options.capability) {
    if (!VALID_CAPABILITIES.has(options.capability)) {
      throw new Error(`Unknown capability "${options.capability}". Valid: ${[...VALID_CAPABILITIES].join(", ")}`);
    }
    catalog.tiers = catalog.tiers.filter((tier) => {
      switch (options.capability) {
        case "long_context": return tier.supports_long_context;
        case "ultrathink": return tier.supports_ultrathink;
        case "chrome": return true;
        default: return true;
      }
    });
  }

  return catalog;
}
