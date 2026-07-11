import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleCancel } from "../scripts/lib/job-commands.mjs";
import {
  getProcessStartTime,
  isProcessAlive,
  isProcessGroupAlive,
  runProcess,
  terminateProcessTree,
  verifyProcessRecord
} from "../scripts/lib/process.mjs";
import { readJobFile, upsertJob, writeJobFile } from "../scripts/lib/state.mjs";
import { makeTempDir } from "./helpers.mjs";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

test("isProcessGroupAlive injectable behavior: ESRCH false, success true, EPERM true", () => {
  // Injectable contract mirrors default probe outcomes (boolean only).
  assert.equal(isProcessGroupAlive(42, { isProcessGroupAliveImpl: () => false }), false); // ESRCH
  assert.equal(isProcessGroupAlive(42, { isProcessGroupAliveImpl: () => true }), true); // success
  assert.equal(isProcessGroupAlive(42, { isProcessGroupAliveImpl: () => true }), true); // EPERM → alive
  assert.equal(isProcessGroupAlive(Number.NaN), false);

  // Default probe: empty group → ESRCH → false (POSIX).
  if (process.platform !== "win32") {
    assert.equal(isProcessGroupAlive(999999991), false);
  }
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
  assert.equal(result.groupCleared, true);
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
  assert.equal(result.groupCleared, true);
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
      isProcessGroupAliveImpl: () => alive,
      stopGraceMs: 1,
      hardTimeoutMs: 20,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.escalated, true);
  assert.equal(result.groupCleared, true);
  assert.deepEqual(signals, [[-123, "SIGTERM"], [-123, "SIGKILL"]]);
});

test("terminateProcessTree skips group SIGKILL when leader pid is reused during grace", async () => {
  // Leader matches at entry, dies during grace, then the pid reappears with a
  // new start time (pid-reused) while the group probe still reports alive.
  // Escalating with kill(-pid, SIGKILL) would hit an innocent new group.
  const originalStart = "Mon Jan  1 00:00:00 2026";
  const reusedStart = "Tue Jan  2 12:00:00 2026";
  let psCalls = 0;
  const signals = [];
  const result = await terminateProcessTree(
    { pid: 424242, processStartTime: originalStart, processGroup: true },
    {
      runCommandImpl: () => {
        psCalls += 1;
        // Initial verify + first grace poll still match the recorded leader.
        if (psCalls <= 2) {
          return psResult(originalStart);
        }
        // Subsequent polls: leader gone then recycled under the same pid.
        if (psCalls === 3) {
          return psResult("", 1);
        }
        return psResult(reusedStart);
      },
      isProcessGroupAliveImpl: () => true,
      killImpl: (pid, signal) => {
        signals.push([pid, signal]);
      },
      stopGraceMs: 40,
      hardTimeoutMs: 80,
      pollIntervalMs: 5
    }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.escalated, false);
  assert.equal(result.method, "process-group");
  assert.equal(result.verification.reason, "pid-reused");
  assert.equal(result.verification.matches, false);
  assert.equal(result.groupCleared, false);
  assert.deepEqual(
    signals,
    [[-424242, "SIGTERM"]],
    `expected only group SIGTERM (no SIGKILL); got ${JSON.stringify(signals)}`
  );
  assert.ok(
    !signals.some(([, signal]) => signal === "SIGKILL"),
    "must not issue group-targeted SIGKILL after pid-reuse detection"
  );
});

test("terminateProcessTree sets groupCleared true for non-group process method", async () => {
  let alive = true;
  const signals = [];
  const result = await terminateProcessTree(
    { pid: 456, processStartTime: "Mon Jan  1 00:00:00 2026", processGroup: false },
    {
      runCommandImpl: () => alive ? psResult("Mon Jan  1 00:00:00 2026") : psResult("", 1),
      killImpl: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === "SIGTERM") {
          alive = false;
        }
      },
      processGroup: false,
      stopGraceMs: 1,
      hardTimeoutMs: 20,
      pollIntervalMs: 1
    }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.escalated, false);
  assert.equal(result.method, "process");
  assert.equal(result.groupCleared, true);
  assert.deepEqual(signals, [[456, "SIGTERM"]]);
});

test("terminateProcessTree escalates when process-group members ignore SIGTERM after leader exits", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process-group semantics only");
    return;
  }

  // Grandchild ignores SIGTERM and keeps the process group alive after the leader exits.
  // Ready file ensures the trap is installed before we signal the group.
  const readyDir = makeTempDir();
  const readyFile = path.join(readyDir, "ready");
  const grandchildCode = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
    `require('fs').writeFileSync(${JSON.stringify(readyFile)}, 'ready');`,
    "setTimeout(() => process.exit(0), 60000);"
  ].join("");
  const leaderCode = [
    "const { spawn } = require('child_process');",
    // Same process group as the detached leader (default; not re-detached).
    `spawn(process.execPath, ${JSON.stringify(["-e", grandchildCode])}, { stdio: 'ignore' });`,
    // Stay alive until SIGTERM so verifyProcessRecord still matches at terminate start.
    "setTimeout(() => process.exit(0), 15000);"
  ].join("");

  const leader = spawn(process.execPath, ["-e", leaderCode], {
    detached: true,
    stdio: "ignore"
  });
  leader.unref();
  const pid = leader.pid;
  assert.ok(Number.isFinite(pid) && pid > 0, "leader pid required");

  try {
    const readyDeadline = Date.now() + 5000;
    while (!fs.existsSync(readyFile) && Date.now() < readyDeadline) {
      await sleep(25);
    }
    assert.ok(fs.existsSync(readyFile), "grandchild must install SIGTERM trap before terminate");
    assert.equal(processAlive(pid), true, "leader must still be alive when terminate starts");
    assert.equal(processGroupAlive(pid), true, "process group must be live before terminate");

    const processStartTime = getProcessStartTime(pid);
    const result = await terminateProcessTree(
      { pid, processStartTime, processGroup: true },
      {
        // Grace long enough for the leader to die under SIGTERM while the trapped
        // grandchild keeps the group alive — forces SIGKILL escalation.
        stopGraceMs: 500,
        hardTimeoutMs: 4000,
        pollIntervalMs: 40,
        allowUnverified: !processStartTime
      }
    );

    assert.equal(result.attempted, true);
    assert.equal(result.delivered, true);
    assert.equal(result.method, "process-group");
    assert.equal(result.groupCleared, true, "group must be empty after terminate");
    assert.equal(result.escalated, true, "SIGKILL required for SIGTERM-trapping grandchild");
    assert.equal(result.verification.matches, false);

    let groupStillAlive = false;
    try {
      process.kill(-pid, 0);
      groupStillAlive = true;
    } catch (error) {
      assert.equal(error.code, "ESRCH", `expected empty group (ESRCH), got ${error.code}`);
    }
    assert.equal(groupStillAlive, false, "kill(-pid, 0) must fail with ESRCH when group is clear");
  } finally {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
    cleanupDir(readyDir);
  }
});

