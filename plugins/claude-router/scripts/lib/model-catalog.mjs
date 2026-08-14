import { discoverClaudeControls } from "./live-controls.mjs";

export const CATALOG_VERSION = "2.0.0";

// Exported as empty compatibility sections for older catalog consumers. Claude
// help does not publish a future-proof tier/capability matrix, so the router no
// longer invents one.
export const MODEL_TIERS = [];
export const EFFORT_LEVELS = [];
export const PERMISSION_MODES = [];
export const PRESETS = [];

export const MODIFIERS = [
  {
    id: "long_context",
    flag: "--long-context",
    type: "boolean",
    description: "Legacy router convenience that appends [1m] to a compatible model selector.",
    compatible_tiers: [],
    conflicts_with: [],
    notes: "Router compatibility control, not a native Claude CLI flag. Prefer an explicit live model selector."
  },
  {
    id: "ultrathink",
    flag: "--ultrathink",
    type: "boolean",
    description: "Legacy router convenience that adds a deep-reasoning request to the task prompt.",
    compatible_tiers: [],
    conflicts_with: [],
    notes: "Router prompt control, not a native Claude CLI capability claim."
  }
];

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
  const explicitChoices = discoverClaudeControls(helpText).find((control) => control.option === "model")?.choices ?? [];
  const unquotedFullNames = [...modelBlock.matchAll(/\bclaude-[a-z0-9][a-z0-9._:-]*(?:\[[a-z0-9._:-]+\])?/gi)]
    .map((item) => item[0]);
  const selectors = unique([...quotedValues, ...explicitChoices, ...unquotedFullNames]
    .map((value) => value.trim())
    .filter(looksLikeModelSelector));
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
      tier: null,
      notes: "Example selector discovered from the installed Claude CLI --model help. Claude help may not enumerate every accepted selector."
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
      notes: "Example full model name discovered from the installed Claude CLI --model help."
    });
  }
  return options;
}

function valuesFor(controls, option) {
  return controls.find((control) => control.option === option)?.choices ?? [];
}

function dynamicEffortLevels(controls) {
  return valuesFor(controls, "effort").map((value) => ({
    id: value,
    flag_value: value,
    description: "Accepted by the installed Claude CLI --effort field.",
    token_budget: null,
    recommended_for: null,
    source: "claude-help"
  }));
}

function dynamicPermissionModes(controls) {
  return valuesFor(controls, "permission-mode").map((value) => ({
    id: value,
    flag_value: value,
    description: "Accepted by the installed Claude CLI --permission-mode field.",
    requires_allow_dangerous: value === "bypassPermissions",
    notes: value === "bypassPermissions"
      ? "Claude Router requires --allow-dangerous for this value."
      : "Availability discovered from the installed Claude CLI.",
    source: "claude-help"
  }));
}

function dynamicModifiers(controls) {
  const sessionFlags = new Set(["bare", "chrome", "no-chrome", "safe-mode"]);
  return [
    ...MODIFIERS,
    ...controls.filter((control) => sessionFlags.has(control.option)).map((control) => ({
      id: control.option.replaceAll("-", "_"),
      flag: control.flag,
      type: control.kind === "boolean" ? "boolean" : "value",
      description: control.description,
      compatible_tiers: [],
      conflicts_with: control.option === "bare" ? ["safe_mode"] : control.option === "safe-mode" ? ["bare"] : [],
      notes: "Native Claude CLI field discovered from installed help."
    }))
  ];
}

function leanProfiles(controls) {
  const available = new Set(controls.map((control) => control.option));
  return [
    {
      id: "auto",
      router_value: "auto",
      isolation_flag: null,
      auth_path: "detected",
      available: available.has("safe-mode") || available.has("bare"),
      description: "Choose OAuth safe mode or API-key bare mode from the active Claude authentication path."
    },
    {
      id: "oauth",
      router_value: "oauth",
      isolation_flag: "--safe-mode",
      auth_path: "OAuth/subscription",
      available: available.has("safe-mode"),
      description: "Disable customizations while retaining normal OAuth, model, built-in tool, and permission behavior."
    },
    {
      id: "api",
      router_value: "api",
      isolation_flag: "--bare",
      auth_path: "API key or apiKeyHelper",
      available: available.has("bare"),
      description: "Use Claude bare mode, which does not read OAuth or keychain credentials and therefore requires API credentials."
    }
  ];
}

export function getModelCatalog(options = {}) {
  if (options.capability) {
    throw new Error("Model capability filtering was removed because installed Claude help does not publish a complete, future-proof model capability matrix. Inspect the live fields and pass an explicit model selector instead.");
  }
  const parsedModels = parseClaudeHelpModels(options.claudeHelp ?? "");
  const discoveryStatus = options.discoveryStatus ??
    (options.claudeHelp ? (parsedModels.selectors.length ? "available" : "no-model-data") : "not-run");
  const cliFields = discoverClaudeControls(options.claudeHelp ?? "");
  const models = buildDiscoveredModelOptions(parsedModels);
  const advertisedTiers = new Set(models.map((model) => model.tier).filter(Boolean));
  return {
    catalog_version: CATALOG_VERSION,
    discovery: {
      status: discoveryStatus,
      source: options.claudeHelp ? "claude --help" : "unavailable",
      claude_version: options.claudeVersion ?? null,
      selectors: parsedModels.selectors,
      aliases: parsedModels.aliases,
      full_names: parsedModels.full_names,
      error: options.discoveryError ?? null,
      completeness: "documented-examples",
      notes: "Claude --help documents examples rather than a guaranteed exhaustive model registry. Any explicit --model selector is passed through without router allowlisting."
    },
    models,
    cli_fields: cliFields,
    tiers: MODEL_TIERS.filter((tier) => advertisedTiers.has(tier.id)),
    effort_levels: dynamicEffortLevels(cliFields),
    modifiers: dynamicModifiers(cliFields),
    permission_modes: dynamicPermissionModes(cliFields),
    presets: [],
    lean_profiles: leanProfiles(cliFields)
  };
}
