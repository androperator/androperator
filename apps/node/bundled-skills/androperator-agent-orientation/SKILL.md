---
name: androperator-agent-orientation
description: Select an Androperator interface, Android target and readiness check on an unfamiliar host, or explain its fit for a task.
---

# Androperator Agent Orientation

Androperator inspects and controls Android apps on physical devices and emulators.
Its Android companion app, the Operator, performs device-side actions. Agents
normally use the canonical Node API/CLI, or the documented HTTP/MCP surfaces.

For an execution request, select and verify the CLI, device and Operator, then
continue into the task. For an introduction or evaluation, explain capabilities
and prerequisites without requiring a device or changing its state.

Androperator validates explicit Android actions and returns structured evidence.
The agent owns planning, app strategy and outcome verification. A successful
action does not prove the user's goal; choose subsequent actions from fresh
observations. One-off execution needs no saved skill, provider or child agent.

## Choose an interface

Use the Node CLI on the device host, stdio MCP for a local MCP consumer, or HTTP
for a separate device host. For transport coverage, completion and remote artifact
access, load [host integration](https://docs.androperator.com/host-agents/).
In a checkout, build `apps/node` and invoke `node apps/node/dist/cli/index.js`;
prefer local `docs/` for unreleased behavior over a global install or live docs.

## Find the relevant API

Load only the reference needed. Use command-specific `--help` for arguments;
use top-level `--help` or the [index](https://docs.androperator.com/llms.txt) when
the command is unknown. The [full corpus](https://docs.androperator.com/llms-full.txt)
is optional offline/broad context, not a prerequisite.

| Need | Starting points |
| --- | --- |
| Discover screen content | `snapshot --compact`; `query` for matching nodes/state; [snapshot](https://docs.androperator.com/api/snapshot/) |
| Extract exact UI text | `read`, `read-value`; [selectors](https://docs.androperator.com/api/selectors/) |
| Inspect visual evidence | `screenshot`; [capture sizes and coordinates](https://docs.androperator.com/api/actions/#action-take-screenshot) |
| Interact with an app | `open`, `click`, `type`, `press`, `back`, `scroll`, `wait`; command help |
| Batch actions or interpret envelopes | `exec`; [API overview](https://docs.androperator.com/api/overview/) and [actions](https://docs.androperator.com/api/actions/) |
| Read notifications | `notifications list`; [notification results and mutations](https://docs.androperator.com/api/notifications/) |
| Inspect or control media sessions | `media`; [session selection, controls and playback evidence](https://docs.androperator.com/api/media/) |
| Retain still evidence | `evidence capture` retains a screenshot, hierarchy and component results; [evidence contract](https://docs.androperator.com/api/evidence/) |
| Capture screen video | `evidence video` captures managed video evidence; [video lifecycle and verification](https://docs.androperator.com/api/evidence/#managed-video) |
| Inspect a human demonstration | `recording` captures accessibility events as NDJSON for export and analysis; [recording contract](https://docs.androperator.com/api/recording/). This is not MP4 video or executable replay. |
| Install or prepare a target | `devices`, `emulator`, `doctor`; [setup](https://docs.androperator.com/setup/) |

CLI names and JSON action types differ: `open` invokes `open_app`. One-shot CLI
commands normally return JSON; logs stream NDJSON, while MCP and HTTP have their
own framing. Inspect errors and step results, retaining `commandId`/`taskId` and
`[Androperator-Result]` correlation. See the API overview when parsing a result.

## Select the target and readiness mode

Use `devices` and keep the selected device and Operator explicit throughout.
Published installs use `com.androperator.operator`; local debug work uses
`--operator-package com.androperator.operator.dev` on doctor and subsequent calls.

- Interactive UI: run `doctor --device <device_serial>` with the selected package.
  Require exit `0`, `criticalOk: true` and the `readiness.device.interactive` check
  to pass. Ordinary UI preparation may wake the device or send Home.
- Background-only notification reads and media reads/controls: run
  `doctor --device <device_serial> --capability background-observation` with the
  selected package. Require exit `0`, `criticalOk: true` and
  `readiness.background.observation` pass. Do not add an interactive probe.
  See [background readiness](https://docs.androperator.com/api/doctor/#background-observation-readiness)
  for service prerequisites. Adding a UI action, notification dismissal or
  notification button changes the whole execution to interactive readiness.
- Still evidence capture: use its separate [non-waking preparation and partial-result contract](https://docs.androperator.com/api/evidence/).
  Background doctor success does not prove screenshot or hierarchy availability.

Use setup for missing installation and doctor-provided fixes for authorized
repairs. An old `clawperator` install does not establish Androperator readiness.
Continue adaptive UI work with `androperator-agent-control-loop`; a background
read needs only its command, result interpretation and task-specific verification.
For orientation-only requests, report fit, relevant entry points and unverified
prerequisites without claiming readiness.

## Interpret background results

Before interpreting notification or media results, read the corresponding result
contract linked above. The canonical step's `data.payload` is JSON encoded inside
a string. Check list and text truncation before treating an observation as complete.
Discover media sessions before targeting one; an app package selects a session
only when it identifies exactly one active session.

Distinguish `dispatched` from observed control confirmation: inspect
`targetStateObserved` for play/pause, `targetPositionObserved` for seek, and
`removalObserved` for notification dismissal. A notification button's dispatch
does not establish its application side effect. Player reports and extrapolated
position estimates are different evidence; neither alone proves actual playback.
Choose task-specific verification. After uncertain control effects, inspect fresh
state before repeating the command; use the control loop's
[failure and recovery guidance](../androperator-agent-control-loop/references/recovery.md)
to retain failures and possible side effects.

## Continue with another workflow

`bundled-skills list` lists installed instructions. Use
`androperator-skill-author-by-agent-discovery` for requested reusable authoring,
`androperator-learn-from-recording` for demonstration evidence, and
`androperator-upgrade` for an explicitly requested whole-product refresh.
