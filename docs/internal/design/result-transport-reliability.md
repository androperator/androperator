# Result transport reliability

Current release verification uses the local suite; a GitHub run is optional by
the release owner's 13 September 2026 decision. See the
[release requirements](../release-reference.md#v010-acceptance-requirements).
Historical evidence below retains the coverage and failures of each attempt.

## Contract and ownership

The host result reader owns process lifecycle, stream framing and reassembly.
Android owns terminal publication. A transport failure is a structured execution
failure, never a fabricated Android terminal envelope or a reason to replay an
uncertain mutation. Public codes and SSE migration are documented in
[errors](../../api/errors.md#result-transport-failures) and
[Serve](../../api/serve.md#get-events-sse-stream).

The explicit-device reader starts during preflight. Previously, its deferred
broadcast callback could resume after the reader had exited. A controlled
fixture reproduces this race. The dispatch-capture boundary now refuses to
proceed after settlement, before the broadcast call. Process exit, spawn failure,
cancellation, timeout and malformed transport retain correlation and dispatch
uncertainty. Finalization settles once before killing the reader, so process
close cannot overwrite an already observed terminal result or specific failure.
A final unterminated line is drained at process close.

Chunk validation remains strict: ordered indices, consistent identity and size,
canonical base64, exact reconstructed size and SHA-256, and terminal correlation.
Missing chunks remain incomplete; reordered, duplicate or conflicting chunks
remain malformed. Diagnostics expose received/expected counts and bytes without
inventing Android action progress. The existing 100 ms subscription fallback
remains a timing heuristic, not proof of a connected logcat reader. No timeout
inflation, transport replacement or mutation replay was introduced.

## Large snapshot and deadline investigation, September 2026

An investigation on 27 September reproduced large-hierarchy failure and a
misleading evidence-deadline outcome on an emulator. The baseline findings and
subsequent repairs are recorded below. Physical-device timing remains unverified.

### Scope and build identity

The baseline was commit `e2ca7b86b5b3e63061582addcc2af275511cb838`, branch-local
Node CLI 0.12.3 and a freshly built 0.12.3-d Operator. The target was an Android
16/API-36 arm64 emulator at 1344 x 2992, density 480. The installed Chromium-based stable browser was
1.94.121; its flags page displayed version 152.1.94.121. Both release and dev
Operator accessibility services were enabled; every command explicitly selected
the dev package. Doctor passed after installation.

The originating report used CLI 0.12.0, a physical API-37 device and the nightly
browser variant 1.98.19. The emulator is a useful reproduction of failure classes, not
an equivalent timing environment. The original mobile YouTube page, daemon
routing, release APK and a physical device were not tested in this investigation.

Baseline APK SHA-256:
`2571aa97460bc9eda2597abdd756d683b9e3bb77b1c1618f16851a5dd25eee8a`.
The instrumented APK added only opt-in timing subdivisions in
`TaskScopeDefault.logUiTree`; its SHA-256 was
`0ce67bd673464209e2422b35533bb0e04a5d72dbcc71702093c698c7f4d4854d`.

### Reproduction and retained outcomes

The branch-local CLI opened the browser, focused its observed address field, and typed
its internal flags URL with the fullscreen-workaround fragment and submission.
The exact browser identity and URL remain in private command receipts.
A separate screenshot verified the Experiments page. The older browser showed
the full flags list, not an isolated matching experiment. No flag was changed.
All snapshots and evidence captures below used `--no-daemon`; each CLI process
had a 45-second outer deadline and an 8 MiB output buffer. Failed observations
were retained, and no mutation was replayed as recovery.

| Observation | Host duration | Outcome |
| --- | --- | --- |
| Launcher compact snapshot | 0.403 s | Complete, 36 nodes |
| Initial browser snapshot | 0.398 s | Complete, 46 nodes; this did not establish loaded version-page content |
| Flags snapshot, 200 nodes / 1200 text characters | 18.815 s | `SNAPSHOT_EXTRACTION_FAILED`, malformed XML, 1,946,337 received bytes |
| Independent flags screenshot | 0.936 s | PNG saved and inspected; flags page visible |
| Flags evidence capture, default 30-second budget | 11.829 s | Partial; screenshot complete in 0.403 s, hierarchy malformed after 11.054 s |
| Flags evidence capture, explicit 5-second budget | 5.116 s | Partial; screenshot complete in 0.419 s, hierarchy reader killed after 4.559 s |
| Flags snapshot with timing subdivisions | 14.689 s | `SNAPSHOT_EXTRACTION_FAILED`, malformed XML, 1,939,470 received bytes |

The default-budget evidence hierarchy had 1,934,792 received bytes. All three
malformed captures reported `closingHierarchySeen: true`; seeing the closing
tag is insufficient to establish a complete source. The original report's
missing closing tag was not reproduced. Neither was its 45-second caller
`ETIMEDOUT` outcome.

To inspect the same stages on a prepared, explicitly selected target:

```sh
adb -s <device_serial> shell setprop log.tag.ClawpSnapshotTiming DEBUG
node apps/node/dist/cli/index.js snapshot \
  --compact --max-nodes 200 --max-text-chars 1200 --no-daemon \
  --device <device_serial> --operator-package com.clawperator.operator.dev
node apps/node/dist/cli/index.js evidence capture \
  --timeout 5000 --output-dir /tmp/new-snapshot-budget-bundle --no-daemon \
  --device <device_serial> --operator-package com.clawperator.operator.dev
adb -s <device_serial> logcat -d -v time -s ClawpSnapshotTiming:I
adb -s <device_serial> shell setprop log.tag.ClawpSnapshotTiming INFO
```

The short evidence budget is a deliberate diagnostic trigger, not a recommended
operating timeout. Preserve stdout, stderr, exit status and elapsed time for
each command, plus each bundle's manifest and `captures.json`. Save an
independent logcat capture promptly: large subsequent snapshots can overwrite
the device ring buffer. Keep raw hierarchy and screenshot artifacts out of Git.

### Finding 1: loss precedes XML validation

For the first flags snapshot, Android's timing record reported a generated
2,071,952-byte hierarchy, and its stage-success record counted 4,496 nodes. The
CLI reconstructed 1,946,337 bytes. Applying the same extractor to a separately
retrieved device log buffer produced the same malformed payload and byte count;
that payload contained 4,223 `<node ` occurrences. Trimming the generated final
newline accounts for one byte, not the remaining deficit.

This localizes loss before Node XML validation and implicates hierarchy
publication or Android logging. It does not identify the exact dropped-record
mechanism or establish a universal size limit. The generated source was not
saved independently before logging, so its full XML validity was not directly
verified. The live reader and device-buffer agreement does not support blaming
compact projection or a Node-only streaming boundary.

`TaskScopeDefault.logUiTree` publishes XML through `Log.d`, which delegates to
Timber's `DebugTree`. The host reconstructs that text from logcat. This is a
separate path from `publishResultEnvelope`: the existing result chunk byte
counts, hashes and pacing do not protect snapshot XML. Compact projection runs
only after source validation. Rejecting these incomplete snapshots is correct;
accepting a repaired-looking prefix would weaken selector evidence.

### Finding 2: node counting dominates the warm snapshot

The timing subdivisions preserve the existing `metadataAndStatsUs` aggregate
and add `nodeCountUs`, `maxDepthUs` and `windowMetadataUs`, only when the existing
`ClawpSnapshotTiming` debug tag is enabled. They do not change snapshot behavior.

The instrumented flags observation measured:

| Android stage | Duration |
| --- | --- |
| Generate hierarchy | 4.126 s |
| Log hierarchy | 60.852 ms |
| Count nodes | 10.164 s |
| Calculate maximum depth | 4.605 ms |
| Fetch window metadata | 9.910 ms |
| Total measured snapshot work | 14.366 s |

The two earlier evidence observations generated the hierarchy in 137-140 ms,
but spent 9.883-10.624 seconds in the then-unsplit statistics/metadata stage.
The subdivided observation identifies
`"<node ".toRegex().findAll(hierarchyDump).count()` as the expensive operation
in that run. It does not establish why the Android regex implementation is
slow, or a growth-rate claim from one payload size. Window metadata is not the
source of that measured ten-second delay.

### Finding 3: an owned deadline is reported as a transport exit

At the five-second evidence deadline, `EvidenceBudgetRunner` aborts its signal
with `COMMAND_TIMEOUT`, then kills its streaming children with `SIGKILL`.
Screenshot capture consumes that signal. The hierarchy call passes the budget
runner and remaining time to `runExecution`, but does not propagate that budget
signal into the result reader. The result reader therefore observes process
exit before its own timer fires and reports:

```text
RESULT_TRANSPORT_EXITED
logcat exited before terminal envelope (code=null, signal=SIGKILL)
```

The retained hierarchy failure correctly says `phase: result_wait`,
`dispatchState: dispatched`, and `earlierEffects: []`; the bundle correctly
remains partial with its screenshot intact. However, its code/message omits
the known cause: the capture owner exhausted its deadline. This reproduces the
reported error shape without a daemon or a physical-device disconnect. It does
not prove that the original session had the same cause.

Android subsequently emitted snapshot timing for that command after 10.076
seconds of work, beyond the host's five-second budget. Host process cleanup is
not evidence that device work stopped. Standalone snapshot result waiting also
starts its timer at dispatch, after readiness, rather than enforcing a single
whole-process deadline. The original 45-second outer timeout still needs its
own correlated reproduction before assigning a root cause.

### Implemented repair

The Operator now returns snapshot XML inside the canonical action step's
`data.text`. This reuses `publishResultEnvelope`, including its paced 1024-byte
chunks, command/task identity, ordered indices, declared byte length and SHA-256.
Agent snapshots no longer emit a second unverified raw hierarchy log. Manual
hierarchy logging without a command context retains its existing diagnostic
output. No socket, new chunk format or file-transfer service was introduced.

Node preserves canonical `data.text`, validates its XML and applies the existing
presentation. Tagged legacy extraction remains available for older Operators,
but cannot overwrite an explicitly supplied source, even an empty invalid one.
Current snapshots stay associated with their action IDs inside the verified
result; legacy occurrence ordering is not used for them. Missing or corrupt
result chunks fail at transport before any snapshot can be used. The existing
transport limit applies to the whole envelope, including multiple snapshots.
Pacing is not durable delivery or permission to accept incomplete data.

Node counting now uses a forward literal scan instead of regex iteration. The
first repaired 2,071,952-byte flags capture counted its 4,496 nodes in 12.700 ms,
compared with the baseline 10.164 seconds. Subsequent large captures counted in
11.503-13.046 ms. These measurements do not predict physical-device latency.

The evidence budget now propagates its abort signal into `runExecution` and the
result reader. Budget exhaustion settles as `COMMAND_TIMEOUT` before owned
process cleanup, with `details.deadlineOwner: "evidence_capture"`. Pre-dispatch
expiry prevents the requested broadcast and retains any earlier host effects;
after-dispatch expiry retains reader/chunk progress and dispatch uncertainty.
An already accepted terminal outcome wins over later cancellation. The budget
runner also expires synchronously if a new operation observes no time remaining
before the timer callback has run. This does not add a global CLI process
deadline or promise to stop Android work already dispatched.

The public snapshot arguments, success shapes, XML and compact presentation are
unchanged. Evidence consumers should use the new truthful `COMMAND_TIMEOUT`
outcome for owned hierarchy-budget expiry rather than expecting
`RESULT_TRANSPORT_EXITED` for that case. Unexplained transport exits still retain
their existing code. No runtime skill depends on the internal XML log marker,
and no runtime-skill input or output contract was changed.

### Repaired live evidence and limits

The same explicit API-36 emulator, selected dev Operator and browser were used.
The rebuilt Operator passed doctor before observation. The first repaired flags
snapshot completed in 8.513 seconds and returned all 4,496 nodes before compact
projection to 200 nodes. A later raw-artifact snapshot completed in 7.685 seconds,
with 4,706 nodes and 2,167,613 XML bytes, exactly matching Android's generated
byte count. Browser state changed between observations, so these are not paired
end-to-end speed benchmarks.

A flags-page evidence bundle completed in 8.117 seconds. Its screenshot was
visually checked, and its hierarchy had 4,705 nodes and 2,167,159 bytes, matching
Android's source byte count. The hierarchy artifact and capture receipt agreed.
A deliberate two-second capture finished partial in 2.080 seconds: the
screenshot remained complete, and the hierarchy failed as `COMMAND_TIMEOUT`,
`phase: result_wait`, `dispatchState: dispatched`, with
`deadlineOwner: evidence_capture`. Diagnostics retained 759 of 2,298 chunks and
777,216 of 2,352,444 envelope bytes. No partial XML was accepted or mutation
replayed.

All attempts remain in private receipts. An intervening snapshot observed
Settings (143 nodes), and its evidence bundle also completed. A snapshot
immediately after returning to the browser captured a 46-node transitional tree.
Those successful observations are excluded from the large-page measurements.
The flags page was then explicitly loaded and checked again. The finite sample
proves the repaired paths on this emulator; it does not establish a universal
size threshold or zero-flake logging. Physical API-37 hardware, the original
45-second outer timeout, the original video page, release APK and live daemon
parity remain outside this validation.

Regression coverage exercises multi-megabyte Unicode XML, multiple action IDs,
compact projection after reassembly, missing middle/tail chunks, checksum
failure, malformed XML after valid transport, legacy compatibility and explicit
empty sources. Deadline tests cover pre-dispatch expiry, retained force-stop
effects, expiry after dispatch, terminal/deadline races and partial evidence
bundles. Android tests verify source preservation without the raw agent log,
exact node counts and placement in canonical action data. The Node suite, debug
APK build, app and all-module Android unit suites, and docs build validate the
change. Source and artifact identities remain in the private evidence directory.

## Reproduced publication loss

A fixed debug baseline on 13 September 2026 ran 20 immediate Settings open/query
cycles and 20 full Internet queries. Three Settings queries failed:

- Cycle 5 timed out after receiving indices 0-53 of 69 (55,296 of 69,700 bytes).
- Cycle 11 timed out after receiving indices 0-59 of 69 (61,440 bytes).
- Cycle 14 rejected index 63 after index 57 (expected index 58).

An independent live reader and a subsequent device-buffer dump had the same
missing records for the first failure. This implicates publication or Android
logging before host reassembly, rather than a Node-only stream split. The other
baseline commands, including all 20 Internet queries, remain in the report.

The publisher previously emitted every chunk synchronously in a tight loop.
[AOSP liblog](https://android.googlesource.com/platform/system/logging/+/refs/tags/android-15.0.0_r1/liblog/logd_writer.cpp)
uses nonblocking logging writes that can drop overloaded records. Its
[public write wrapper](https://android.googlesource.com/platform/system/logging/+/refs/tags/android-15.0.0_r1/liblog/logger_write.cpp)
returns success after calling the logger without exposing the underlying write
result. Buffer pressure is the causal explanation supported by that source and
the missing-record evidence; the exact kernel error was not captured.

`publishResultEnvelope` now inserts a 1 ms pause between chunk records. It
preserves order and publishes each record once, without retrying actions or
weakening integrity. Small envelopes incur no pause. Publication is awaited on
`Dispatchers.IO` inside `NonCancellable`, so chunk encoding and inter-record delays leave the Android main thread available while
preserving cancellation-terminal delivery. This is pacing, not a durable
delivery guarantee. A 69-record result adds 68 requested pauses; actual scheduling
can take longer. Unit coverage asserts the inter-record pause and exact output
sequence, including unchanged small-envelope publication, caller-thread
responsiveness, and complete publication before or during cancellation.

## Declared live evidence and limits

The checked-in [manual harness](../../../validation/result-transport-reliability/README.md)
uses the branch-local 0.10.0 CLI, API-35 arm64 Google APIs Android 15 image,
English en-US, and fingerprint
`google/sdk_gphone64_arm64/emu64a:15/AE3A.240806.036/12592187:user/release-keys`.
Only the selected Operator service was enabled. Builds started from `e1aadca2`
plus the transport implementation committed as `cd3e979`. Private metadata records the exact built JavaScript hashes,
APK hashes, package metadata, command/task IDs, every output size and duration,
and bounded raw logcat evidence. No personal device identifiers are committed.

| Series | Immediate open/query commands | Full Internet queries | Failures retained |
| --- | --- | --- | --- |
| Original publication, debug | 37/40 | 20/20 | Two missing-tail timeouts and one missing-middle malformed result |
| Paced publication, debug | 39/40 | 20/20 | First open returned `DEVICE_ACCESSIBILITY_NOT_RUNNING` immediately after reinstall |
| Paced publication, release | 40/40 | 20/20 | None |

Each row was declared before its run. The repaired debug failure was not erased
by restarting its series. All 40 full queries in each repaired variant succeeded;
Settings responses reached about 70 KB and Internet responses about 32-34 KB,
so both exercised chunking. Repaired debug Settings query durations were
409-580 ms and Internet queries 335-440 ms; release Settings queries were
384-630 ms and Internet queries 334-424 ms. These include host preflight and
process startup, not just publication.

APK SHA-256 values:

- Baseline debug: `fc79049b2c5147f29839cbb9966a2f48d56a905e05d358440646f752e9502482`.
- Paced debug: `59986b267bf1baa4056c47ab9639057403408d3366d002b16d92009faa90f22f`.
- Paced release: `563b16e1f56e310eab742292e5199a4b596347f3ef4d409c60e098d77fbf5085`.

The original audit's logcat exit 255 and timeout with no correlated events were
not reproduced live here. Controlled subprocesses prove their stable codes and
uncertainty semantics, not their original live root causes. Those causal limits,
the debug startup failure and the finite sample prevent claiming a completely
resolved reliability gate or a zero-flake transport.

Scroll eligibility and homepage preparation repairs were not integrated for
the original series above. The combined hierarchy
regression and manual CI release gate were outstanding at that point; this focused fixture deliberately
uses the Settings Internet intent and does not waive homepage/scroll assertions.
No runtime skill contract changed, and no sibling skill migration is required.

## Validation

- `npm --prefix apps/node run build` and `npm --prefix apps/node run test` cover
  1,478 passing tests, including the host changes, lifecycle subprocesses, strict chunk reassembly, deferred
  dispatch, SSE outcomes, and CLI/Serve/MCP/daemon error adapters.
- `./gradlew :app:assembleDebug :app:assembleRelease unitTest` passed, including
  447 Android tests with zero failures or skips.
- `./validation/test_all.sh --suite validation` passed, including the new
  offline fixture checks and existing installer/policy regressions.
- `./scripts/docs_build.sh` passed route/link validation with no organization
  warnings. Generated machine-facing documentation retains all new codes.

The scoped consumer tests preserve specific failure codes and non-success
semantics; MCP retains its intentional stderr redaction. This work does not
claim live daemon/MCP parity across both variants or the full hierarchy gate.

### Background publication follow-up

The main-thread publication fix passed the debug APK build, app unit tests and
all-module unit tests (449 tests, zero failures or skips). Regression tests
verify that writes leave the caller thread and that every record is published
when cancellation occurs before publication or between records.

The updated debug APK was installed on an explicit API-35 emulator with only
the debug Operator accessibility service enabled. A branch-local execution
containing 20 full Settings queries returned one successful 641,390-byte CLI
result; every query contained nonempty, untruncated nodes. This checks live
chunk reassembly; caller-thread responsiveness and cancellation are covered by
the controlled unit tests. The release variant was not rerun for this follow-up.

### Integration with main for PR review

Merged `origin/main` at `28b8b1fa` into the branch containing the reviewed
background-publication fix `be5f85ac`. This integrated compact snapshots, scroll eligibility and homepage preparation.
The integrated code passed 1,496 Node tests, 463 Android unit tests, both APK
builds, repository validation and the docs build.

On the same explicit API-35 emulator, each selected service was launched and
passed doctor before its single combined hierarchy run. Debug passed the full
checked-in regression, including five query comparisons, XML/MCP parity, PNG
decoding and Display & touch. Release stopped at `Missing unique Wi-Fi switch`:
the first captured Internet query returned a successful, correlated 24-node
hierarchy without the switch; the next two captures returned 68 nodes with the
switch. No transport failure occurred in those three captures. The failed run
is retained, without retrying to obtain a passing result or weakening the
fixture. At that revision, release readiness remained open for the fixture
transition, historical transport causes and the then-required manual CI run.

Integrated APK SHA-256 values:

- Debug: `b1a0f7c831a200ffe40ea1ce109ffb65a3474e0fdb67d2c0526df7f11a1f350d`.
- Release: `dfd1f5f2aaf1b3b356f260d4f252345977a3f985c36c9127f1944a083c6f0699`.


### Completed local hierarchy and transport integration

The final integrated harness at `306b38d` passed all six debug/release
fresh/subpage/search runs on API 35, including query/MCP/XML parity, PNG and
Display control. The fixed transport series passed 60/60 commands per variant
with full query outputs of 32,345-69,786 bytes. Both APKs contain the runtime code
merged in `0c4ed5ce`; no additional runtime transport change was needed.

Two harness fixes completed this proof: Internet readiness now distinguishes the
outgoing page's Airplane mode switch from the loaded Internet destination, and
Operator variant setup waits for complete service teardown before installation,
then verifies a healthy selected binding and nonempty query. The earlier release
failure after the readiness fix was retained and diagnosed as unusable service
binding state; the interrupted transport series was not presented as a pass.

The [full acceptance record](../../../validation/sensitive-hierarchy-access/README.md#integrated-hierarchy-and-transport-acceptance)
preserves all final cases, earlier failures, setup observations, source and APK
hashes. This resolves the local combined-harness gap described above. Historical
causal limits remain explicit; a finite series does not prove failure-free
transport under every condition.

## Recurring reader exit investigation

The independent audit at `6367227a` retained a debug Internet parity query with
`RESULT_TRANSPORT_EXITED`, exit 255, empty stderr, a sent broadcast and a
correlated Android command-start event, but no received chunks. Its later fixed
series passed 60/60 commands on each variant. Both observations remain valid;
the passing series does not close the causal reliability gate.

The recurring-exit investigation started at `8d398706`, including the initial
transport and integrated hierarchy setup repairs. Inspection separated these mechanisms:

- `NodeProcessRunner.spawn` has no generic process timeout. Reader timeout and
  cancellation settle before killing their child, preserving their specific
  code. The result reader does not restart or redispatch an accepted execution.
- Framing uses a UTF-8 decoder and drains a final unterminated line at close.
  Chunk validation still enforces order, identity, size, canonical base64 and
  checksum. Android still publishes once with the existing background pacing.
- The [ADB shell client](https://android.googlesource.com/platform/packages/modules/adb/+/7c2fd99d6ec7e0d2d977ba03cecc82375af1baad/client/commandline.cpp)
  initializes its shell-protocol result to 255 for unexpected disconnection and
  replaces it when a remote exit packet arrives. Thus host exit 255 does not
  establish that Android logcat itself returned 255. Missing shell completion
  is a source-supported hypothesis, not a captured explanation of this audit.
- [Android logcat](https://android.googlesource.com/platform/system/logging/+/refs/heads/android15-s1-release/logcat/logcat.cpp)
  reports read/EOF failures with stderr diagnostics. Empty stderr alone cannot
  distinguish an ADB connection interruption from device-side termination or
  lost diagnostics. There is no evidence here to blame accessibility or change
  publication pacing, buffer sizes, transport integrity or timeouts.

### Repaired exit-to-close dispatch race

[Node process lifecycle](https://nodejs.org/api/child_process.html#event-close)
allows `exit` before output-pipe `close`, including when another process retains
an inherited pipe. A real controlled subprocess exited 255 at about 33 ms and
closed its pipes at about 363 ms. Two deterministic regressions failed against
the original reader: a deferred preflight dispatched in this interval, and the
startup timer could start a new broadcast after exit.

The reader now marks process death on `exit`. Both broadcast startup and the
dispatch boundary refuse new work from that point. It drains pipes until
`close` or the configured wait deadline, so late stderr, a complete already
dispatched terminal result, and specific integrity errors retain their authority.
A rejected deferred callback
does not replace the reader's exit failure with `BROADCAST_FAILED`. Controlled
real-process and event-order tests cover the race; execution/SSE coverage checks
zero dispatch, correlation and no invented terminal envelope.

This is a demonstrated dispatch-safety repair. It does **not** explain the
audit's already observed Android command start or prevent an external reader
connection from exiting. That recurring cause remains unresolved unless a new
failure captures its process/protocol context.

The manual fixed-series harness also stops after any failed `open`, preserving
remaining attempts as unrun. Previously the next cycle could issue the same
mutation despite an uncertain outcome. Read-only query failures remain recorded
and are never replaced with successful retries. Offline tests cover both paths;
`summary.json` records failures, unrun counts and independent-reader exit state.

### Reader-exit repair bounded live results

On 13 September 2026 the baseline debug full hierarchy fixture passed once
before the repair. The repaired source was committed as
`b31f497e57d9e40454fb03d4b53e8128df17d682` before the final live series. It used
the branch-local CLI 0.10.0 and locally built debug 0.10.0-d / release 0.10.0
APKs, with only the selected service active. The explicit test device was an
English API-35 arm64 emulator, build `AE3A.240806.036/12592187`, 1080 by 2400,
density 420. ADB was 37.0.1-15733141. No other device or shared ADB-server state
was changed.

| Repaired variant | Immediate open/query commands | Full Internet queries | Complete hierarchy fixture | Failed / unrun series attempts |
| --- | --- | --- | --- | --- |
| Debug | 40/40 | 20/20 | Pass once, including Home cleanup | 0 / 0 |
| Release | 40/40 | 20/20 | Pass once, including Home cleanup | 0 / 0 |

Each series was declared before running and was run once. All 40 queries per
variant used `--visibility all --limit 1000`. Settings query output was 69,785
bytes; Internet output ranged from 32,347 to 34,360 bytes. Debug Settings/query
durations were 413-560 ms and Internet 335-409 ms; release was 402-601 ms and
328-413 ms respectively. Both complete hierarchy runs passed homepage readiness
in one observation and Internet readiness in three, then verified repeated
queries, raw/MCP/XML parity, PNG decoding and the unchanged Display scroll and
Brightness level postcondition. This is one complete run per repaired variant,
not a new six-starting-state acceptance matrix.

Private evidence retains all command arguments, stdout/stderr, exit status,
command/task correlation, output sizes, elapsed times, source identity, built
JavaScript hashes, APK hashes, setup checks and artifact assertions. Bounded
independent readers retained up to 5,000 stdout lines and 100 stderr lines;
before/after process lists, accessibility state, buffer sizes and a 5,000-record
device-buffer dump were captured separately. Final runs enabled `ADB_TRACE=shell`.
The fixed-series harness also kept its existing per-attempt independent tails.
All independent readers were alive before intentional cleanup. The observed
logd, adbd and selected Operator process identities were unchanged across each
run. No live transport failure or service failure occurred in these declared
reader-exit repair attempts. Instrumentation may affect timing; these observations do not
prove that an unobserved short interruption is impossible.

Locally built APK SHA-256:

- Debug: `a155fd245ce1dbfa4eae95639f2e4e33a634abb91f19f07a77ed2f8e37ae1b75`.
- Release: `7671fbc6e36a9c23926febe7e712a0d2c6f0f1c2dbfa36132f3a61503952d131`.

Validation passed: Node build and 1,528 tests; both APK builds and 463 Android
unit tests; repository validation including the fixed-series offline checks;
and docs generation with route/link checks and no organization warnings. The
two intentionally failing pre-repair race regressions and real-process timing
trace remain in the private evidence alongside the passing runs. Initial build
invocation/setup failures were retained separately from completed validations.

### Remaining causal blocker

The bounded reader-exit investigation and safety repairs are complete, but the recurring
post-dispatch exit-255 cause remains unresolved. None of the new live attempts
reproduced that failure, so there is no failing shell-protocol trace to compare
with independent device logging and process state. The audit's command-start
observation rules out presenting the pre-dispatch race repair as its root-cause
fix. Publication loss and the historical zero-event timeout remain separate
causal limits; integrity checks and pacing were not weakened or changed.

Further causal closure needs a fresh failing attempt with host shell-protocol
completion/disconnect evidence and simultaneous independent device/process
observations, without redispatching an uncertain mutation. The causal reliability
gate remains open. These local passes do not claim verification on the
supported GitHub CI image; that workflow is now optional.

### Review repair: bounded draining after exit

The delegated code review found a pre-dispatch hang in the initial exit guard:
if another process retained the exited reader's output pipes, dispatch was
blocked but no result timer had started. With a 20 ms configured timeout, a
controlled reader stayed pending beyond 100 ms until a synthetic close arrived.

Exit now starts the configured result-wait budget if dispatch has not started
it already. An existing dispatch deadline is preserved. At that deadline the
reader drains the final buffered line, accepts a complete validated terminal
result or specific malformed framing failure, or returns `RESULT_TRANSPORT_EXITED`
with the observed exit code/signal and `outputDrainIncomplete: true`. Cleanup
closes both host output handles so retained writers cannot keep the CLI alive.
No mutation is dispatched or replayed during this drain.

Regression coverage exercises startup, deferred preflight and post-dispatch
exit without pipe closure, retained stderr/signal, stream cleanup, final buffered
success and malformed framing. This bounds the demonstrated hang without
extending the configured deadline or claiming a cause for the live audit exit.

### Clean review and latest-main integration

The drain repair was committed in `308d42eb`. A fresh independent sub-agent
review of committed `21c58729` against main `0b571d76` found no actionable
issues and passed 25 reader/transport tests plus four harness checks. This
clean review covered integration with the Android overlay-permission and
video-verification changes.

The integrated build passed all 1,565 Node tests and repository validation,
including the full-stream media fixtures from upstream. Matching debug/release
APKs built successfully and all 463 Android tests passed. Android source did
not change between the two upstream merges, so those exact APKs were retained.

Two host-validation setup problems remain in private attempt accounting: a
temporary isolation wrapper initially retained child logcat pipes, and an
explicit package environment override conflicted with an environment-default
test. The interrupted run and the one failed environment assertion were not
reported as passes. The wrapper was corrected to execute ADB directly, its
identified orphan readers on the assigned device were stopped, and the clean
full run used the normal environment. Neither problem required runtime changes.

The final declared live series used runtime source `21c58729`; the private
source-diff record also retains pending documentation-only notes. Each variant
ran once with 20 immediate open/query cycles and 20 full Internet queries.
All 120 commands delivered correlated canonical envelopes, with no reader exit,
malformed transport or timeout. The fixture verdicts were not all successful:

| Variant | Fixture checks passed | Canonical envelopes received | Retained first Internet-query failure | Complete hierarchy fixture |
| --- | --- | --- | --- | --- |
| Debug | 59/60 | 60/60 | Android returned `UI_TREE_UNAVAILABLE`, with service available but no root | Pass, including Home cleanup |
| Release | 59/60 | 60/60 | Successful query captured a 24-node loading screen without the fixture's sensitive root | Pass, including Home cleanup |

Both series completed all declared attempts without replaying a failed mutation.
The failed debug action and failed release fixture assertion remain failures;
neither series was repeated to obtain a green report. The independent reviewer
matched the debug failure's command-start and terminal records against CLI
output and found no new reader-code issue. The release failure also retains a
successful canonical envelope and its actual loading-screen hierarchy. These
observations establish delivery, not a repair or causal explanation of Settings
hierarchy availability. Accepted full-query responses ranged from 32,345 to
69,785 bytes. Independent observers stayed alive through both series.

A debug hierarchy invocation started while the series still owned the device
lock and failed before issuing commands. That host scheduling error is retained
separately; the subsequent serialized invocation completed the entire fixture.
Release completed its single full hierarchy invocation. Both successful runs
include repeated queries, raw/MCP/XML parity, PNG decoding, Display scroll and
Home cleanup. No device or shared ADB-server reset was used.

Final matching APK SHA-256:

- Debug: `d70263154b535d57b08d0c6935f6bfa43dbe539ece863c84011e5e84ebc99415`.
- Release: `e8df33b54cca7fa4b2614f62b15ded395c76f7c08e19673217351d67bd03f515`.

The clean code review supports these bounded lifecycle repairs. The historical
post-dispatch exit cause and these retained fixture failures prevent claiming
complete reliability. Current release verification requirements are linked above.

### Follow-up: controlled connection interruption and evidence repair

A further investigation on 13 September 2026 used implementation worktree HEAD
`e2b4617c`, then the diagnostic repair described below. PR #288 had meanwhile
merged as `7cdb31d4`; that merge does not close the causal gate. The original
audit's raw failed query was still available and independently confirmed the
reported start event, sent dispatch, zero chunks, empty stderr and exit 255.
Its historical interruption mechanism remains unknown.

Two separately declared read-only queries tested a specific mechanism. A private
TCP relay forwarded only the selected CLI result reader's connection to the
existing ADB server. After forwarding the correlated command-start output, it
closed that connection. Broadcast and independent-reader connections bypassed
the relay. No ADB server reset, device disconnect, Operator termination or
mutation replay was used. The first experiment enabled shell tracing; the
second disabled tracing to check the original empty-stderr symptom after the
diagnostic repair.

Both injected interruptions returned `RESULT_TRANSPORT_EXITED`, host exit 255,
null signal, sent dispatch and zero received chunks. The untraced attempt also
had empty stderr. Independent logcat stayed alive and retained all result
chunks. The branch-local strict reassembler validated the complete successful
canonical results: 32 chunks / 32,260 bytes in the first experiment and 34
chunks / 34,273 bytes in the second. Command/task identities matched each failed
CLI attempt. The observed logd, adbd and Operator process identities were stable
before and after the first experiment. Private evidence retains the relay,
forwarded bytes, injection timestamps, exact invocations, correlated output and
independent-publication verification.

This demonstrates that interrupting the host reader connection can reproduce
the symptom while Android completes and publishes correctly. It does not show
that this caused the historical failure, distinguish its external initiator,
or prove that every exit 255 has this cause. The deliberate interruptions are
not counted as naturally recurring failures or successful transport delivery.

The experiment exposed a separate diagnostic defect: `stdoutObserved` remained
false when the first output arrived after fallback dispatch, even with a
retained command-start line. A deterministic regression failed on that case.
The reader now records nonempty stdout arrival independently of startup-drain
timers. The corrected untraced experiment reported `stdoutObserved: true`.
Dispatch, deadlines, terminal authority and integrity checks are unchanged.

The manual series now reports canonical-envelope delivery independently of
Android action, host-exit and fixture verdicts. Reclassification of the saved
reader-exit investigation failures correctly counted the debug `UI_TREE_UNAVAILABLE` and release
loading-screen capture as delivered envelopes, with action and fixture failures
respectively. A no-envelope outcome remains `host_or_transport`, requiring the
original diagnostics to distinguish host/preflight errors from transport loss.
Before advancing after a failure, read-only observations save the bounded device
log buffer, process lists and connection state. Observation timeout and spawn
errors remain explicit and cannot replace the original attempt. Optional shell
tracing supplies bounded diagnostics, not a complete protocol recording.

The logcat publication path has no per-command delivery acknowledgement or
persistent result retrieval mechanism. These experiments show a recoverability
limit: successful Android publication is insufficient to guarantee delivery to
an interrupted reader. If the product requires retrieval after disconnection,
a durable result record fetched by the original command identity is a design
candidate; it would retrieve evidence without re-executing the action. This
follow-up does not implement a replacement channel or treat that design as the
historical root-cause repair. Causal closure still needs a naturally failing
capture with simultaneous reader/protocol and publication observations.

#### Follow-up attempt accounting

Only the assigned API-35 English emulator was used, with branch-local CLI and
matching locally built APKs. The debug fixed series delivered its first 40
canonical results. Attempt 41 failed before CLI startup because an overlapping
repository validation rebuilt `dist/`; a denied host process-list observation
then interrupted the harness. Both host failures were retained. The remaining
19 attempts stayed unrun, and the series was not repeated. Observation failures
are now handled and covered by timeout/permission-denial regressions; builds
and subsequent device runs were serialized.

The release fixed series ran once and passed all 60 fixture checks with 60
canonical envelopes and a live independent reader. The two injected debug
queries are accounted for separately above. No natural transport failure was
captured in this follow-up. These results neither erase the interrupted debug
series nor establish complete reliability.

Matching APK SHA-256:

- Debug: `d70263154b535d57b08d0c6935f6bfa43dbe539ece863c84011e5e84ebc99415`.
- Release: `a454378ffca04a84d42f066879425d9221e043118d9c0edfa8c3b3a411a3be25`.

Both complete debug/release hierarchy fixtures passed once, including five query
comparisons, XML/MCP/PNG parity and Display & touch. Node build and all 1,566
Node tests passed. Seven harness regressions cover outcome separation,
no-replay sequencing and observation failures. A live observation-only check
retained denied host-process access and still completed all three device
observations. Both APKs built; Android runtime source was unchanged and its
unit suite was not rerun in this follow-up. The initial restricted Gradle-cache
access failure remains in private accounting before the authorized build.


### Correlated reader and publication diagnostics

The reader keeps a bounded, metadata-only timeline in memory for each command.
It records process creation and confirmed spawn separately, first stdout/stderr,
broadcast callback entry, dispatch, deadline start/expiry, exit, close, settlement,
and cleanup requests/results. Times are monotonic milliseconds since the wait
began, with a wall-clock start timestamp for cross-process comparison. Output
counters and last-output times update without adding per-chunk events. The
32-event limit has an explicit dropped-event counter. Stream metadata uses
`stdoutBytes`, `stderrBytes`, `lastStdoutElapsedMs` and `lastStderrElapsedMs`,
so MCP preserves it while continuing to remove raw stdout/stderr fields.

The failure response includes `details.reader`. The existing host logger writes
`result_reader.failure` at warning level on failure and preserves late exit/close
observations separately. Command/task/device identities accompany those events;
the JSON message contains Operator package, settlement code, chunk progress and
reader metadata.
This does not copy UI contents, raw stderr or command payloads into new logs.
Timeline logger failures do not change the result. Existing user-selected log thresholds
still apply. A host killed before settlement may never flush this in-memory
record; absence of the log is not evidence that the reader never started.

Compare event order before drawing a causal conclusion. An `exit` before
`cleanup_requested` was observed before this reader requested termination; it
does not identify an external initiator. An exit after cleanup may reflect that
request, but ordering alone does not prove causality. The returned failure is
an immutable settlement-time snapshot, while late lifecycle log events may
show the subsequent exit and pipe closure. No deadline or dispatch behavior is
changed, and no uncertain execution is replayed.

Android emits `[Clawperator-Publication]` followed by a single JSON object with
`commandId`, `taskId`, `event`, `byteLength`, `recordCount`, `chunkCount`,
`writtenRecords`, and monotonic `elapsedMs`. Events are `started`,
`writes_completed`, or `write_failed`. A small unchunked result has one record
and zero chunks. Identifiers are JSON-escaped; no result payload or exception
message is copied into these markers. `writtenRecords` counts logging calls
that returned. Diagnostic-write exceptions cannot block canonical publication,
and canonical-write exceptions retain their existing failure behavior.

`writes_completed` means only that publication writes returned. It is not a
logd or host delivery acknowledgement. The result reader may stop on the last
result record before that marker arrives, so use the independent observer or
bounded device-buffer capture when checking publication completion. These
markers share logcat's loss characteristics; missing markers are inconclusive.
The historical cause remains open. GitHub verification is optional under the
current release decision linked above.


### Diagnostic verification and current release limits

The diagnostic work merged in `b7ff0695` (PR #290). Validation passed all 1,571
Node tests, 59 app/Operator Android unit tests, both APK builds and documentation
route checks. Each matching debug/release
API-35 series ran once and passed 60/60 delivery and fixture checks. Separate
controlled reader disconnects retained exit 255 before host cleanup, while an
independent stream validated successful canonical publication and both markers.
The final release capture also verified persistence at the default log level
and preservation of timeline metadata through MCP redaction. An initial Android
test assertion about coroutine exception object identity failed; it was corrected
to check propagated type/message, and the failed attempt remains in private
accounting. No natural recurrence was captured, and no causal or release gate
is closed by these checks.


### Release-owner disposition for 0.11.0

On 13 September 2026, the release owner deferred the unresolved historical
reader-exit investigation until more information becomes available. This known
limitation is not a blocker to 0.11.0; the decision does not establish a root
cause or claim that result delivery is failure-free. Existing structured errors,
dispatch uncertainty and the prohibition on replaying uncertain mutations remain
unchanged. Resume the separate transport investigation when new natural-failure
evidence provides a useful diagnostic lead, preserving the original failures and
independent host/device observations.
