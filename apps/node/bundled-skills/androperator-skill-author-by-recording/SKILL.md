---
name: androperator-skill-author-by-recording
description: Author adaptive Android instructions from an explicitly requested or evidence-needed human demonstration.
---

# Learn from a demonstration

Turn a demonstration into host-native instructions grounded in current evidence.
Finish with saved instructions, independently verified outcomes and explicit
untested limits. Use recording when the user requests it or a demonstration
supplies specific missing app knowledge; discovery is the normal route otherwise.

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
5. Save instructions in the host's ordinary format: goal, inputs, likely route,
   observations, supported recovery and independent terminal verification.
6. Follow them using the current agent's control loop and live Androperator
   actions. Verify each requested result. Exercise a bounded unexpected state
   within the authorized scope or report the blocker and untested recovery.

Optional helpers can parse and retain evidence; no runtime scaffolding or replay
package is required. Preserve failures and command/task correlation. A single
demonstration or successful process exit does not establish broad reliability.
Do not perform device mutations beyond the user's goal merely to test a skill.

Use [recording](https://docs.androperator.com/api/recording/) for capture/export
contracts and [authoring](https://docs.androperator.com/skills/authoring/) for
instruction conventions.
