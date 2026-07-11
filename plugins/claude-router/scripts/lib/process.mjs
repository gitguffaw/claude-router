import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_STOP_GRACE_MS = 60000;
const DEFAULT_STOP_HARD_TIMEOUT_MS = 70000;
const DEFAULT_STOP_POLL_MS = 250;

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
    windowsHide: true
  });
  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error?.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    return { available: false, detail: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  }
  return { available: true, detail: (result.stdout || result.stderr || "ok").trim() };
}

export function getProcessStartTime(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return null;
  }
  if (process.platform === "win32") {
    return null;
  }
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const result = runCommandImpl("ps", ["-p", String(pid), "-o", "lstart="], options);
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout ?? "").trim() || null;
}

function defaultProcessAliveProbe(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable by this user.
    return Boolean(error && error.code === "EPERM");
  }
}

/**
 * Portable process existence probe. Injectable via options.isProcessAliveImpl.
 * Uses process.kill(pid, 0); EPERM counts as alive.
 */
export function isProcessAlive(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return false;
  }
  const probe = options.isProcessAliveImpl ?? defaultProcessAliveProbe;
  return Boolean(probe(Number(pid)));
}

export function buildProcessRecord(pid, options = {}) {
  const base = Number.isFinite(pid) ? { pid, processStartTime: getProcessStartTime(pid, options) } : { pid: null, processStartTime: null };
  if (typeof options.processGroup === "boolean") {
    base.processGroup = options.processGroup;
  }
  return base;
}

export function currentProcessRecord(options = {}) {
  return buildProcessRecord(process.pid, options);
}

export function verifyProcessRecord(record, options = {}) {
  const pid = typeof record === "number" ? record : record?.pid;
  if (!Number.isFinite(pid)) {
    return { alive: false, matches: false, reason: "missing-pid", currentStartTime: null };
  }
  const expectedStartTime = typeof record === "object" ? (record.processStartTime ?? null) : null;
  const currentStartTime = getProcessStartTime(pid, options);

  // When start identity is available, compare as today (fail closed on PID reuse).
  if (currentStartTime) {
    if (expectedStartTime && currentStartTime !== expectedStartTime) {
      return { alive: true, matches: false, reason: "pid-reused", currentStartTime };
    }
    if (!expectedStartTime) {
      if (options.allowUnverified) {
        return { alive: true, matches: true, reason: "unverified", currentStartTime };
      }
      return { alive: true, matches: false, reason: "unverifiable", currentStartTime };
    }
    return { alive: true, matches: true, reason: "matched", currentStartTime };
  }

  // Start lookup unavailable (Windows, transient ps failure): probe existence first.
  const exists = isProcessAlive(pid, options);
  if (!exists) {
    return { alive: false, matches: false, reason: "not-running", currentStartTime: null };
  }
  if (options.allowUnverified) {
    return { alive: true, matches: true, reason: "unverified", currentStartTime: null };
  }
  return { alive: true, matches: false, reason: "unverifiable", currentStartTime: null };
}

function shouldSignalProcessGroup(record, options = {}) {
  if (process.platform === "win32") {
    return false;
  }
  if (typeof options.processGroup === "boolean") {
    return options.processGroup;
  }
  if (typeof record === "object" && typeof record?.processGroup === "boolean") {
    return record.processGroup;
  }
  return true;
}

