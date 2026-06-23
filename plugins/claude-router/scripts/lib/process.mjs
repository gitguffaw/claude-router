import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

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

export function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"],
      detached: Boolean(options.detached),
      shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
      windowsHide: true
    });
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ ...payload, timedOut });
    };
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // The process may already have exited.
        }
      }
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
      finish({ command, args, status: 1, signal: null, stdout, stderr, error, pid: child.pid ?? null });
    });
    child.on("exit", (status, signal) => {
      finish({ command, args, status: status ?? 0, signal: signal ?? null, stdout, stderr, error: null, pid: child.pid ?? null });
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
  return child.pid ?? null;
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }
  const killImpl = options.killImpl ?? process.kill.bind(process);
  if (process.platform !== "win32") {
    try {
      killImpl(-pid, "SIGTERM");
      return { attempted: true, delivered: true, method: "process-group" };
    } catch (error) {
      if (error?.code !== "ESRCH") {
        try {
          killImpl(pid, "SIGTERM");
          return { attempted: true, delivered: true, method: "process" };
        } catch (innerError) {
          if (innerError?.code !== "ESRCH") {
            throw innerError;
          }
        }
      }
      return { attempted: true, delivered: false, method: "process-group" };
    }
  }
  const result = runCommand("taskkill", ["/PID", String(pid), "/T", "/F"], options);
  return { attempted: true, delivered: result.status === 0, method: "taskkill", result };
}
