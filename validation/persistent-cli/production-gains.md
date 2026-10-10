# Persistent CLI launcher follow-up

This follow-up starts from merged #397 (`e0fb9a00`). It retains the production
request-scoped integration developed in #398, then reduces work in the short-lived
CLI launcher. CLI commands and flags remain unchanged. This is a transparent
optimization for eligible commands using a compatible warm daemon, not the
in-process API used by the earlier 14.8% experiment.

## What changed

The installed executable starts in CommonJS and loads only the forwarding path.
The canonical parser and handlers remain in the daemon's existing ESM runtime.
The old `node dist/cli/index.js` entry remains supported. Environment identity uses
deterministic string ordering instead of initializing locale-aware collation.
A non-interactive successful forwarded request does not load the already-suppressed
interactive star hint. Example helpers and release archive checks recognize the
new executable.

Ownership, build identity, full ambient environment matching, caller directory,
request validation, readiness, result correlation, logging and uncertain-dispatch
handling are retained. No screenshot, snapshot, readiness TTL, rendering wait,
provider choice or Android behavior was changed. A lost response after a connected
POST returns an uncertain result; it does not replay the action locally.

The eligibility restrictions and fallback behavior are documented in
[daemon API](../../docs/api/daemon.md). A cold daemon or incompatible caller context
still uses the normal local CLI path. This work does not eliminate the Node process
launched by every shell command.

## Why the earlier results differed

