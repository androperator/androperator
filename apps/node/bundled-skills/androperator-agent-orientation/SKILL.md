---
name: androperator-agent-orientation
description: First-run orientation for Android automation with Androperator. Use when Androperator is installed but the agent is unfamiliar with selecting the CLI, Android device, and Operator package, checking readiness, or choosing between runtime skills, discovery, recording, MCP, and direct actions.
---

# Androperator Agent Orientation

Orient an unfamiliar agent on an installed Androperator host. Finish with a
verified CLI/device/Operator selection and one appropriate next step, or report
the specific blocker and its recovery reference. Keep device readiness separate
from any host-agent requirements of the chosen route.

This skill owns initial selection and routing. Detailed contracts belong in the
canonical docs; discovery and recording belong in their dedicated skills. Do not
expand orientation into unbounded discovery or authoring.

When documentation is needed, use `https://docs.androperator.com/llms.txt` to find
the relevant page or `https://docs.androperator.com/llms-full.txt` for compiled
content instead of parsing HTML. `https://docs.androperator.com/host-agents/` is
the canonical routing reference.

## Workflow

### 1. Select the CLI, device, and Operator before checking readiness

Respect an explicitly requested CLI. For installed-release use, keep the installed
`androperator`; a newer checkout does not make it broken. For development, build
with `npm --prefix apps/node run build` and use
`node apps/node/dist/cli/index.js` from the repository root. In all examples below,
replace `androperator` with that selected invocation. Inspect its `--version`,
`--help`, and relevant command help; do not assume checkout-only features exist
in an installed release.

First run `androperator devices`. Resolve the intended target from the request:

- No reachable target: stop device work and report missing, unauthorized, or
  offline devices using `https://docs.androperator.com/setup/`.
- One reachable device: use it only if it matches the intended target.
- Multiple devices: use the requested serial or ask which target is intended;
  never silently pick the first device or substitute another for an unavailable one.

Carry `--device <device_serial>` even with one device. Inspect installed variants
before proposing installation:

```bash
adb -s <device_serial> shell pm list packages com.androperator.operator
androperator version --check-compat --device <device_serial> --operator-package <operator_package> --output json
```

Use exact package names from the listing: release `com.androperator.operator`,
development default `com.androperator.operator.dev`. Check each relevant installed
candidate with the selected CLI. An incompatible debug package does not invalidate
a compatible release package. Respect an explicitly required variant; do not
silently switch it. Select a compatible variant appropriate to the task, then run:

```bash
androperator doctor --device <device_serial> --operator-package <operator_package> --output json
```

Continue device work only with exit code `0` and `criticalOk: true`. Inspect failed
checks and skipped prerequisites before choosing targeted setup or recovery;
upgrades, reinstalls, `doctor --fix`, and `--full` are not default remedies.
Doctor can run device probes and attempt waking; it is not just host inspection.
Keep the selected device/package on later device commands and in runtime-skill
or MCP configuration. See `https://docs.androperator.com/host-agents/` for selection
details. Use `androperator-upgrade` when a whole-product upgrade is actually wanted.

Check host-agent readiness separately when the chosen route needs it. A missing
Codex executable or unsupported model is a host-agent issue, not evidence of a
Androperator transport failure; doctor success does not prove model compatibility.

### 2. Choose one route and run its first probe

`androperator skills ...` discovers installed runtime app workflows;
`androperator bundled-skills ...` discovers host-agent helpers. Use the row that
matches the task:

| Situation | First probe and next route | Canonical reference |
| --- | --- | --- |
| App workflow with a known package id | `androperator skills for-app <package_id>` | `https://docs.androperator.com/host-agents/` |
| App workflow described in user-language terms | `androperator skills search --keyword <text>` | `https://docs.androperator.com/host-agents/` |
| Runtime discovery found no relevant match | `androperator bundled-skills list`, then `androperator-skill-author-by-agent-discovery` | `https://docs.androperator.com/host-agents/` |
| Discovery returned `proceed_to_recording`, or a known app route needs proving | `androperator bundled-skills list`, then `androperator-skill-author-by-recording` | `https://docs.androperator.com/skills/authoring/` |
| The host supports stdio MCP and has chosen it as transport | `androperator mcp serve` | `https://docs.androperator.com/api/mcp/` |
| Adaptive navigation or independently verified extraction is needed | `androperator-agent-control-loop` after goal-aware runtime discovery | `https://docs.androperator.com/skills/authoring/` |
| A known direct action or payload is needed | Observe first with `androperator snapshot --device <device_serial> --operator-package <operator_package>` | `https://docs.androperator.com/quickstart/` |

Use `skills list` first only for inventory. Inspect bundled helpers before runtime
skill discovery only when authoring is already the known route. Run the selected
probe rather than surveying every surface. A package match is insufficient: inspect
the skill goal, outputs and verification. A Settings landing-screen skill does not
cover OS version/build extraction. For adaptive one-shot execution or explicit
orchestrated authoring, use [the control loop](../androperator-agent-control-loop/SKILL.md). For authoring, prefer daemon-backed
polling with observable UI readiness conditions over arbitrary fixed sleeps.

### 3. Interpret evidence before claiming success or retrying

The agent observes, decides, and verifies the user outcome; Androperator executes
validated actions and returns structured evidence.

Command completion alone proves neither a complete observation nor the requested
outcome. Check observation completeness and resulting app state before claiming
success. On failure, read `details.phase` (host errors) or
`envelope.failureEvidence.phase` (received execution envelopes): `readiness`,
`dispatch`, `result_wait`, or `post_processing`. Read `dispatchState` separately:
`not_dispatched`, `dispatched`, or `unknown`. Requested `commandId`/`taskId` and
readiness `probeCommandId`/`probeTaskId`/`probeDispatchState` are separate evidence.
`not_dispatched` can still have earlier preflight effects (`earlierEffects`) or
wake attempts; missing evidence does not prove no effects. After an uncertain
mutation, observe state before retrying. Post-processing failure can retain a real
result; it does not prove the action never ran. For recovery detail, use
`https://docs.androperator.com/api/errors/#execution-failure-evidence`.

### 4. Report the next step

Briefly state the selected CLI, device, Operator, and readiness result. Explain
that the agent decides and Androperator executes. Name the chosen route and one
concrete next command or skill, ending with its canonical reference from the
table. If blocked, report the observed failure and the relevant setup or recovery
link instead of claiming readiness. Keep the response concise.
