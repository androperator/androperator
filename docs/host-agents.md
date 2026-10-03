# Host Agent Orientation

Androperator is the deterministic hand for the current agent's brain. The agent
owns planning, app strategy and verification; CLI, HTTP and MCP expose Android
actions and evidence. A one-off goal does not require a reusable skill.

## Public Setup Skill

The [public setup guidance](https://androperator.com/skill.md) covers installation.
After setup, inspect `androperator bundled-skills list` for installed host
instructions. Start with `androperator-agent-orientation` on an unfamiliar host;
use `androperator-upgrade` for a whole-product refresh.

## Select the CLI and target

Use `androperator devices`, choose an explicit target and run doctor with the
matching Operator. In a development checkout, build `apps/node` and invoke
`node apps/node/dist/cli/index.js` with
`--operator-package com.androperator.operator.dev`. See [setup](setup.md).

## Adaptive execution and goal coverage

Define the requested outcome and budgets. Observe current state, choose one
justified action, execute and verify its effect. Retain raw evidence, failures,
and command/task correlation. Report partial or blocked outcomes truthfully.
A successful command or a familiar route alone does not establish goal success.

Use the installed `androperator-agent-control-loop` for adaptive navigation.
Optional [Settings examples](skills/examples.md) illustrate independent value
verification and bounded helpers. Follow instructions in the current agent;
there is no Androperator runtime registry or child-agent requirement.

## Choose the transport

Use CLI when the caller can launch shell commands on the adb/emulator host.
Use stdio MCP when the client supports local MCP processes. Use
[HTTP](api/serve.md#choose-the-transport) to reach a separate device host where
the caller cannot launch CLI processes. See the Serve page for access control,
completion, SSE scope and artifact locality. The same execution contracts apply.
Optional shell helpers require suitable host execution support.

## Author when useful

Explore the authorized workflow directly. Save reusable instructions when
requested or worthwhile, using `androperator-skill-author-by-agent-discovery`
for bounded exploration. Use `androperator-skill-author-by-recording` only when
a demonstration adds missing evidence. Human recording is optional.
Read [authoring](skills/authoring.md).

## Durable Post-Install Files

Install writes `~/.androperator/install-state.json`, `mcp-config-snippet.json`
and `AGENTS.md`. When `~/.agents/AGENTS.md` already exists, host setup updates one
bounded bridge to the local guide. Bundled guidance is installed in
`~/.androperator/bundled-skills/` and made discoverable to supported agent hosts.
No runtime registry or child-agent CLI is needed by install or normal doctor.
