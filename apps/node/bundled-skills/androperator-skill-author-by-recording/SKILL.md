---
name: androperator-skill-author-by-recording
description: Use an optional human demonstration as evidence for adaptive Android instructions.
---

# Learn from an optional demonstration

Use only when a demonstration supplies missing app knowledge or helps diagnose
a concrete blocker, or the user explicitly requests recording-based authoring.
The normal route is current-agent exploration of the authorized workflow.

1. Select an explicit device and matching Operator; check readiness. Explain the
   missing evidence and agree on the demonstrated goal.
2. Capture with `recording start`, let the human demonstrate, then `recording stop`
   and `recording pull`. Preserve raw NDJSON privately; do not delete recordings.
3. Read `recording export` directly. Use `--snapshots include` when useful.
   `recording parse` provides lossy inspection, not a complete baseline.
4. Identify likely screens, inputs, candidate selectors, branches and outcome
   evidence. A tap, coordinate or elapsed delay is not proof of current state.
5. Draft instructions in the host's ordinary format: goal, likely route, inputs,
   observations, supported recovery and independent terminal verification.
6. Follow them using the current agent and live Androperator actions. Verify each
   requested result and test a bounded unexpected state or report a truthful block.

Optional helpers can parse and retain evidence; no runtime scaffolding or replay
package is required. Preserve failures and correlation. Never infer broad live
reliability from one demonstration or a successful process exit.
Read https://docs.androperator.com/api/recording/ and
https://docs.androperator.com/skills/authoring/.
