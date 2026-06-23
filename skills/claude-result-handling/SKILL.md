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
- If output is malformed, include the actionable parse or stderr detail and stop.
