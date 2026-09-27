# Direct result transport prototype

This opt-in prototype carries canonical execution results over a per-command
ADB-forwarded local socket. Command dispatch and readiness probes retain their
existing broadcast and logcat paths. Ordinary CLI, MCP, and daemon calls still
use logcat. Screenshot file acquisition is unchanged.

The Node `runExecution` option `resultTransport: "direct"` selects the prototype;
`"logcat"` or omission selects the existing transport. Other values fail
validation. Use the matching branch-local APK. This is an experimental Node
option, not a new public CLI flag or a default transport migration.

`resultTransport` belongs in the second `runExecution(execution, options)`
argument. It is not an execution payload field or the payload
`mode: "direct"` marker. There is no `--result-transport` CLI flag, MCP tool
argument, Serve request setting, or environment variable that enables it.
The repository probe below is the simplest supported way to evaluate it.

## Run and compare

Build Node and Android, install the debug APK on each explicit target, and ensure
its accessibility service is running. Use a non-sensitive test screen such as
Settings. The probe observes the current screen; `--sleep-ms` optionally adds a
bounded delay before the snapshot.

```bash
adb devices -l
npm --prefix apps/node ci
npm --prefix apps/node run build
./gradlew :app:assembleDebug
node apps/node/dist/cli/index.js operator setup \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk \
  --device <device_serial> --operator-package com.clawperator.operator.dev
node validation/direct-result-transport/probe.mjs \
  --device <device_serial> --transport logcat --iterations 5
node validation/direct-result-transport/probe.mjs \
  --device <device_serial> --transport direct --iterations 5
```

Run these commands from the repository root and replace `<device_serial>` with
an online target from `adb devices -l`. Repeat APK setup for each selected device.
The `--transport` flag above belongs to the repository probe only.

| Probe argument | Requirement/default |
| --- | --- |
| `--device` | Required explicit device serial |
| `--transport` | `direct` (default) or `logcat` |
| `--operator-package` | Defaults to `com.clawperator.operator.dev`; must match the installed prototype APK |
| `--iterations` | Integer from 1 to 20; defaults to 3 |
| `--sleep-ms` | Integer from 0 to 10000 before each snapshot; defaults to 0 |

The probe prints JSON lines with success, snapshot byte count, total execution
time and direct-transport timing events. It checks for a successful snapshot
with a complete hierarchy. It does not print hierarchy contents. Keep timing
samples local or sanitize device identifiers before committing evidence.
Exit code 0 means every requested sample passed; the probe stops at the first
failed sample with exit code 1. An invalid invocation can fail before any sample
JSON is written. `transportTimings` is empty for logcat and can also be empty if
a direct attempt fails during earlier readiness checks. Empty measurements are
not zero-duration measurements.

To represent independent agents, launch the probe in separate host processes,
with a different `--device` in each. Compare similarly sized hierarchies on the
same screen; do not attribute readiness, UI traversal, or XML construction time
to network transfer. Cold setup and warm execution should be reported separately.

The manually dispatched `direct-result-transport.yml` workflow builds and runs
protocol tests plus the probe on API 35 and 36. Those separate CI jobs do not
prove two devices on one host. That acceptance check requires concurrent local
processes and devices.

## Call from branch-local Node code

After building, run this from the repository root. The imports are checkout
paths, not a promised stable package-level SDK entrypoint. The logger writes
structured events to the chosen local directory; `runExecution` does not create
a logger automatically.

