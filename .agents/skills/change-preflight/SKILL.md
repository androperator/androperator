---
name: change-preflight
description: Evaluate user benefit and the smallest proving experiment before new public APIs, architectural changes, or substantial performance work.
---

# Change Preflight

Establish whether the proposed change is worth implementing, and what evidence
would change that decision. Finish with a brief recommendation: proceed, run a
bounded experiment, or stop/narrow the proposal. Routine fixes and docs edits do
not require this skill.

Read the owning code and reuse available evidence. Answer these questions in a
short note in the conversation or existing plan, not a new repository task pack:

1. **Benefit:** What improves for the user or agent? Show proposed usage and say
   whether existing callers benefit or must adopt a new interface.
2. **Caller burden:** What must callers still implement? Identify missing product
   dependencies and whether defaults work with maintained capabilities. For API
   changes, use `api-agent-ux` to assess the actual first attempt.
3. **Evidence:** What supports the idea? Separate measured results from assumptions;
   name differences between the prototype and intended production path.
4. **Smallest experiment:** What could disprove the idea before broad refactoring
   or hardening? Use the intended execution path and preserve behavior and checks.
5. **Decision rule:** What observable result justifies the adoption and maintenance
   cost? Define a bounded experiment and when to stop or reconsider. Performance
   criteria need a comparable baseline, whole-workflow timing and reliability;
   other changes need an appropriate usability or correctness outcome.

Use the user's criteria when supplied. Otherwise state reasonable criteria and
assumptions before measuring; do not invent a universal percentage threshold or
move the target after seeing results. Ask only when a missing product decision
would materially change scope. Existing authorization covers routine in-scope
work; this skill does not authorize new scope, remote actions or deployments.

Consult [change evaluation lessons](../../../docs/internal/design/change-evaluation.md)
when interpreting performance evidence or a helper with no established consumer.
Revisit the recommendation when evidence changes and before production closeout.
A useful negative result may complete an experiment; it does not complete a
promised production feature. Preserve the evidence and report that distinction.
