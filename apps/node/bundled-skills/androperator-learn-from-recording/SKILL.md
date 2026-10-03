---
name: androperator-learn-from-recording
description: Inspect Android demonstration evidence and, when requested, author adaptive agent instructions.
---

# Learn from a demonstration

Explain what a demonstration establishes about the app workflow and what remains
unknown. When reusable authoring is requested, save host-native instructions and
verify the authorized outcomes; label untested behavior explicitly. Use recording
when the user requests it or a demonstration supplies specific missing app
knowledge; direct exploration is the normal route otherwise.

If a usable recording is already available, begin with export and inspection.
Capture a new demonstration only when it supplies missing evidence.

1. Select an explicit device and matching Operator; use orientation guidance if
   readiness is unknown. Establish the demonstrated goal and missing evidence.
2. Run `recording start`, let the human demonstrate, then `recording stop` and
   `recording pull`. Pass the selected device and Operator to device commands.
   Preserve raw NDJSON privately; do not delete recordings.
3. Run `recording export --input <local_ndjson> --out <export_json>` and read the
   generated file. The command response is a summary, not the event evidence.
   Use `--snapshots include` when XML evidence is useful.
4. Identify likely screens, inputs, candidate selectors, branches and outcome
   evidence. Recorded taps, coordinates and elapsed delays do not prove current
   state and are not an executable replay plan.
5. When authoring is requested, save instructions in the host's ordinary format:
   goal, inputs, likely route, observations, supported recovery and independent
   terminal verification.
6. For requested authoring, follow the saved instructions using the current agent's
   control loop and live Androperator actions. Verify each requested result.
   Exercise a bounded unexpected state
   within the authorized scope or report the blocker and untested recovery.

Optional helpers can parse and retain evidence; no runtime scaffolding or replay
package is required. Preserve failures and command/task correlation. A single
demonstration or successful process exit does not establish broad reliability.
Do not perform device mutations beyond the user's goal merely to test a skill.

Use [recording](https://docs.androperator.com/api/recording/) for capture/export
contracts and [authoring](https://docs.androperator.com/skills/authoring/) for
instruction conventions.
