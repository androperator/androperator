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
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/path/to/new-persistent-trial --backend persistent
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

`--backend cli` is the default and preserves fresh CLI processes. The experimental
`persistent` backend runs the same helper operations in one controller process,
using one worker thread to call the CLI's existing Node command handlers directly.
The worker retains Node module state and the existing readiness cache throughout
one task. A new controller/worker is created for each trial; their cold startup
and shutdown are included in task time. Reset uses a separate fresh CLI process
for both backends, so it does not pre-warm the persistent worker's cache.

Both backends preserve exact command arguments, snapshot presentation, logging,
no-daemon execution, candidate policy, provider settings, and completion checks.
The worker bridge keeps the helper's synchronous control flow; the original
20-second/remaining-run-budget outer command deadline still applies. On a deadline
the worker is terminated and cannot receive another command. The Android action
may have run; termination is not rollback and never triggers replay. Raw worker
errors are retained locally. This experiment changes no device transport.

For comparisons, use one warmup per backend followed by alternating paired order
(`cli,persistent` then `persistent,cli`). Retain failed attempts and compare command
and action sequences as well as time. Do not interpret fewer observations or a
different route as a pure process-lifetime improvement.

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
- `commandCalls`: sum and distribution of existing command-ledger timings.
  CLI samples include child startup/exit; persistent samples include worker
  communication and in-process command-handler execution. Both include readiness,
  dispatch, device work and result delivery. This field replaces `cli` from
  summary schema version 1; current summaries use version 2 and include `backend`.
- `commands`: the same ledger durations grouped by operation.
- `provider.requests`: existing Jev attempt durations through response parsing
  (before successful-choice validation). Includes failed attempts; excludes retry backoff and
  request-log persistence. Cold connection and inference time are not separated.
- `spans`: opt-in helper operation, observation, and command durations. Parent
  and child spans overlap. Do not sum them together or add them to `commandCalls`.
  Persistent `operations.controller` also overlaps its open/Jev/finish phases.
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