```bash
DEVICE_SERIAL='<device_serial>' node --input-type=module <<'JS'
import { randomUUID } from 'node:crypto';
import { runExecution } from './apps/node/dist/domain/executions/runExecution.js';
import { createClawperatorLogger } from './apps/node/dist/adapters/logger.js';

const result = await runExecution({
  commandId: `direct-example-${randomUUID()}`,
  taskId: 'direct-result-example',
  source: 'debug',
  expectedFormat: 'android-ui-automator',
  timeoutMs: 30000,
  actions: [{ id: 'snapshot', type: 'snapshot' }],
}, {
  deviceId: process.env.DEVICE_SERIAL,
  operatorPackage: 'com.clawperator.operator.dev',
  resultTransport: 'direct',
  logger: createClawperatorLogger({ logDir: './artifacts/direct-result-example' }),
});

const snapshot = result.ok
  ? result.envelope.stepResults.find(step => step.id === 'snapshot')
  : undefined;
const passed = result.ok && result.envelope.status === 'success'
  && snapshot?.success === true && typeof snapshot.data.text === 'string';
console.log(JSON.stringify({
  passed,
  ...(result.ok
    ? { status: result.envelope.status, stepError: snapshot?.data.error }
    : { error: result.error }),
}));
process.exitCode = passed ? 0 : 1;
JS
```

`result.ok: true` means Node obtained an envelope, including an envelope that
reports failed actions. Check `envelope.status` and the relevant step's `success`
for action success. A timing event with `outcome: "received"` proves verified
transport receipt, not action success or a UI postcondition.

## Connection and isolation

1. Node resolves the explicit device, performs existing readiness checks, and
   creates a random session identifier. A privileged prepare broadcast creates
   an Android abstract local socket named for the Operator package and session.
2. `adb -s <device_serial> forward tcp:0 localabstract:<session_socket>` allocates
   an independent host port. Node connects through localhost and verifies
   protocol version 1, Operator package, session, command and task identity.
3. A ping/pong exchange establishes readiness. Node dispatches the existing
   command broadcast once, with the session in an additional intent extra.
   Android claims that session once before executing any command effect.
4. Android sends result metadata and the unchanged `[Clawperator-Result]` line.
   Node verifies length, SHA-256, the canonical envelope and both identifiers.
   It acknowledges only after successful verification. Android then sends its
   timing confirmation.
5. Node closes its socket and removes only the forward it allocated. Android
   closes the session after completion or its bounded expiry.

Each command has its own connection, forward and result destination, even when
clients reuse command IDs. Different devices run independently. Same-Operator
commands retain the existing execution mutex and queue-inclusive command timeout.
The Node in-process execution guard also remains. There is no cross-process
exclusive device lease, and separate release/dev Operators on the same device
are not coordinated by this prototype.

Controls use a four-byte big-endian length followed by UTF-8 JSON, limited to
4096 bytes. The canonical result is a separate frame limited to 32 MiB. Android
permits at most 16 live sessions per Operator process. A watchdog expires each
session within 150 seconds; connected control reads have a five-second timeout.
Canceled watchdog tasks are removed so they do not retain completed results.

The manifest prepare receiver requires Android's DUMP permission. The local
socket additionally accepts only shell/root peer UIDs. Host agents are trusted
ADB clients: this does not isolate mutually untrusted users sharing ADB access.
No Android network listener, device-IP discovery, or shared fixed host port is
introduced. ADB server selection uses the existing runner environment; Node
connects to the forwarded host port locally, so remote ADB-server forwarding is
outside this prototype.

## Timing meanings

`transport.direct.timing` is emitted through the structured logger. Its JSON
message contains only timing/status metadata; the event carries command, task
and device correlation. In a logger event, parse `JSON.parse(event.message)`
after checking `event.event === "transport.direct.timing"`. These measurements
are not added to `envelope.diagnostics`; the repository probe collects them into
its own `transportTimings` array. A caller that supplies no logger receives no
timing events. Durations are milliseconds measured with local monotonic
clocks (`performance.now` on Node, `System.nanoTime` on Android).

| Field | Measured interval |
| --- | --- |
| `connectionSetupMs` | Node prepare, forward, connect, identity check and ping/pong |
| `handshakeRoundTripMs` | Node ping write through receipt of pong; includes scheduling |
| `dispatchToResultHeaderMs` | Dispatch callback invocation through receipt of the complete result header; includes execution, generation and Android hashing |
| `resultReceiveMs` | Complete header receipt through complete payload frame receipt at Node |
| `resultReceiveAndValidateMs` | Same start through checksum and canonical-envelope validation |
| `androidResultWriteMs` | Android header/payload write and flush calls returning; not proof of host receipt |
| `androidResultAckRoundTripMs` | Android header send start through receipt of Node's verification acknowledgement |
| `totalTransportLifecycleMs` | Node connection preparation through cleanup, including execution wait |
| `resultBytes` | UTF-8 canonical result size, excluding transport headers |

