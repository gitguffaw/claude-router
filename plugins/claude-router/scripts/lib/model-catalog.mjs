export const CATALOG_VERSION = "1.1.1";

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
    description: "Router modifier that extends context by appending [1m] to the model identifier.",
    compatible_tiers: ["sonnet", "opus"],
    conflicts_with: [],
    notes: "Router-level convenience control, not a native Claude CLI flag. Haiku does not support long context. Defaults to opus[1m] when no tier is specified."
  },
  {
    id: "ultrathink",
    flag: "--ultrathink",
    type: "boolean",
    description: "Router modifier that adds an ultrathink reasoning request to the prompt.",
    compatible_tiers: ["opus"],
    conflicts_with: [],
    notes: "Router-level prompt control, not a native Claude CLI flag. Only supported on Opus."
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
    id: "acceptEdits",
    flag_value: "acceptEdits",
    description: "Automatically accept file edits while keeping other permission behavior constrained by Claude.",
    requires_allow_dangerous: false,
    notes: "Native Claude Code permission mode."
  },
  {
    id: "auto",
    flag_value: "auto",
    description: "Claude's automatic permission mode.",
    requires_allow_dangerous: false,
    notes: "Native Claude Code permission mode."
  },
  {
    id: "plan",
    flag_value: "plan",
    description: "Plan-only mode. Claude can read and reason but cannot write files or execute commands.",
    requires_allow_dangerous: false,
    notes: "Use for architecture review, exploration, and planning before committing to edits."
  },
  {
    id: "dontAsk",
    flag_value: "dontAsk",
    description: "Claude permission mode that avoids interactive asks according to Claude's own policy semantics.",
    requires_allow_dangerous: false,
    notes: "Native Claude Code permission mode; distinct from bypassPermissions."
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSelector(selector) {
  return String(selector ?? "").trim().toLowerCase();
}

function selectorId(selector) {
  return normalizeSelector(selector).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function displayNameForSelector(selector) {
  const normalized = normalizeSelector(selector);
  const curated = MODEL_TIERS.find((tier) => tier.id === normalized);
  if (curated) {
    return curated.display_name;
  }
  const withoutPrefix = normalized.startsWith("claude-") ? normalized.slice("claude-".length) : normalized;
  const words = withoutPrefix
    .replace(/\[[^\]]+\]/g, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);
  return `Claude ${words.join(" ") || selector}`;
}

function looksLikeModelSelector(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\[[A-Za-z0-9._:-]+\])?$/.test(value.replace(/-/g, "_"));
}

function extractOptionBlock(helpText, optionName) {
  const lines = String(helpText ?? "").split(/\r?\n/);
  const optionPattern = new RegExp(`(?:^|\\s|,)${optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|,|$)`);
  const start = lines.findIndex((line) => optionPattern.test(line));
  if (start === -1) {
    return "";
  }
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(Arguments|Options|Commands):\s*$/.test(line)) {
      break;
    }
    if (/^\s{0,4}(?:-[A-Za-z0-9],\s*)?--[A-Za-z0-9]/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join("\n").trim();
}

export function parseClaudeHelpModels(helpText) {
  const modelBlock = extractOptionBlock(helpText, "--model");
  const quotedValues = [];
  const quotedPattern = /(?:^|[\s(,])['"]([A-Za-z0-9][A-Za-z0-9._:-]*(?:-[A-Za-z0-9._:-]+)*(?:\[[A-Za-z0-9._:-]+\])?)['"]/g;
  let match;
  while ((match = quotedPattern.exec(modelBlock)) !== null) {
    quotedValues.push(match[1]);
  }
  const selectors = unique(quotedValues.map((value) => value.trim()).filter(looksLikeModelSelector));
  const fullNames = selectors.filter((selector) => normalizeSelector(selector).startsWith("claude-"));
  const aliases = selectors.filter((selector) => !normalizeSelector(selector).startsWith("claude-"));
  return {
    option_block: modelBlock,
    selectors,
    aliases,
    full_names: fullNames
  };
}

function inferFullNameForAlias(alias, fullNames) {
  const normalized = normalizeSelector(alias);
  return fullNames.find((name) => {
    const fullName = normalizeSelector(name);
    return fullName === `claude-${normalized}` ||
      fullName.startsWith(`claude-${normalized}-`) ||
      fullName.includes(`-${normalized}-`) ||
      fullName.endsWith(`-${normalized}`);
  }) ?? null;
}

function buildCuratedModelOptions() {
  return MODEL_TIERS.map((tier) => ({
    id: tier.id,
    selector: tier.id,
    display_name: tier.display_name,
    full_name: null,
    aliases: [tier.id],
    source: "curated",
    tier: tier.id,
    notes: tier.notes
  }));
}

function buildDiscoveredModelOptions(parsed) {
  const pairedFullNames = new Set();
  const options = [];
  for (const alias of parsed.aliases) {
    const fullName = inferFullNameForAlias(alias, parsed.full_names);
    if (fullName) {
      pairedFullNames.add(fullName);
    }
    options.push({
      id: selectorId(alias),
      selector: alias,
      display_name: displayNameForSelector(alias),
      full_name: fullName,
      aliases: [alias],
      source: "claude-help",
      tier: MODEL_TIERS.some((tier) => tier.id === normalizeSelector(alias)) ? normalizeSelector(alias) : null,
      notes: "Discovered from installed Claude CLI --model help."
    });
  }
  for (const fullName of parsed.full_names) {
    if (pairedFullNames.has(fullName)) {
      continue;
    }
    options.push({
      id: selectorId(fullName),
      selector: fullName,
      display_name: displayNameForSelector(fullName),
      full_name: fullName,
      aliases: [],
      source: "claude-help",
      tier: null,
      notes: "Discovered from installed Claude CLI --model help."
    });
  }
  return options;
}

function mergeModelOptions(curated, discovered) {
  const merged = new Map(curated.map((model) => [normalizeSelector(model.selector), { ...model }]));
  for (const model of discovered) {
    const key = normalizeSelector(model.selector);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...model });
      continue;
    }
    merged.set(key, {
      ...existing,
      full_name: existing.full_name ?? model.full_name,
      aliases: unique([...(existing.aliases ?? []), ...(model.aliases ?? [])]),
      source: existing.source === model.source ? existing.source : `${existing.source}+${model.source}`,
      notes: existing.notes
    });
  }
  return [...merged.values()];
}

function filterModelsByCapability(models, capability, tiers) {
  if (!capability) {
    return models;
  }
  if (capability === "chrome") {
    return models;
  }
  const allowedTiers = new Set(tiers.map((tier) => tier.id));
  return models.filter((model) => model.tier && allowedTiers.has(model.tier));
}

export function getModelCatalog(options = {}) {
  const parsedModels = parseClaudeHelpModels(options.claudeHelp ?? "");
  const discoveryStatus = options.discoveryStatus ??
    (options.claudeHelp ? (parsedModels.selectors.length ? "available" : "no-model-data") : "not-run");
  const catalog = {
    catalog_version: CATALOG_VERSION,
    discovery: {
      status: discoveryStatus,
      source: options.claudeHelp ? "claude --help" : "curated",
      claude_version: options.claudeVersion ?? null,
      selectors: parsedModels.selectors,
      aliases: parsedModels.aliases,
      full_names: parsedModels.full_names,
      error: options.discoveryError ?? null
    },
    models: mergeModelOptions(buildCuratedModelOptions(), buildDiscoveredModelOptions(parsedModels)),
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
    catalog.models = filterModelsByCapability(catalog.models, options.capability, catalog.tiers);
  }

  return catalog;
}