function processGroupSignalTarget(pid) {
  return process.platform !== "win32" ? -pid : pid;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function waitUntilGone(record, deadline, pollIntervalMs, options = {}) {
  let verification = verifyProcessRecord(record, options);
  while (verification.matches && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    verification = verifyProcessRecord(record, options);
  }
  return verification;
}

export function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let trackingShutdownActive = false;
    const detached = options.detached ?? process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"],
      detached,
      shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
      windowsHide: true
    });
    const processRecord = buildProcessRecord(child.pid ?? Number.NaN, { processGroup: Boolean(detached && process.platform !== "win32") });
    let trackingError = null;
    const finish = (payload) => {
      if (settled || trackingShutdownActive) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ ...payload, timedOut, trackingFailed: Boolean(trackingError), trackingError });
    };
    try {
      options.onSpawn?.(processRecord);
    } catch (error) {
      trackingError = error;
      trackingShutdownActive = true;
      // Tracking-failure shutdown owns settlement; never resolve while the child still matches.
      void (async () => {
        const stopGraceMs = options.stopGraceMs ?? 200;
        const hardTimeoutMs = options.hardTimeoutMs ?? 2000;
        const pollIntervalMs = options.pollIntervalMs ?? 25;
        const terminateImpl = options.terminateProcessTreeImpl ?? terminateProcessTree;
        const killImpl = options.killImpl ?? process.kill.bind(process);
        const verifyOpts = {
          allowUnverified: true,
          runCommandImpl: options.runCommandImpl,
          isProcessAliveImpl: options.isProcessAliveImpl
        };
        let verification = verifyProcessRecord(processRecord, verifyOpts);
        let terminateAttempts = 0;
        // Always attempt termination at least once when the just-spawned child still exists,
        // even if start-time lookup is unavailable or initially unverifiable.
        while (verification.matches || (terminateAttempts === 0 && isProcessAlive(processRecord.pid, verifyOpts))) {
          terminateAttempts += 1;
          try {
            const term = await terminateImpl(processRecord, {
              stopGraceMs,
              hardTimeoutMs,
              pollIntervalMs,
              allowUnverified: true,
              killImpl,
              runCommandImpl: options.runCommandImpl,
              isProcessAliveImpl: options.isProcessAliveImpl,
              useTaskkill: options.useTaskkill
            });
            verification = term.verification ?? verifyProcessRecord(processRecord, verifyOpts);
          } catch {
            verification = verifyProcessRecord(processRecord, verifyOpts);
          }
          if (!verification.matches && !isProcessAlive(processRecord.pid, verifyOpts)) {
            break;
          }
          try {
            if (Number.isFinite(processRecord.pid)) {
              if (processRecord.processGroup && process.platform !== "win32" && !options.useTaskkill) {
                try {
                  killImpl(-processRecord.pid, "SIGKILL");
                } catch {
                  killImpl(processRecord.pid, "SIGKILL");
                }
              } else {
                killImpl(processRecord.pid, "SIGKILL");
              }
            }
          } catch {
            // Already gone or not signalable.
          }
          verification = await waitUntilGone(
            processRecord,
            Date.now() + Math.max(pollIntervalMs, hardTimeoutMs),
            pollIntervalMs,
            verifyOpts
          );
          if (!verification.matches && !isProcessAlive(processRecord.pid, verifyOpts)) {
            break;
          }
        }
        if (settled) {
          return;
        }
        settled = true;
        trackingShutdownActive = false;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve({
          command,
          args,
          status: 1,
          signal: "SIGKILL",
          stdout: "",
          stderr: "",
          error,
          pid: child.pid ?? null,
          processStartTime: processRecord.processStartTime,
          processGroup: processRecord.processGroup,
          timedOut: false,
          trackingFailed: true,
          trackingError: error,
          processGone: true,
          verification
        });
      })();
    }
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(processRecord, {
        stopGraceMs: options.stopGraceMs ?? 1000,
        hardTimeoutMs: options.hardTimeoutMs ?? 5000,
        pollIntervalMs: options.pollIntervalMs ?? 100,
        allowUnverified: true
      });
    }, timeoutMs) : null;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      finish({
        command,
        args,
        status: 1,
        signal: null,
        stdout,
        stderr,
        error: trackingError ?? error,
        pid: child.pid ?? null,
        processStartTime: processRecord.processStartTime,
        processGroup: processRecord.processGroup
      });
    });
    child.on("exit", (status, signal) => {
      finish({
        command,
        args,
        status: status ?? (signal ? 1 : 0),
        signal: signal ?? null,
        stdout,
        stderr,
        error: trackingError,
        pid: child.pid ?? null,
        processStartTime: processRecord.processStartTime,
        processGroup: processRecord.processGroup
      });
    });
    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export function spawnDetached(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
    windowsHide: true
  });
  child.unref();
  return buildProcessRecord(child.pid ?? Number.NaN, { processGroup: process.platform !== "win32" });
}

export async function terminateProcessTree(record, options = {}) {
  const pid = typeof record === "number" ? record : record?.pid;
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, escalated: false, method: null, verification: { reason: "missing-pid" } };
  }
  const verification = verifyProcessRecord(record, options);
  if (!verification.matches) {
    return { attempted: false, delivered: false, escalated: false, method: null, verification };
  }
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const stopGraceMs = Math.max(0, Number(options.stopGraceMs) || DEFAULT_STOP_GRACE_MS);
  const hardTimeoutMs = Math.max(stopGraceMs, Number(options.hardTimeoutMs) || DEFAULT_STOP_HARD_TIMEOUT_MS);
  const pollIntervalMs = Math.max(25, Number(options.pollIntervalMs) || DEFAULT_STOP_POLL_MS);
  const useTaskkill = options.useTaskkill === true || process.platform === "win32";
  if (!useTaskkill) {
    const signalProcessGroup = shouldSignalProcessGroup(record, options);
    let method = signalProcessGroup ? "process-group" : "process";
    try {
      killImpl(signalProcessGroup ? processGroupSignalTarget(pid) : pid, "SIGTERM");
    } catch (error) {
      if (signalProcessGroup) {
        // Process-group signal can fail even when the leader pid is still live; fall back.
        try {
          killImpl(pid, "SIGTERM");
          method = "process";
        } catch (innerError) {
          if (innerError?.code !== "ESRCH") {
            throw innerError;
          }
          return { attempted: true, delivered: false, escalated: false, method, verification: verifyProcessRecord(record, options) };
        }
      } else if (error?.code === "ESRCH") {
        return { attempted: true, delivered: false, escalated: false, method, verification: verifyProcessRecord(record, options) };
      } else {
        throw error;
      }
    }
    const afterTerm = await waitUntilGone(record, Date.now() + stopGraceMs, pollIntervalMs, options);
    if (!afterTerm.matches) {
      return { attempted: true, delivered: true, escalated: false, method, verification: afterTerm };
    }
    try {
      killImpl(method === "process-group" ? processGroupSignalTarget(pid) : pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
    const afterKill = await waitUntilGone(record, Date.now() + Math.max(0, hardTimeoutMs - stopGraceMs), pollIntervalMs, options);
    return { attempted: true, delivered: true, escalated: true, method, verification: afterKill };
  }

  // Windows (or forced) taskkill path: always return post-termination verification.
  const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], options);
  const afterKill = await waitUntilGone(record, Date.now() + hardTimeoutMs, pollIntervalMs, options);
  return {
    attempted: true,
    delivered: result.status === 0,
    escalated: result.status === 0,
    method: "taskkill",
    result,
    verification: afterKill
  };
}
