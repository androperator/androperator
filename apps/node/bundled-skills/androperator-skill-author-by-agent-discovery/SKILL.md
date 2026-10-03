---
name: androperator-skill-author-by-agent-discovery
description: Author reusable Android instructions by exploring an authorized workflow with Androperator.
---

# Author instructions from live discovery

Deliver host-native instructions grounded in observed app behavior, with verified
outcomes and explicit limits. Use this skill when reusable authoring is requested;
for a one-off Android goal, use `androperator-agent-control-loop` directly.

Use `androperator-agent-orientation` when readiness is unknown. The current agent
follows the control loop on an explicit device and matching Operator, with bounded observation,
action, recovery and elapsed-time budgets. Let current evidence determine the
next action; app-specific routes belong in instructions, not in the runtime.

Save the goal, inputs, likely route, observations that justify actions, supported
deviations, recovery limits and independent outcome verification in the host's
normal skill format. Optional ordinary helpers can parse or retain evidence.
No manifest, registry, required entrypoint, new result format or child-agent
launcher is needed.

If missing app knowledge blocks progress, ask a specific question. Use
`androperator-skill-author-by-recording` when an optional demonstration would
supply that evidence. A demonstration is never required merely because a route
is unfamiliar.

Follow the authored instructions on the selected device and verify the requested
outcomes. Exercise a bounded unexpected state within the authorized scope, or
report which recovery behavior remains untested. Preserve failures alongside
successful recovery. Finish with the saved location, observed proof and remaining
limits; do not label blocked or untested instructions as proven.

Consult [authoring](https://docs.androperator.com/skills/authoring/) for writing
conventions and [examples](https://docs.androperator.com/skills/examples/) when
an example would help structure instructions or an optional helper.
