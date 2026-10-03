---
name: androperator-agent-orientation
description: Orient an unfamiliar host for Android execution with Androperator.
---

# Orient the current agent

1. Locate the CLI and inspect `--help`; in a checkout build and use the branch-local CLI.
2. Run `devices`, select an explicit target and matching Operator package.
3. Run doctor for that pair. Resolve readiness failures before acting.
4. Define the authorized goal and evidence needed for each requested result.
5. Choose CLI, HTTP or MCP according to the current host's capabilities.
6. Follow `androperator-agent-control-loop`: observe, choose one action, execute,
   observe again and independently verify. Report blocked or partial outcomes.

Inspect `bundled-skills list` for installed host guidance. Use the upgrade skill
for a whole-product refresh. Save reusable instructions only when requested or
worthwhile; one-off tasks need no authoring step. Ordinary helpers are optional.
Read https://docs.androperator.com/host-agents/ and the command help for exact flags.
