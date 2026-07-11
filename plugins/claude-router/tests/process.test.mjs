import assert from "node:assert/strict";
import test from "node:test";
import { isProcessAlive, runProcess, terminateProcessTree, verifyProcessRecord } from "../scripts/lib/process.mjs";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function psResult(startTime, status = 0) {
  return { status, stdout: startTime ? `${startTime}\n` : "", stderr: "", error: null };
}

function noStartTimeCommand() {
  return { status: 1, stdout: "", stderr: "", error: null };
}

test("verifyProcessRecord rejects PID reuse by comparing process start time", () => {
  const verification = verifyProcessRecord(
    { pid: 123, processStartTime: "Mon Jan  1 00:00:00 2026" },
    {
      runCommandImpl: () => psResult("Tue Jan  2 00:00:00 2026")
    }
  );

  assert.equal(verification.alive, true);
  assert.equal(verification.matches, false);
  assert.equal(verification.reason, "pid-reused");
});

test("verifyProcessRecord allows live process without start identity when unverified is allowed", () => {
  const verification = verifyProcessRecord(
    { pid: 4242, processStartTime: null },
    {
      runCommandImpl: noStartTimeCommand,
      isProcessAliveImpl: () => true,
      allowUnverified: true
    }
  );
  assert.equal(verification.alive, true);
  assert.equal(verification.matches, true);
  assert.equal(verification.reason, "unverified");
  assert.equal(verification.currentStartTime, null);
});

test("verifyProcessRecord refuses live process without start identity when unverified is disallowed", () => {
  const verification = verifyProcessRecord(
    { pid: 4242, processStartTime: null },
    {
      runCommandImpl: noStartTimeCommand,
      isProcessAliveImpl: () => true,
      allowUnverified: false
    }
  );
  assert.equal(verification.alive, true);
  assert.equal(verification.matches, false);
  assert.equal(verification.reason, "unverifiable");
});

test("verifyProcessRecord reports not-running when existence probe fails", () => {
  const verification = verifyProcessRecord(
    { pid: 4242, processStartTime: "Mon Jan  1 00:00:00 2026" },
    {
      runCommandImpl: noStartTimeCommand,
      isProcessAliveImpl: () => false,
      allowUnverified: true
    }
  );
  assert.equal(verification.alive, false);
  assert.equal(verification.matches, false);
  assert.equal(verification.reason, "not-running");
});

test("isProcessAlive treats EPERM as alive via injectable probe defaults", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999999991, { isProcessAliveImpl: () => false }), false);
  assert.equal(isProcessAlive(42, { isProcessAliveImpl: () => true }), true);
});

test("terminateProcessTree Windows-style taskkill returns post-kill gone verification", async () => {
  let alive = true;
  const commands = [];
  const result = await terminateProcessTree(
    { pid: 777, processStartTime: null },
    {
      useTaskkill: true,
      allowUnverified: true,
      stopGraceMs: 1,
      hardTimeoutMs: 20,
      pollIntervalMs: 1,
      isProcessAliveImpl: () => alive,
      runCommandImpl: (command, args) => {
        commands.push([command, ...args]);
        if (command === "taskkill") {
          alive = false;
          return { status: 0, stdout: "SUCCESS", stderr: "", error: null };
        }
        return noStartTimeCommand();
      }
    }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.method, "taskkill");
  assert.ok(
    commands.some((entry) => entry[0] === "taskkill" && entry.includes("777")),
    `expected taskkill for pid 777, got ${JSON.stringify(commands)}`
  );
  assert.equal(result.verification.matches, false);
  assert.equal(result.verification.reason, "not-running");
  assert.equal(result.verification.alive, false);
});

test("terminateProcessTree refuses to signal a reused PID", async () => {
  const signals = [];
  const result = await terminateProcessTree(
    { pid: 123, processStartTime: "Mon Jan  1 00:00:00 2026" },
    {
      runCommandImpl: () => psResult("Tue Jan  2 00:00:00 2026"),
      killImpl: (pid, signal) => signals.push([pid, signal]),
      stopGraceMs: 1,
      hardTimeoutMs: 2,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.attempted, false);
  assert.equal(result.verification.reason, "pid-reused");
  assert.deepEqual(signals, []);
});

test("terminateProcessTree escalates from SIGTERM to SIGKILL when process stays alive", async () => {
  let alive = true;
  const signals = [];
  const result = await terminateProcessTree(
    { pid: 123, processStartTime: "Mon Jan  1 00:00:00 2026" },
    {
      runCommandImpl: () => alive ? psResult("Mon Jan  1 00:00:00 2026") : psResult("", 1),
      killImpl: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === "SIGKILL") {
          alive = false;
        }
      },
      stopGraceMs: 1,
      hardTimeoutMs: 20,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.escalated, true);
  assert.deepEqual(signals, [[-123, "SIGTERM"], [-123, "SIGKILL"]]);
});

test("runProcess resolves tracking failure only after child is gone", async () => {
  const result = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stopGraceMs: 50,
    hardTimeoutMs: 1000,
    pollIntervalMs: 25,
    onSpawn: () => {
      throw new Error("persist identity failed");
    }
  });

  assert.equal(result.trackingFailed, true);
  assert.match(String(result.trackingError?.message ?? result.error?.message ?? ""), /persist identity failed/);
  assert.equal(result.status, 1);
  assert.ok(Number.isFinite(result.pid), "child pid should be reported");
  assert.equal(result.processGone, true, "promise must not resolve while verification still matches");
  assert.equal(result.verification?.matches, false);
  // Immediate post-resolution death is the invariant (no polling loop for correctness).
  assert.equal(processAlive(result.pid), false, `child ${result.pid} should already be dead at resolve`);
});