test("handleCancel markCancelFailed when groupCleared is false despite leader gone", async () => {
  const dataDir = makeTempDir();
  const cwd = makeTempDir();
  const previousDataDir = process.env.CLAUDE_ROUTER_DATA;
  process.env.CLAUDE_ROUTER_DATA = dataDir;
  try {
    const job = {
      id: "group-uncleared-cancel",
      workspaceRoot: cwd,
      status: "running",
      phase: "running",
      mode: "analyze",
      pid: 888001,
      processStartTime: "Mon Jan  1 00:00:00 2026",
      processGroup: true,
      logFile: null
    };
    writeJobFile(cwd, job.id, job);
    upsertJob(cwd, job);

    await assert.rejects(
      () => handleCancel(cwd, {
        reference: job.id,
        json: true,
        terminateProcessTreeImpl: async () => ({
          attempted: true,
          delivered: true,
          escalated: false,
          method: "process-group",
          verification: {
            alive: false,
            matches: false,
            reason: "not-running",
            currentStartTime: null
          },
          groupCleared: false
        })
      }),
      /Cannot confirm cancellation/
    );

    const afterCancel = readJobFile(cwd, job.id);
    assert.equal(afterCancel.status, "running");
    assert.equal(afterCancel.phase, "cancel-failed");
    assert.equal(afterCancel.cancelRequestedAt, undefined);
    assert.ok(afterCancel.cancelFailedAt);
    assert.equal(afterCancel.cancelSignal.groupCleared, false);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_ROUTER_DATA;
    } else {
      process.env.CLAUDE_ROUTER_DATA = previousDataDir;
    }
    cleanupDir(dataDir);
    cleanupDir(cwd);
  }
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

test("runProcess settles tracking failure when child already gone (no TDZ hang)", async () => {
  // Repro: onSpawn throws after spawn; verification is non-matching and isProcessAlive is false,
  // so the tracking-failure IIFE never awaits. Pre-fix, that path clears `timeout` while still
  // in TDZ → unhandled rejection → runProcess never settles.
  const settleRace = Promise.race([
    runProcess(process.execPath, ["-e", ""], {
      runCommandImpl: noStartTimeCommand,
      isProcessAliveImpl: () => false,
      onSpawn: () => {
        throw new Error("tracking write failed");
      }
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("runProcess hung: tracking-failure path did not settle within 5s")), 5000);
    })
  ]);

  const result = await settleRace;
  assert.equal(result.trackingFailed, true);
  assert.match(String(result.trackingError?.message ?? result.error?.message ?? ""), /tracking write failed/);
  assert.equal(result.status, 1);
  assert.equal(result.processGone, true);
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

test("runProcess kills child when output exceeds maxOutputBytes and sets outputTruncated", async () => {
  const cap = 8 * 1024;
  const started = Date.now();
  const settleRace = Promise.race([
    runProcess(
      process.execPath,
      [
        "-e",
        [
          // Emit past the cap then keep writing so the process would hang without a kill.
          `process.stdout.write("x".repeat(${cap + 1}));`,
          "setInterval(() => { process.stdout.write('y'.repeat(1024)); }, 20);",
          "setTimeout(() => process.exit(0), 60000);"
        ].join("")
      ],
      {
        maxOutputBytes: cap,
        stopGraceMs: 50,
        hardTimeoutMs: 1000,
        pollIntervalMs: 25,
        timeoutMs: 15000
      }
    ),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("runProcess hung after maxOutputBytes exceed")), 10000);
    })
  ]);

  const result = await settleRace;
  const elapsedMs = Date.now() - started;

  assert.equal(result.outputTruncated, true);
  assert.equal(result.timedOut, false);
  assert.ok(
    result.stdout.length + result.stderr.length > cap,
    `expected captured output over cap, got ${result.stdout.length + result.stderr.length}`
  );
  assert.ok(elapsedMs < 8000, `expected prompt settle after output cap, took ${elapsedMs}ms`);
  if (Number.isFinite(result.pid)) {
    assert.equal(processAlive(result.pid), false, `child ${result.pid} should be dead after output cap kill`);
  }
});

test("runProcess leaves outputTruncated false when maxOutputBytes is unset", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('hello'); process.exit(0);"],
    { timeoutMs: 5000 }
  );
  assert.equal(result.outputTruncated, false);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /hello/);
});
