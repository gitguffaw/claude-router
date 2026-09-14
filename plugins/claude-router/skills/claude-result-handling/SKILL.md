---
name: claude-result-handling
description: Internal guidance for preserving Claude Router output boundaries
user-invocable: false
---

# Claude Result Handling

- Preserve status, job id, context-pack id, findings, summaries, touched files, verification, and next steps.
- If Claude review returns findings, present findings first and stop.
- Do not auto-apply fixes from a review.
- If Claude failed, report the failure and do not generate a replacement answer.
- If a job timed out with `failureKind: killed-in-progress` or a `claudeSessionId`, report that the session was killed in progress. Include the job log path, session path, and `claude --resume` pointer. Do not describe this as an empty model failure.
- If `failureKind` is `auth-failed`, report that Claude is not logged in. Do not treat the login prompt as the model’s answer.
- If `failureKind` is `claude-error`, report Claude’s print-mode error. Do not invent a substitute answer.
- Failed, cancelled, interrupted, and blocked managed jobs exit 1 from the companion. `status`, `result`, and `cancel` still exit 0 when the control call itself succeeds.
- If output is malformed, include the actionable parse or stderr detail and stop.
