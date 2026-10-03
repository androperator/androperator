# Authoring agent instructions

Start from the authorized goal. Explore current app state through Androperator,
choose one bounded action, observe its effect and verify the requested result.
Save reusable instructions when requested or when the route is worth retaining.
There is no required package format or runtime registration step.

Describe the goal, inputs, likely route, observations that justify each action,
supported deviations, recovery limits and independent outcome verification.
Keep app strategy in the instructions. An optional ordinary helper can parse
an observation, retain correlated evidence or perform a short bounded operation.
The current agent remains responsible for choosing the next action.

## Optional demonstrations

Use a human demonstration when it supplies missing app knowledge or resolves a
real blocker. Capture with `recording start`, `stop` and `pull`, then read a
`recording export` artifact directly. Preserve the raw NDJSON privately.
Snapshots can be included with `--snapshots include`; parsed steps are lossy
inspection aids. A recorded tap, coordinate or delay does not prove current state.

Convert evidence into adaptive instructions, not replay: identify expected
screens, selectors, supported alternatives and the requested terminal values.
Compare observed outcomes using the workflow's own evidence; Androperator does
not define a generic skill-result or recording-comparison format.

## Prove the workflow

Follow the instructions on an explicit device with the matching Operator.
Retain current observations, action results and command/task correlation.
Verify each requested field independently and test a bounded unexpected state.
Report partial or blocked outcomes with the last useful evidence and remaining
unknowns. One successful run does not establish general device reliability.

See [examples](examples.md), [development](development.md) and
[the control loop](../host-agents.md).