`resultReceiveMs` can be very small when bytes are already buffered at Node. It
is not a measurement of the whole Android-to-host journey. The acknowledged
Android round trip includes both transfer directions, host validation and
scheduling, but excludes Android result serialization and checksum generation.
Do not subtract host and device timestamps or divide round-trip time by two to
claim one-way latency.

`outcome` is `received` only after verified canonical receipt. Optional Android
timing confirmation gets one additional second; `timingConfirmation` reports
`received` or `missing`. Missing or malformed timing never erases a verified
command result. Failures contain only measurements completed before failure.

## Failure semantics and validation

Setup has a ten-second deadline. The result wait deadline begins before command
dispatch and uses `resultEnvelopeTimeoutMs` or the existing execution timeout
plus five seconds. Cleanup may take up to two more seconds. These limits do not
replace the earlier readiness budget or cancel Android actions.

There is no automatic fallback or replay after connection or dispatch failure.
Checksum, length, identity, premature-close and framing failures return
`RESULT_TRANSPORT_FAILED`; elapsed transport deadlines return `COMMAND_TIMEOUT`.
Cancellation without a structured reason returns `RESULT_TRANSPORT_CANCELLED`.
A structured caller reason preserves its code and message; its other custom
fields are not copied by the direct result reader. Existing
failure evidence records dispatch uncertainty and prior host-side effects.
A failed connection cannot establish whether a dispatched mutation completed.
Logcat remains available for diagnostics but is not a second result source for
a direct execution.

### Recovery decisions

Inspect `error.code` and `error.details` together. Correlation, `phase`,
`dispatchState` and `earlierEffects` remain available through `runExecution`.
For direct-reader failures, `details.transport` is `"direct"`. A readiness
failure can still mention logcat because readiness uses the existing transport.

| Observation | Next step |
| --- | --- |
| `EXECUTION_VALIDATION_FAILED` for `resultTransport` | Pass `"direct"`, `"logcat"`, or omit the option; do not use an empty string or put it in the execution payload. |
| Setup/handshake failure before command dispatch | Check `adb devices -l`, the selected package, matching prototype APK and Doctor readiness. Older APKs do not implement this endpoint. Repair setup before another attempt. |
| `RESULT_TRANSPORT_FAILED`, `COMMAND_TIMEOUT` or cancellation after dispatch, or with `dispatchState: "unknown"` | Preserve the command/task IDs and logs. Establish current device state with a new bounded read-only observation before deciding what to do next; do not replay a mutation merely because its receipt is missing. |
| Verified envelope but a failed action or snapshot step | Use that envelope's error and step evidence. Successful transport does not repair an action or invalid snapshot. |
| `timingConfirmation: "missing"` with `outcome: "received"` | Keep the verified result; record the missing acknowledgement measurement. Do not rerun a mutation just to obtain timing. |
| `transport.direct.cleanup_failed` logger event | Inspect `adb forward --list`. Remove only the exact port still associated with the failed session after confirming its client has ended; never use `adb forward --remove-all` on a shared host. |

`dispatchState: "not_dispatched"` describes the Android command broadcast, not
an absence of all effects. Existing host-side `close_app` preflight can already
have acted; inspect `earlierEffects` before retrying mixed executions. An explicit
later `resultTransport: "logcat"` call is a new execution, not automatic recovery
or continuation of a failed direct attempt.

Regression coverage includes large fragmented Unicode payloads, corruption,
oversized/truncated frames, incorrect identities, cancellation, independent
sessions and a failed device connection alongside a successful one. Android
protocol tests cover framing, correlation, checksums, readiness gating and
monotonic acknowledgement timing without requiring a device.

