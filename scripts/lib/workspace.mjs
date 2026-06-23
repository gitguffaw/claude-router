import { runCommand } from "./process.mjs";

export function resolveWorkspaceRoot(cwd) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (!result.error && result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return cwd;
}

export function readGitStatus(cwd) {
  const result = runCommand("git", ["status", "--short"], { cwd });
  if (result.error || result.status !== 0) {
    return { available: false, short: "", dirty: false };
  }
  const short = result.stdout.trim();
  return { available: true, short, dirty: Boolean(short) };
}
