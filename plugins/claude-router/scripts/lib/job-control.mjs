import { listJobs, readJobFile } from "./state.mjs";

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

export function resolveJob(workspaceRoot, reference = "") {
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  if (!jobs.length) {
    throw new Error("No Claude Router jobs found.");
  }
  if (!reference) {
    return jobs[0];
  }
  const job = jobs.find((candidate) => candidate.id === reference || candidate.id.startsWith(reference));
  if (!job) {
    throw new Error(`No Claude Router job found for "${reference}".`);
  }
  return job;
}

export function readFullJob(workspaceRoot, reference = "") {
  const job = resolveJob(workspaceRoot, reference);
  return readJobFile(workspaceRoot, job.id) ?? job;
}
