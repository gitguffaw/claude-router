---
module: Linear Project Management
date: 2026-07-03
problem_type: workflow_issue
component: development_workflow
symptoms:
  - Existing `Codex Router` Linear project was updated instead of creating a new project
  - Project summary, roadmap, milestones, and issue metadata were overwritten in place
  - Recovery actions initially removed the newly drafted `Claude Router` state from that same project
  - User intent was to create a new project and then update it, but the workflow mutated the wrong resource
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: high
tags: [linear, project-management, destructive-update, workflow-guardrail, intent-misread]
---

# Troubleshooting: Existing Linear Project Overwritten Instead Of Creating A New One

## Problem

A request to "create and update" a Linear project was executed as an in-place update to an existing project. Instead of creating a separate `Claude Router` project, the workflow rewrote the existing `Codex Router` project and damaged its planning artifacts.

## Environment

- Module: Linear Project Management
- Affected Component: Development workflow targeting Linear projects
- Repository Context: `gitguffaw/claude-router`
- Date Solved: 2026-07-03

## Symptoms

- The existing `Codex Router` project was renamed and repopulated instead of staying intact.
- The roadmap document, milestones, and issue set for `Codex Router` were overwritten.
- A first recovery pass restored `Codex Router` but also wiped the newly drafted `Claude Router` state from that same object.
- The user explicitly called out that `create` had been ignored and that a new project should have been created instead.

## What Didn't Work

**Attempted Solution 1:** Treat the current repo context as the target Linear project and mutate the existing project in place.
- **Why it failed:** The workflow ignored the hard constraint implied by `create` and reused an existing project object instead of creating a new one.

**Attempted Solution 2:** Restore the original project before first separating the new project into its own Linear object.
- **Why it failed:** This corrected one side of the damage but also destroyed the newly drafted `Claude Router` content because both states were still sharing one Linear project object.

## Solution

The working fix had two parts:

1. Restore the original `Codex Router` project so its name, roadmap, milestones, and issue framing remained intact.
2. Create a brand-new `Claude Router` project and populate it independently with its own roadmap, milestones, status update, and issue set.

**Tool actions** (representative):

```text
save_project(id="ac2fea1c-c84c-4479-b2e5-63c569eeb6f1", name="Codex Router", ...)
save_document(id="c3689231-3fc9-4179-9348-2f5eb38dccc2", title="Codex Router Roadmap — Known Knowns", ...)
save_milestone(id="<existing>", name="Foundation + Namespace Split", ...)
save_issue(id="QNT-142".."QNT-150", ...)
```

```text
save_project(name="Claude Router", addTeams=["QNTSNCE"], ...)
save_document(project="6f44b984-ebab-406c-8ba2-92d366b5064d", title="Claude Router Roadmap — Known Knowns", ...)
save_milestone(project="6f44b984-ebab-406c-8ba2-92d366b5064d", name="Docs + Product Truth", ...)
save_issue(project="6f44b984-ebab-406c-8ba2-92d366b5064d", title="...", ...)
```

**Resulting state:**

- Restored original project: `Codex Router` (`ac2fea1c-c84c-4479-b2e5-63c569eeb6f1`)
- New project created: `Claude Router` (`6f44b984-ebab-406c-8ba2-92d366b5064d`)
- New project issue range: `QNT-151` through `QNT-159`

## Why This Works

The root failure was object identity, not naming. The workflow treated an existing project as a draft surface for a new initiative. The fix works because it restores the original object's identity first, then creates a second object for the new initiative, and only writes follow-up content against that new project ID.

This addresses the actual root cause:

1. `create` now maps to `create a new project object`, not `repurpose an existing one`.
2. Existing and new initiatives no longer share the same Linear project ID.
3. All subsequent roadmap, milestone, and issue writes are scoped to the correct project from the start.

## Prevention

- Split Linear operations into two explicit modes before making changes:
  - `Create project`
  - `Update existing project`
- Treat the verb `create` as a hard constraint. Do not reinterpret it as rename, repurpose, or overwrite.
- Resolve existing project updates by exact project ID or URL, not by nearby repo context or similar names.
- Capture a read-before-write snapshot of any existing project:
  - name
  - project ID
  - summary
  - milestone list
  - issue IDs
- Never use an existing Linear project as a temporary draft surface for a new initiative.
- For creation workflows, sequence the work in this order:
  - inspect related existing projects
  - confirm this is a new initiative
  - create the new project
  - record the new project ID
  - populate docs, milestones, issues, and status updates only against that new ID

## Validation Ideas

- Add a pre-mutation guard: if the task says `create`, require a `create project` step before any `update project` step.
- Add a similar-name collision check: if `Codex Router` exists and the request is for `Claude Router`, ensure the workflow creates a second project rather than updating the first.
- Add a cross-project verification step after creation: diff nearby project names/IDs and confirm only the new target changed.
- Add a protected-project rule for unrelated creation flows so that writes against pre-existing projects fail closed unless the user explicitly targeted them.

## Related Issues

No related issues documented yet.

Relevant in-repo references:

- Wrong-project targeting guidance in [README.md](../../../README.md#troubleshooting)
- Mutating-command guardrails in [README.md](../../../README.md#full-claude-cli-access)
- Raw passthrough contract in [plugins/claude-router/commands/raw.md](../../../plugins/claude-router/commands/raw.md)
- Mutating command detection in [plugins/claude-router/scripts/claude-companion.mjs](../../../plugins/claude-router/scripts/claude-companion.mjs)
