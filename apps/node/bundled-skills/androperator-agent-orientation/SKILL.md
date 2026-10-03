---
name: androperator-agent-orientation
description: Learn what Androperator can do, how its Android automation API works, and how to use it for a task when you have no prior context.
---

# Androperator Agent Orientation

Build enough context to decide whether Androperator fits the user's goal, choose
an interface, and use its Android actions and evidence correctly. For an
execution request, establish readiness and continue into the task. For an
introduction or evaluation, explain the capabilities and next steps without
requiring a connected device or changing its state.

## What the tool provides

Androperator lets an agent inspect and control Android apps on a physical device
or emulator. Use it for tasks such as navigating an app, extracting visible
information, changing a setting, or testing a workflow with evidence of the
result. Its Node API/CLI is the canonical agent-facing interface; HTTP and MCP
expose execution and observation capabilities for other host environments.

The agent supplies the goal, planning, app-specific strategy and verification.
Androperator validates explicit actions, executes them and returns structured
evidence. Deterministic execution does not make an app workflow a reliable
replay: screens and state change, so choose subsequent actions from fresh
observations. No provider credential, saved skill or child agent is needed for
ordinary execution. A successful action does not by itself prove the user's
goal was achieved.

## Find the relevant API

Inspect `androperator --help`, then the help for commands relevant to the task.
The CLI returns JSON by default. Start with the
[API overview](https://docs.androperator.com/api/overview/) for execution inputs,
result envelopes and success/error semantics. Use the
[documentation index](https://docs.androperator.com/llms.txt) to find additional
capabilities rather than assuming every transport has identical coverage.
In a checkout, prefer the local docs and build and invoke
`node apps/node/dist/cli/index.js` rather than an older global install.

| Need | Starting points |
| --- | --- |
| Inspect the current screen | `snapshot` for the UI hierarchy; `screenshot` for visual evidence |
| Identify or extract UI content | `read`, `read-value`, and the [selector contract](https://docs.androperator.com/api/selectors/) |
| Interact with an app | `open`, `click`, `type`, `press`, `back`, `scroll`, `wait`; inspect command help for parameters |
| Submit explicit action sequences | `exec` with a validated JSON payload; [actions](https://docs.androperator.com/api/actions/) defines action types and parameters |
| Retain evidence | `evidence capture` or `evidence video`; `recording` captures human demonstrations for later inspection |
| Find or prepare a target | `devices`, `emulator`, `doctor`; use [setup](https://docs.androperator.com/setup/) when installation is needed |

CLI command names and JSON action types are distinct contracts: for example,
`open` is a CLI command and `open_app` is an execution action. Parse the relevant
response schema, retain `commandId`/`taskId` correlation where provided, and
inspect failures and step results rather than treating process exit alone as
proof of an app outcome. The API overview explains the Node wrapper around the
`[Androperator-Result]` execution envelope.

Choose CLI when the agent can run shell commands on the device host, stdio MCP
when its host supports local MCP tools, or HTTP when reaching a separate device
host. Read [host integration](https://docs.androperator.com/host-agents/) for
transport setup and HTTP access, completion and artifact-location constraints.

## Start an authorized task

Select an explicit target with `devices`. Before interactive automation, run
`doctor --device <device_serial>` and resolve readiness failures within the
authorized scope. Require exit code `0`, `criticalOk == true`, and
`readiness.device.interactive.status == "pass"` for that target.

The Android companion app is called the Operator. It carries out device-side
actions; agents normally work through the Node API rather than its internals.
The default package is `com.androperator.operator`. For a local debug build, add
`--operator-package com.androperator.operator.dev` to doctor and subsequent
commands. Keep the same device and package selection throughout execution.
If installation is missing, follow setup; report concrete blockers rather than
assuming an old `clawperator` installation establishes Androperator readiness.

Continue with `androperator-agent-control-loop` for adaptive execution: observe,
choose a bounded action, execute, observe again and independently verify the
requested result. If the user only asked for orientation, finish with the tool's
fit for their goal, the relevant API entry points and any prerequisites still
unverified; do not claim readiness without checking it.

`bundled-skills list` lists installed agent instructions. One-off tasks need no
saved skill. Use `androperator-skill-author-by-agent-discovery` for requested
reusable instructions, `androperator-learn-from-recording` when a demonstration
adds missing knowledge, and `androperator-upgrade` for an explicitly requested
whole-product refresh.