The earlier in-process experiment removed per-command process startup and most
client/daemon plumbing. Its 14.8% median whole-task improvement is not a prediction
for a shell-compatible launcher. The separate forwarding prototype (#397) still
started Node per command and measured 5.1% median improvement. The first production
integration (#398) measured essentially no whole-task improvement and retained
more launcher overhead than that prototype.

A new diagnostic comparison used frozen, instrumented copies of main, the separate
forwarding prototype, #398, and the in-process worker on the same physical phone.
There was one pilot and three measured tasks per path. Mean times per task:

| Path | Whole task | Canonical execution | Outside canonical execution |
| --- | ---: | ---: | ---: |
| Main daemon-backed CLI | 30.466 s | 27.011 s | 2.104 s |
| Separate forwarding prototype | 28.887 s | 26.315 s | 1.212 s |
| #398 production forwarding | 29.431 s | 26.372 s | 1.787 s |
| In-process worker | 26.776 s | 25.306 s | 0.122 s |

Outside execution means the sum of parent-measured command durations minus the
correlated `runExecution` spans; it excludes provider time and helper work between
commands. These columns do not add to whole-task time. Instrumentation and a short
concurrent build attempt make this a diagnostic batch, not an acceptance speedup
claim. The prototype pilot lacked worker-side client trace flushing; that was
corrected before the three primary diagnostic rounds.

#398 retained about 575 ms/task more non-execution overhead than the forwarding
prototype. Its cold environment identity calculation took about 7.3 ms per client,
versus about 0.35 ms in the warm server. Its CLI module-ready mark was about 33.8 ms
from process time origin, with preload ready at about 18.0 ms. Typical ownership
checks were around 6 ms; a slower early pilot was not a reason to remove them.
The lighter launcher targets initialization work while preserving those checks.

Canonical execution also varied. The three daemon paths recorded 18 cached and
four fresh readiness checks per timed task; the faster in-process path recorded
19 cached and three fresh checks under the same existing TTL. This natural timing
effect, device work and provider variability must not be credited entirely to
client startup. No TTL or observation requirement was relaxed.

## Physical acceptance procedure

The uninstrumented comparison uses the installed entry from this branch and the
merged-main production build. Device: Pixel 10 Pro, Android API 37; host: macOS
arm64, Node 24.11.1; Operator: matching development package. Device identifiers,
UI values, raw logs and local paths stay in ignored local artifacts.

Each trial runs the existing Settings version-details Jev workflow: 22 commands,
including eight full-resolution PNGs, seven snapshots, four navigation actions
and two independently checked value reads. The route, returned fields, command
sequence and screenshot dimensions must match. No new screenshots policy is used.
The copied benchmark helper enables its normal daemon path by removing its
experimental forced `--no-daemon` flag in both arms.

Readiness, Settings reset and owned daemon startup occur before the task clock;
daemon shutdown occurs after it. Each trial starts a fresh owned daemon with the
same environment and directory as its caller. Run ID and log directory may vary
per request, as supported by the production contract. A pilot precedes five
alternating pairs. Builds and tests do not run during the primary timed batch.

One initial candidate pilot failed before device dispatch because the example
helper tried to execute the non-executable `.cjs` build directly. The helper fix
and regression test preceded the successful retry and all primary pairs. The
failed trial is retained and excluded from timing aggregates.

## Uninstrumented results

Measured on 2026-10-10. Times are seconds; positive saving favors the candidate.
The sequence alternated baseline-first and candidate-first pairs.

| Pair | Main | Candidate | Saving |
| --- | ---: | ---: | ---: |
| 1 | 28.766 | 29.032 | -0.266 |
| 2 | 30.060 | 28.723 | 1.338 |
| 3 | 30.069 | 28.519 | 1.550 |
| 4 | 29.654 | 29.872 | -0.218 |
| 5 | 29.791 | 29.155 | 0.637 |
| Median | 29.791 | 29.032 | 0.759 (2.55%) |
| Mean | 29.668 | 29.060 | 0.608 (2.05%) |

Three pairs improved and two regressed. This small single-device sample establishes
a modest observed improvement, not a reliable 14.8% whole-task speedup. Successful
pilots were 30.886 s and 28.267 s; neither is included in these aggregates.

| Mean task component | Main | Candidate |
| --- | ---: | ---: |
| All command calls | 28.291 s | 27.661 s |
| Jev requests | 1.178 s | 1.198 s |
| Other helper work | 0.199 s | 0.202 s |

Existing parent event timestamps and daemon request logs give a separate,
uninstrumented arrival boundary. Across 110 commands per arm, median time from
parent command start to daemon request receipt fell from **83 ms to 53 ms**. The
mean sum per task fell from **1,861 ms to 1,125 ms**, saving **736 ms/task**. This
boundary includes caller startup, checks and IPC; it is not pure module loading.
The candidate's request arrives before server-side parsing, while the baseline's
arrives after client-side parsing, so it is not a complete measure of net client
work saved. It should not be added to the task saving or compared as an identical
boundary to the earlier diagnostic canonical spans.

A separate invalid-input ABBA check used 50 samples per arm, excluding three
warmups per block, with byte-identical stdout/stderr and exit codes. Median time
was **43.66 ms main versus 46.83 ms candidate** (3.18 ms slower). Invalid command
validation is not a speedup claim. The previous #398 batch measured 43.06 versus
69.72 ms; those older timings are context, not a same-batch comparison.

## Reliability and validation

- All ten primary tasks and both successful pilots had the same route, command
  sequence and extracted fields, four accepted Jev choices per task, and no
  provider or command failures. The pre-dispatch helper failure above is separate.
- All 96 retained full-resolution PNGs from those 12 tasks passed decoding and
  metadata verification at 1080 x 2410. Independent pixel recognition confirmed
  the About phone destination title in all 24 post-click/final screenshots.
- Each of 264 commands had one matched request on the intended route
  (`POST /execute` on main, `POST /cli` on the candidate), exactly one dispatch
  and one correlated envelope. Run IDs, task/command IDs and caller log paths
  matched. Every trial's owned daemon stopped successfully.
- The 16 diagnostic tasks also returned matching route, fields and commands:
  352 successful commands, 128 verified PNGs and 32/32 rendered-title checks.
- Ten additional physical smoke commands covered cold/warm operation, a relative
  screenshot path, changed environment and directory fallback, explicit
  `--no-daemon`, stop/restart, and replacement of a stale main-build daemon.
  Each had exactly one dispatch and one matching envelope.
- Node build and all 1,500 Node tests passed. The retained prototype suite passed
  3/3; example skill tests passed 20/20; release validation tests passed 4/4;
  docs build passed. The full suite includes a real socket loss after receipt of
  one POST with no resend, declined/uncertain-response handling and interleaved
  logging/output isolation.
- The actual npm archive passed release validation (367 files). Its installed
  CommonJS entry and compatibility ESM entry both returned the expected version
  and structured usage error. An initial private smoke assertion expected the
  wrong error code; the existing `USAGE` contract was retained and the corrected
  assertion passed.
- Independent review found the release validator still required the old executable
  and confirmed the example-helper extension failure. Both were fixed with tests.
  Final full-branch review is recorded in the PR.

The package-entry and helper fixes do not change timed runtime behavior. No build
or runtime edit occurred during the five primary pairs. Physical disconnects,
multiple concurrent device workflows, Windows, other phones and long-lived memory
use are not certified by this sample. Failure/no-replay cases are controlled tests;
the successful physical route does not prove every failure mode.

## Decision and remaining work

This recovers some overhead lost between the forwarding prototype and #398,
while retaining production checks. It does **not** reproduce the in-process gain.
The diagnostic main path only spent about 2.1 s/task outside canonical execution;
the in-process worker reduced that to 0.12 s. This CLI still launches Node for
each command and must verify daemon ownership and transport the request. The
remaining startup floor and variation inside Android execution limit the gain.
The earlier percentages came from different baselines and batches, including
natural readiness-cache timing differences, and cannot be promised here.

Review the integration's complexity against a 2% mean observed task improvement.
It is a measured candidate, not justification to weaken checks or declare the
latency goal complete. The next larger bottlenecks remain reliable rendered-state
checks and maintained reduced-buffer screenshots with full-resolution fallback.
A genuinely in-process client remains an optional separate API direction, with
an adoption tradeoff; it is not silently equivalent to existing shell usage.

Reproduction requires two clean builds, an explicit unlocked physical device,
Jev credentials, the existing Settings helper and a fresh output directory per
trial. Follow the procedure above and retain raw evidence locally. The private
batch drivers, traces, audits and frozen diagnostic builds are not production
code or committed fixtures. Readiness/setup/cleanup time is excluded from the
warm task result and must be reported separately for cold-start product claims.

