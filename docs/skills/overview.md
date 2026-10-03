# Agent-followed skills

A skill is reusable guidance followed by the current host agent. The agent owns
planning, app-specific navigation, supported recovery and outcome verification.
Androperator executes validated Android actions and returns structured evidence.

Installation provides [bundled host guidance](../host-agents.md). It does not
create a runtime registry or install app automation packages. Instructions need
no manifest, required entrypoint, child-agent launcher or Androperator runner.
Hosts choose how to store and discover their own instructions.

Use the [Settings examples](examples.md) as optional starting points. Ordinary
helpers can parse evidence or perform a short operation on verified state. They
must retain failures and avoid treating process success as proof of the goal.
A one-off task can use direct CLI, HTTP or MCP actions without creating a skill.

Read [authoring](authoring.md), [development](development.md),
[device preparation](runtime.md) and [recording evidence](../api/recording.md).
