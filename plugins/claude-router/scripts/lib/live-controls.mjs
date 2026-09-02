import { parseClaudeHelp } from "./claude-surface.mjs";
import { NATIVE_SEED_CONTROLS, ROUTER_OWNED_OPTIONS } from "./routed-controls.mjs";

const ROUTER_RESERVED_OPTIONS = new Set([
  "background",
  "best",
  "cwd",
  "haiku",
  "json",
  "lean",
  "long-context",
  "opus",
  "search",
  "sonnet",
  "timeout",
  "timeout-ms",
  "ultrathink",
  "web-search"
]);

const ROUTER_MANAGED_NATIVE_OPTIONS = new Set([
  "help",
  "output-format",
  "permission-mode",
  "print",
  "version"
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function longName(names) {
  const longNames = names.filter((name) => name.startsWith("--"));
  const canonical = longNames.filter((name) => /^--[a-z0-9-]+$/.test(name));
  return canonical.sort((left, right) => right.length - left.length)[0] ?? longNames.at(-1) ?? null;
}

function optionName(flag) {
  return flag.replace(/^--/, "");
}

function inputKey(option) {
  return option.replaceAll("-", "_");
}

function parseChoiceList(text) {
  const quoted = [...String(text).matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  if (quoted.length) {
    return unique(quoted);
  }
  return unique(String(text).split(/\s*,\s*/).map((value) => value.trim()).filter((value) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)));
}

function choicesForFlag(flag) {
  const description = String(flag.description ?? "");
  const explicit = description.match(/\bchoices:\s*([^)]+)/i);
  if (explicit) {
    return parseChoiceList(explicit[1]);
  }
  if (!["level", "mode", "format"].includes(String(flag.valueHint ?? "").replace(/\.\.\.$/, ""))) {
    return [];
  }
  for (const match of description.matchAll(/\(([^()]*)\)/g)) {
    if (!/\be\.g\./i.test(match[1]) && match[1].includes(",")) {
      const values = parseChoiceList(match[1]);
      if (values.length > 1) {
        return values;
      }
    }
  }
  return [];
}

function sensitiveFlag(names) {
  return names.some((name) => /token|key|secret|password|header/i.test(name));
}

function dangerousFlag(names) {
  return names.some((name) => /danger|bypass|skip-permission|always-approve/i.test(name));
}

export function discoverClaudeControls(helpText) {
  return parseClaudeHelp(helpText).flags.flatMap((parsed) => {
    const flag = longName(parsed.names);
    if (!flag) {
      return [];
    }
    const option = optionName(flag);
    const aliases = parsed.names
      .filter((name) => name.startsWith("--") && name !== flag)
      .map(optionName);
    return [{
      flag,
      option,
      optionAliases: aliases,
      inputKeys: unique([inputKey(option), option, ...aliases.map(inputKey), ...aliases]),
      kind: parsed.requiresValue ? "value" : parsed.optionalValue ? "optional-value" : "boolean",
      repeatable: Boolean(parsed.repeatable),
      valueHint: parsed.valueHint,
      choices: choicesForFlag(parsed),
      description: parsed.description,
      sensitive: sensitiveFlag(parsed.names),
      dangerous: dangerousFlag(parsed.names),
      source: "claude-help"
    }];
  });
}

export function dynamicRoutedControls(helpText, options = {}) {
  const includeManaged = Boolean(options.includeManaged);
  return discoverClaudeControls(helpText).filter((control) => {
    if (ROUTER_RESERVED_OPTIONS.has(control.option) || ROUTER_OWNED_OPTIONS.has(control.option)) {
      return false;
    }
    return includeManaged || !ROUTER_MANAGED_NATIVE_OPTIONS.has(control.option);
  });
}

export function mergeNativeCatalog(helpText, options = {}) {
  const live = dynamicRoutedControls(helpText, options);
  const byOption = new Map(NATIVE_SEED_CONTROLS.map((control) => [control.option, control]));
  for (const control of live) {
    const seed = byOption.get(control.option);
    if (!seed) {
      byOption.set(control.option, control);
      continue;
    }
    byOption.set(control.option, {
      ...control,
      optionAliases: unique([...seed.optionAliases, ...control.optionAliases]),
      inputKeys: unique([...seed.inputKeys, ...control.inputKeys])
    });
  }
  return [...byOption.values()];
}

export function schemaForLiveControl(control) {
  let scalar;
  if (control.kind === "boolean") {
    scalar = { type: "boolean" };
  } else {
    scalar = { type: "string" };
  }
  const schema = control.repeatable
    ? { oneOf: [scalar, { type: "array", items: scalar }] }
    : control.kind === "optional-value"
      ? { oneOf: [{ type: "boolean" }, scalar] }
      : scalar;
  const choiceNote = control.choices.length ? ` Current installed-CLI choices: ${control.choices.join(", ")}.` : "";
  if (control.description || choiceNote) {
    schema.description = `${control.description}${choiceNote}`.trim();
  }
  return schema;
}

export function appendLiveControlArgs(args, input, controls) {
  for (const control of controls) {
    const key = control.inputKeys.find((candidate) => Object.prototype.hasOwnProperty.call(input, candidate));
    if (!key) {
      continue;
    }
    const value = input[key];
    if (control.kind === "boolean") {
      if (value === true) {
        args.push(control.flag);
      }
      continue;
    }
    if (control.kind === "optional-value" && value === true) {
      args.push(control.flag);
      continue;
    }
    if (value === undefined || value === null || value === false) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      args.push(control.flag, String(item));
    }
  }
}

export function liveControlParseConfig(controls) {
  const valueOptions = [];
  const optionalValueOptions = [];
  const booleanOptions = [];
  const repeatableOptions = [];
  const aliasMap = {};
  for (const control of controls) {
    if (control.kind === "value") {
      valueOptions.push(control.option);
    } else if (control.kind === "optional-value") {
      optionalValueOptions.push(control.option);
    } else {
      booleanOptions.push(control.option);
    }
    if (control.repeatable) {
      repeatableOptions.push(control.option);
    }
    for (const alias of control.optionAliases) {
      aliasMap[alias] = control.option;
    }
  }
  return { valueOptions, optionalValueOptions, booleanOptions, repeatableOptions, aliasMap };
}

export function nativeArgsFromParsedOptions(options, controls) {
  const args = [];
  for (const control of controls) {
    appendLiveControlArgs(args, options, [control]);
  }
  return args;
}

export function assertLiveControlSafety(options, controls) {
  const requestedDangerous = controls.some((control) => {
    if (!control.dangerous) {
      return false;
    }
    return control.inputKeys.some((key) => options[key] === true || options[key] === "bypassPermissions");
  });
  if (requestedDangerous && !options["allow-dangerous"]) {
    throw new Error("Dangerous permission bypass was requested. Re-run with --allow-dangerous only if the user explicitly accepts that risk.");
  }
}
