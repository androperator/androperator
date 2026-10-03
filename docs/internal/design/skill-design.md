# Agent-followed instruction design

Keep planning and app-specific strategy with the current agent. Instructions
should state the goal, inputs, observations, likely route, supported recovery
and outcome verification. Optional helpers retain evidence and perform bounded
operations on verified state; they do not establish a core-owned replay program.

See [authoring](../../skills/authoring.md) and
[examples](../../../examples/skills/README.md). The runtime package framework
was removed directly; no compatibility period or replacement runner is required.
