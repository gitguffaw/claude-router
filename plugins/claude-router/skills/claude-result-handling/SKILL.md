---
name: claude-result-handling
description: Internal guidance for preserving Claude Router output boundaries
user-invocable: false
---

# Claude Result Handling

- Present the runtime output as returned: status, the task output, and `failureKind` when it is set.
- A ready result is the task output. Report an authentication error when the output includes one. Leave the rest as returned.
- If Claude review returns findings, present findings first and stop.
- Do not auto-apply fixes from a review.
- If Claude failed, report the failure and do not generate a replacement answer.
- If `failureKind` is `killed-in-progress`, report that the session was killed in progress and keep the resume hint that is already in the output. Do not describe this as an empty model failure.
- If `failureKind` is `auth-failed`, report that Claude is not logged in. Do not treat the login prompt as the model’s answer.
- If `failureKind` is `claude-error`, report Claude’s print-mode error. Do not invent a substitute answer.
- Failed, cancelled, interrupted, and blocked managed jobs exit 1 from the companion. `status`, `result`, and `cancel` still exit 0 when the control call itself succeeds. The MCP tool still returns the host view for those jobs.
- If the host view is missing, report that the run failed and stop.