Before considering default adoption, obtain live evidence for:

- Concurrent independent processes on two devices, including a physical device.
- Large hierarchies and matched logcat/direct timing samples.
- Device or Operator restart during transfer while another device continues.
- Same-Operator contention and release/dev endpoint separation.
- Forward cleanup after normal exit, timeout and disconnection. Abrupt host
  process termination can leave a forward behind; automatic stale-forward
  reclamation is not implemented. Android session expiry still bounds its
  socket lifetime.

This prototype does not change public result envelopes, automate Operator
selection, stream screenshots, or replace broadcast command delivery.

## Live emulator observations, 27 September 2026

The matching prototype APK was installed on a freshly started Pixel 10 Pro Fold
emulator (API 37). Settings snapshots passed over both transports. Five
consecutive samples per transport observed the same 70,491-byte hierarchy;
direct canonical envelopes were 77,057 bytes.

| Measurement | Median | Sample range |
| --- | --- | --- |
| Logcat total execution | 277.914 ms | 255.620-455.541 ms |
| Direct total execution | 143.154 ms | 141.234-253.720 ms |
| Direct connection setup | 50.733 ms | 49.150-54.412 ms |
| Direct handshake round trip | 1.370 ms | 1.183-1.808 ms |
| Direct receipt and validation | 0.345 ms | 0.325-0.704 ms |
| Android send-to-verified-acknowledgement round trip | 2.675 ms | 2.033-2.986 ms |

These are small, sequential emulator samples: logcat ran first, then direct,
with a fresh Node process for each five-sample series. The first iteration of
each series includes cold readiness work. The approximately 49% lower median
total time is an observation for this screen and run, not a physical-device or
large-hierarchy performance guarantee.

A second emulator, previously offline, also recovered and passed with the same
APK. Two independent Node processes then ran three direct snapshots each on the
two devices, adding a one-second Android sleep per command to ensure overlapping
work. All six snapshots passed with verified timing confirmations.

For failure isolation, a separate process canceled its wait 100 ms after its
command broadcast was acknowledged on the second emulator. It returned
`COMMAND_TIMEOUT` with `dispatchState: dispatched`. Meanwhile, another process
completed all three direct snapshots on the foldable. Android logs show a single
start and eventual completion of the canceled command: host cancellation did
not stop Android work or replay it. No ADB forwards remained after either the
concurrent-success series or the cancellation-isolation series.

This supplies live basic-transfer, concurrent-device and cancellation-isolation
evidence. Physical devices, multi-megabyte live payloads, restart-in-transfer,
same-Operator contention and release/dev endpoint separation still need their
own live acceptance checks. The larger-payload and corruption coverage above
remains deterministic protocol-test evidence.

## Repeatable Settings flow benchmark

`validation/direct-result-transport/settings-flow.mjs` compares both result
transports through the persistent, branch-local Node API. This is a deterministic
performance validation, not an agent planning eval. Both modes use the same Node
build and installed APK; only `resultTransport` changes. The harness verifies the
installed base APK's SHA-256 against `--apk` before measuring.

The flow closes Settings outside the measured interval, then opens Settings,
waits for the initial page, scrolls the main list to its verified bottom, opens
About, scrolls that page to its verified bottom, takes a final hierarchy snapshot,
and saves a screenshot. A further snapshot verifies the screen remained stable
during capture; that verification is timed separately and excluded from the flow
total. APK checking, raw JSON/report writes, and initial setup are also excluded.
Screenshot acquisition and PNG persistence remain inside the measured interval.

The literal last main-list entry on the tested Google emulator images is
**Tips & support**, which opens a help flow. To avoid network-dependent content,
the benchmark verifies that entry at the bottom, then selects **About emulated
device**. On API 37 that requires scrolling back up. The final About entry is
**Build number** on API 35 and **Send feedback** on API 37. The benchmark never
presses either final entry. Profiles record these differences explicitly.

