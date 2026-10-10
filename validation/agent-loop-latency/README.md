# Settings agent-loop latency experiment

Measure the existing Jev Settings helper without changing its navigation,
observation, verification, or retry policy. Requires authorized external Jev use,
`JEV_API_KEY`, an explicitly selected device, and a matching development Operator.
Use one controller on the device. This changes only navigation in Settings; it
does not tap Build number or change system configuration.

Build the branch-local CLI and verify readiness first:

```sh
npm --prefix apps/node run build
node apps/node/dist/cli/index.js devices
node apps/node/dist/cli/index.js doctor --device <device_serial> --operator-package com.androperator.operator.dev
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/path/to/new-trial
```

The output parent must exist; the trial directory must not. Each invocation runs
one trial and refuses to resume or overwrite a previous trial. It closes Settings
outside the task timer, then runs the existing `open`, `jev`, and `finish` helpers.
The task timer includes helper process startup, initial observation, delegation,
terminal verification, and evidence writes. Jev keeps its eight-action/30-second
delegation budget and its existing HTTP retry policy. An escalation stops the
trial; do not drop failed trials or restart their budgets. Reset failures are
retained with no task duration. Successful completion exits zero; other outcomes
exit one. Inspect raw evidence before deciding any recovery.

Keep raw artifacts private. The output includes hierarchies, screenshots,
extracted values, local identifiers, provider requests/responses, and CLI logs.
`summary.json` uses an explicit field allowlist to omit those contents. API keys
are supplied only through the environment and are not written by this harness.
Never commit raw trial directories. Prefer an ignored repository `tmp/` directory
with restrictive permissions for local retention.

## Measurements

- `taskMs`: complete task wall time, excluding the reset and final summary export.
- `operations`: parent-observed reset/open/Jev/finish durations. These include
  output persistence; the reset is outside `taskMs`.
- `cli`: sum and distribution of existing command-ledger timings. Each sample
  includes fresh CLI startup, readiness, dispatch, device execution, result
  delivery, and process exit. It is not pure device or wire latency.
- `commands`: the same ledger durations grouped by operation.
- `provider.requests`: existing Jev attempt durations through response parsing
  (before successful-choice validation). Includes failed attempts; excludes retry backoff and
  request-log persistence. Cold connection and inference time are not separated.
- `spans`: opt-in helper operation, observation, and command durations. Parent
  and child spans overlap. Do not sum them together or add them to `cli`.
- `otherMs`: task time less CLI ledger time and provider attempt time. It includes
  outer helper startup, local processing, evidence writes, retry backoff, and
  instrumentation overhead. It is not exclusively process startup.
- `failedCommands`, failed provider attempts, navigation counts, and terminal
  evidence presence accompany timing. Timing span `returned` means a function
  returned normally; a returned escalation is still a failed benchmark trial.

Enable the same local spans when manually invoking helpers with
`VERSION_TIMING=1`. The default helper behavior has timing disabled.
`timings.ndjson` contains only fixed span names, timestamps, durations, and return
status. Durations use a host monotonic clock. Synchronous trace-file writes occur
after each measured span and contribute to enclosing spans/task time.

This is a bounded, task-specific candidate-selection benchmark. The helper
already knows supported About/Software routes; it is not proof of general
unfamiliar-app navigation or human parity. Keep debug/release build, device,
starting state, policy, and cold/warm conditions explicit in reports. A human
baseline and an OpenAI Decisions adapter are separate follow-up experiments.

Offline checks (no device or provider calls):

```sh
node --test validation/agent-loop-latency/benchmark.test.cjs examples/skills/tests/*.test.js
```
