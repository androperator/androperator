---
name: androperator-agent-orientation
description: Select and verify an Androperator CLI, Android device and Operator on an unfamiliar host.
---

# Orient the current agent

Establish a usable execution route for the authorized Android goal. Finish with
an explicit device, matching Operator package and successful readiness check,
or report the concrete blocker and its supported repair route.

1. Locate `androperator` and inspect `--help`. In a checkout, build and use
   `apps/node/dist/cli/index.js` rather than a potentially older global install.
2. Run `devices`, select an explicit target, and use the matching Operator:
   `com.androperator.operator.dev` for local development or
   `com.androperator.operator` for release validation.
3. Run `doctor --device <device_serial> --operator-package <operator_package>`.
   Resolve readiness failures within the authorized scope before device actions.
   A successful check for another device or package does not establish readiness.
4. Choose CLI, HTTP or MCP according to the host's capabilities. Keep device and
   package selection explicit through subsequent calls.
5. For the Android goal, follow `androperator-agent-control-loop`: observe, choose
   a bounded action, execute, observe again and independently verify the result.

`bundled-skills list` shows installed host guidance. Use `androperator-upgrade`
only for an explicitly requested whole-product refresh. One-off tasks need no
saved skill; route explicit authoring requests to discovery or recording guidance.

The current command, environment prefix and local state are `androperator`,
`ANDROPERATOR_*` and `~/.androperator/`. An old `clawperator` binary or Operator
is not proof that the renamed installation is ready. Use
[host integration](https://docs.androperator.com/host-agents/) for transport setup
and command help for exact flags.
