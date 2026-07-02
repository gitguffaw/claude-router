import assert from "node:assert/strict";
import test from "node:test";
import { terminateProcessTree, verifyProcessRecord } from "../scripts/lib/process.mjs";

function psResult(startTime, status = 0) {
  return { status, stdout: startTime ? `${startTime}\n` : "", stderr: "", error: null };
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