test("runProcess keeps retrying tracking-failure termination until process is gone", async () => {
  let attempts = 0;
  const realKill = process.kill.bind(process);
  const result = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stopGraceMs: 10,
    hardTimeoutMs: 40,
    pollIntervalMs: 10,
    onSpawn: () => {
      throw new Error("persist identity failed");
    },
    // Suppress early hard-kills so the shutdown loop must retry terminateImpl.
    killImpl: (pid, signal) => {
      if (attempts < 3) {
        return;
      }
      realKill(pid, signal);
    },
    terminateProcessTreeImpl: async (record, options = {}) => {
      attempts += 1;
      if (attempts < 3) {
        return {
          attempted: true,
          delivered: true,
          escalated: true,
          method: "process-group",
          verification: {
            alive: true,
            matches: true,
            reason: "matched",
            currentStartTime: record.processStartTime ?? "Mon Jan  1 00:00:00 2026"
          }
        };
      }
      return terminateProcessTree(record, {
        ...options,
        killImpl: realKill,
        stopGraceMs: 20,
        hardTimeoutMs: 500,
        pollIntervalMs: 10,
        allowUnverified: true
      });
    }
  });

  assert.ok(attempts >= 3, `expected retries, got ${attempts}`);
  assert.equal(result.trackingFailed, true);
  assert.equal(result.processGone, true);
  assert.equal(result.verification?.matches, false);
  assert.equal(processAlive(result.pid), false);
});

test("runProcess captures stdout written after child exit via shared fd grandchild", async () => {
  // Parent exits immediately; grandchild keeps the inherited stdout write end open and
  // emits a marker shortly after. Settling on "exit" drops that chunk; "close" captures it.
  const marker = "POST_EXIT_STDOUT_MARKER";
  const grandchild = [
    "setTimeout(() => {",
    `  process.stdout.write(${JSON.stringify(marker)});`,
    "  process.exit(0);",
    "}, 100);"
  ].join("");
  const parent = [
    "const { spawn } = require('child_process');",
    `spawn(process.execPath, ${JSON.stringify(["-e", grandchild])}, {`,
    "  stdio: ['ignore', 'inherit', 'ignore']",
    "});",
    "process.exit(0);"
  ].join("");

  const result = await runProcess(process.execPath, ["-e", parent], {
    timeoutMs: 5000
  });

  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  assert.ok(
    result.stdout.includes(marker),
    `expected stdout to include ${marker}, got ${JSON.stringify(result.stdout)}`
  );
});

test("runProcess settles via stream drain when detached grandchild keeps stdout open", async () => {
  // No timeoutMs: without a bounded drain after "exit", a long-lived grandchild that
  // inherits stdout would hang runProcess forever (close never fires).
  const marker = "DRAIN_EXIT_MARKER";
  const grandchild = [
    "const fs = require('fs');",
    // Self-timeout so the process cannot outlive CI if cleanup fails.
    "setTimeout(() => process.exit(0), 15000);",
    "process.on('SIGTERM', () => process.exit(0));",
    "process.on('SIGINT', () => process.exit(0));",
    // Keep the write end of the inherited stdout open until we exit.
    "setInterval(() => {}, 1000);"
  ].join("");
  const parent = [
    "const { spawn } = require('child_process');",
    `process.stdout.write(${JSON.stringify(marker)});`,
    `const child = spawn(process.execPath, ${JSON.stringify(["-e", grandchild])}, {`,
    "  stdio: ['ignore', 'inherit', 'ignore'],",
    "  detached: true",
    "});",
    "child.unref();",
    // Emit pid so the test can kill the orphan if needed.
    "process.stderr.write('GC_PID=' + child.pid + '\\n');",
    "process.exit(0);"
  ].join("");

  let grandchildPid = null;
  const started = Date.now();
  const result = await runProcess(process.execPath, ["-e", parent], {
    streamDrainTimeoutMs: 300,
    onStderr: (chunk) => {
      const match = String(chunk).match(/GC_PID=(\d+)/);
      if (match) {
        grandchildPid = Number(match[1]);
      }
    }
  });
  const elapsedMs = Date.now() - started;

  try {
    assert.equal(result.status, 0);
    assert.equal(result.timedOut, false);
    assert.ok(
      result.stdout.includes(marker),
      `expected stdout to include ${marker}, got ${JSON.stringify(result.stdout)}`
    );
    assert.ok(
      elapsedMs < 5000,
      `expected settle well under grandchild lifetime, took ${elapsedMs}ms`
    );
  } finally {
    if (Number.isFinite(grandchildPid) && grandchildPid > 0) {
      try {
        process.kill(grandchildPid, "SIGTERM");
      } catch {
        // Already gone.
      }
      try {
        process.kill(-grandchildPid, "SIGTERM");
      } catch {
        // Process group may not apply.
      }
    }
  }
});

test("runProcess does not kill a fast child when timeoutMs exceeds setTimeout max delay", async () => {
  // Node clamps setTimeout delays > 2^31-1 to ~1ms; without clamping, MAX_SAFE_INTEGER
  // becomes an instant kill. A short-lived child must still complete successfully.
  const result = await runProcess(
    process.execPath,
    ["-e", "setTimeout(() => { process.stdout.write('ok'); process.exit(0); }, 100);"],
    { timeoutMs: Number.MAX_SAFE_INTEGER }
  );

  assert.equal(result.timedOut, false);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok/);
});
