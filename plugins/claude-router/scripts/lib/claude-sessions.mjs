import fs from "node:fs";
import path from "node:path";

const SESSION_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_IN_TEXT_RE = /"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;
const SESSION_ID_CAMEL_IN_TEXT_RE = /"sessionId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;
const MTIME_SLACK_MS = 5000;

export function isClaudeSessionId(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function encodeClaudeProjectSlug(cwd) {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectSlugsForCwd(cwd) {
  const resolved = path.resolve(cwd);
  const slugs = new Set([encodeClaudeProjectSlug(resolved)]);
  try {
    slugs.add(encodeClaudeProjectSlug(fs.realpathSync.native(resolved)));
  } catch {
    try {
      slugs.add(encodeClaudeProjectSlug(fs.realpathSync(resolved)));
    } catch {
      // Keep the unresolved slug only.
    }
  }
  return [...slugs];
}

export function resolveClaudeConfigDir(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) {
    return env.CLAUDE_CONFIG_DIR;
  }
  const home = env.HOME || env.USERPROFILE;
  if (!home) {
    return null;
  }
  return path.join(home, ".claude");
}

export function resolveClaudeProjectDir(cwd, env = process.env) {
  const configDir = resolveClaudeConfigDir(env);
  if (!configDir) {
    return null;
  }
  const slugs = claudeProjectSlugsForCwd(cwd);
  for (const slug of slugs) {
    const dir = path.join(configDir, "projects", slug);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return path.join(configDir, "projects", slugs[0]);
}

export function resolveClaudeSessionPath(cwd, sessionId, env = process.env) {
  if (!isClaudeSessionId(sessionId)) {
    return null;
  }
  const projectDir = resolveClaudeProjectDir(cwd, env);
  if (!projectDir) {
    return null;
  }
  return path.join(projectDir, `${sessionId}.jsonl`);
}

function readSessionFileMeta(file, fallbackId) {
  const meta = {
    sessionId: fallbackId,
    isSidechain: false,
    parentSessionId: null
  };
  let text = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(8192);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      text = buffer.toString("utf8", 0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return meta;
  }
  const firstLine = text.split(/\r?\n/, 1)[0];
  try {
    const parsed = JSON.parse(firstLine);
    if (isClaudeSessionId(parsed?.sessionId ?? parsed?.session_id)) {
      meta.sessionId = parsed.sessionId ?? parsed.session_id;
    }
    meta.isSidechain = Boolean(
      parsed?.isSidechain ||
      parsed?.is_sidechain ||
      parsed?.agentId ||
      parsed?.agent_id ||
      parsed?.parentSessionId ||
      parsed?.parent_session_id
    );
    meta.parentSessionId = parsed?.parentSessionId ?? parsed?.parent_session_id ?? null;
  } catch {
    // First line is not JSON; filename remains the id.
  }
  return meta;
}

export function listClaudeSessionRecords(cwd, env = process.env) {
  const configDir = resolveClaudeConfigDir(env);
  if (!configDir) {
    return [];
  }
  const records = [];
  const seen = new Set();
  for (const slug of claudeProjectSlugsForCwd(cwd)) {
    const projectDir = path.join(configDir, "projects", slug);
    let names;
    try {
      names = fs.readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith("agent-") || !SESSION_FILE_RE.test(name)) {
        continue;
      }
      const sessionId = name.slice(0, -".jsonl".length);
      const file = path.join(projectDir, name);
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      records.push({
        ...readSessionFileMeta(file, sessionId),
        path: file,
        mtimeMs: stat.mtimeMs
      });
    }
  }
  return records;
}

export function snapshotClaudeSessionIds(cwd, env = process.env) {
  return new Set(listClaudeSessionRecords(cwd, env).map((record) => record.sessionId));
}

export function discoverClaudeSession(cwd, options = {}) {
  const env = options.env ?? process.env;
  const excludeIds = new Set(options.excludeIds ?? []);
  const startedAtMs = Number(options.startedAtMs) || 0;
  const records = listClaudeSessionRecords(cwd, env).filter((record) => {
    if (excludeIds.has(record.sessionId)) {
      return false;
    }
    if (startedAtMs && record.mtimeMs < startedAtMs - MTIME_SLACK_MS) {
      return false;
    }
    return true;
  });
  if (!records.length) {
    return null;
  }
  records.sort((a, b) => {
    if (a.isSidechain !== b.isSidechain) {
      return a.isSidechain ? 1 : -1;
    }
    if (a.mtimeMs !== b.mtimeMs) {
      return a.mtimeMs - b.mtimeMs;
    }
    return a.sessionId.localeCompare(b.sessionId);
  });
  return records[0];
}

export function sessionIdFromParsed(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const value = parsed.session_id ?? parsed.sessionId ?? null;
  return isClaudeSessionId(value) ? value : null;
}

export function extractSessionIdFromText(text) {
  if (!text) {
    return null;
  }
  const trimmed = String(text).trim();
  if (!trimmed) {
    return null;
  }
  try {
    const fromJson = sessionIdFromParsed(JSON.parse(trimmed));
    if (fromJson) {
      return fromJson;
    }
  } catch {
    // Fall through to substring search for truncated print-mode JSON.
  }
  const keyed = trimmed.match(SESSION_ID_IN_TEXT_RE) || trimmed.match(SESSION_ID_CAMEL_IN_TEXT_RE);
  return keyed ? keyed[1] : null;
}

export function sessionIdFromResumeValue(value) {
  if (value === true || value === false || value == null) {
    return null;
  }
  const text = String(value).trim();
  return isClaudeSessionId(text) ? text : null;
}
