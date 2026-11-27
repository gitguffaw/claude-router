// Secret masking for everything Claude Router writes to disk: job logs, job
// records, the job index, and context packs. Live output to the caller is not
// masked; only what persists after the call returns.

// A key must start at a token boundary, so words such as "risk-assessment-notes"
// or "task-abcdefghijklmnop" are left alone.
const BOUNDARY = "(?<![A-Za-z0-9_-])";
const ANTHROPIC_KEY = new RegExp(`${BOUNDARY}sk-ant-[A-Za-z0-9_-]{8,}`, "g");
// Skip keys the Anthropic pass already masked, so they stay "sk-ant-REDACTED".
const GENERIC_KEY = new RegExp(`${BOUNDARY}sk-(?!ant-REDACTED)[A-Za-z0-9_-]{12,}`, "g");

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(/(ANTHROPIC_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(OPENAI_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1REDACTED")
    .replace(ANTHROPIC_KEY, "sk-ant-REDACTED")
    .replace(GENERIC_KEY, "sk-REDACTED");
}

/** Mask every string inside plain objects and arrays; other values pass through. */
export function redactDeep(value) {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDeep(entry)]));
  }
  return value;
}

/**
 * Mask a job record before it is written. While the job is active, `request`
 * stays raw because the background worker launches Claude from the stored copy;
 * once the job leaves an active status, the request is masked too.
 */
export function redactJobForStorage(job, activeStatuses) {
  if (!job || typeof job !== "object") {
    return job;
  }
  const keepRequest = activeStatuses.has(job.status);
  return Object.fromEntries(
    Object.entries(job).map(([key, entry]) => [key, key === "request" && keepRequest ? entry : redactDeep(entry)])
  );
}