Use an English-language device in a fixed orientation and fold posture, with no
other agent or person interacting with that device during the run. Inspect a new
device's Settings layout and create a local profile using the checked-in profiles
as examples. Do not infer a profile solely from its API level: manufacturer and
system-image differences can change the layout. A mismatched endpoint fails the
trial rather than silently choosing another flow.

```bash
npm --prefix apps/node run build
./gradlew :app:assembleDebug
node apps/node/dist/cli/index.js operator setup \
  --device <device_serial> --operator-package com.clawperator.operator.dev \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk
node validation/direct-result-transport/settings-flow.mjs \
  --device <device_serial> \
  --profile validation/direct-result-transport/profiles/settings-api35.json \
  --operator-package com.clawperator.operator.dev \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk \
  --warmups 3 --measured 10
```

For the unfolded API 37 emulator use `profiles/settings-api37.json` in the same
validation directory. Counts are per transport: the defaults run six warmups and
20 measured trials. Pair order alternates logcat/direct, then direct/logcat. Run
devices sequentially for latency comparisons so they do not compete for host
resources. Independent devices and harness processes use explicit serials and
unique output directories; do not run two harnesses against the same device.

Each swipe uses coordinates derived from the current container bounds, a 300 ms
gesture, and 300 ms settling. Endpoint verification requires the configured last
label to be visible and last in the container, plus two consecutive swipes with
unchanged visible label positions. There is a 20-swipe bound per scrolling stage
and a 20-second command timeout. This deliberately does not treat a runtime
`NO_POSITION_CHANGE` result as proof of reaching the end. The harness retains
failed trials and exits nonzero if any warmup or measured trial fails. It never
replays a failed action automatically.

Before selecting About, the harness also requires two consecutive unchanged
visible-label observations with the target still visible. If a residual fling
carries the row out of view, it reverses the reveal direction before dispatching
any click. This has a 20-observation bound, and its cost is included in
`selectDetail`. Initial emulator trials without this check exposed
`NODE_NOT_FOUND` failures after a transiently visible target on both transports;
those diagnostic trials must not be mixed with the stabilized comparison.

Output defaults to a unique run directory under
`~/.clawperator/timings/<UTC-date>/<device_serial>/`. `--out-dir` overrides the
parent directory. Raw trial files contain command identities, canonical results,
and hierarchy evidence; PNGs contain the final screen. Keep these local because
About pages expose device identifiers. Only sanitized aggregate reports belong
in Git. The summary includes mean, median, min, max, and nearest-rank p95 for
successful measured trials; failures and warmups remain in the raw trial log.

Measurements include flow and stage wall times, command and swipe counts,
hierarchy bytes and nodes, screenshot bytes and dimensions, screenshot ADB time,
and the direct transport's setup, ping round trip, receipt/validation, and Android
write/acknowledgment timings. Timing evidence is correlated by command ID.
`androidSnapshotTimings` reports Android hierarchy and metadata costs in
microseconds, including expected versus observed snapshot commands. Missing
Android logs or direct timing confirmations are visible, not treated as zero.
The harness temporarily enables `ClawpSnapshotTiming` and restores its prior
value on normal completion or a caught run failure. After forcibly terminating
the process, check that property and restore it if necessary.

This is a debug APK diagnostic, not a release performance claim. Flow totals
include app launch, UI animations, intentional settling, all observation round
trips, and screenshot acquisition through ADB in both modes. Direct ACK timing is
a round trip including host validation, not a measured one-way network delay.
Separate final-snapshot and transport timings help distinguish result delivery
from the rest of the flow. A physical-device run remains necessary before drawing
conclusions about hardware performance.

Offline regression tests run in the normal validation CI suite and the manual
direct-transport workflow:

```bash
node --test validation/direct-result-transport/settings-flow.test.mjs
```

The live Settings benchmark is opt-in because its profile must match the device.
The existing manual transport workflow still runs its profile-independent
snapshot smoke test on its API 35 and 36 images.
