# Persistent CLI execution in the existing daemon

Date: 2026-10-10. Production candidate based on merged #396 (`b0fdeaf5`),
runtime checkpoint `4aa82c5a`. This is separate from the experimental forwarding
worker in #397. No Android APK or third-party dependency changes.

## Result

The integration works on the tested phone, but this batch does **not demonstrate
an end-to-end speedup**. Five alternating pairs had median task time **28.113 s
baseline versus 28.158 s candidate** (0.16% slower). Mean time was **28.226 s versus
28.079 s** (0.52% faster). Two pairs improved and three regressed. The effects are
small relative to run-to-run variation; do not describe this as the earlier
14.8% experimental in-process improvement or the separate 5.1% forwarding result.

A narrower measured boundary improved: parent command start to daemon HTTP request
arrival fell from **86.5 to 69 ms median**, 110 successful commands per arm. The
sum of that boundary fell by 347 ms per task on average. These are millisecond
wall-clock log timestamps on one host, not exclusive CPU measurements. Candidate
parsing occurs after arrival, so this boundary alone is not total command work.
The later, common `preflight.apk.pass` marker was 295 versus 281.5 ms median from
parent start; that interval also includes runtime/device readiness work.

A separate invalid-input probe regressed: `snapshot --max-nodes invalid` took
**43.06 versus 69.72 ms median**, 50 samples per arm in baseline/candidate/candidate/
baseline blocks, with three discarded warmups per block. Both returned identical
stdout, empty stderr and exit 1, with zero device dispatches. Baseline rejects
this locally; the candidate probes and visits the warm daemon before canonical
validation. This is an error-path tradeoff, not a like-for-like device transport
benchmark. Do not multiply either microbenchmark result into a promised task gain.

## Implementation and compatibility

The CLI still accepts the same commands and flags. A thin Node launcher can send
eligible calls to the existing owned daemon's private `/cli` endpoint. There is
no second worker process or new public agent API. Canonical parser and command
handlers run with request-local stdout, stderr, exit status, normalized run ID,
log destination and warning sink. Async context prevents recursive daemon proxying.
The daemon does not mutate global arguments, environment, directory or streams.

The initial fast path covers command-first `open`, `close`, `click`, `scroll`,
`snapshot`, `screenshot`, `read-value` and `press`, with default timeouts and JSON
output. Aliases, global flags before the command, pretty output, help, explicit
timeouts, `--no-daemon`, unsupported commands and Windows keep the existing path.
The existing bundled Jev helper still explicitly disables the daemon; this
comparison uses the documented private helper adaptation below.

Requests require matching owned daemon build/version, working directory and full
environment digest, excluding the per-request run ID and log directory. Environment
values and credentials are not forwarded. A mismatch declines before execution;
relative paths keep their caller-directory meaning. The first cold command uses
the existing daemon startup/proxy path. Existing readiness, execution conflict,
validation and command/task correlation remain in the canonical runtime.

Only a correlated pre-execution decline or known connection failure can fall
back locally. Once a POST may have executed, a lost, truncated, malformed or
mismatched response returns `DAEMON_PROXY_ERROR` with unknown dispatch state. It
never replays the action. The private endpoint is absent from ordinary TCP serve.
A thin Node process, ownership verification, version request and IPC remain per
call; this is not equivalent to reusing Node inside an agent process.

## Physical comparison

One physical Pixel 10 Pro on API 37, stationary portrait, 1080 x 2410 stock PNG
screenshots, development Operator. Both arms used the same Jev Settings workflow,
providers, observations, navigation, completion checks and logging. Each task had
22 commands: one open, three scrolls, one click, eight screenshots, seven snapshots
and two value reads. Each had four accepted Jev choices with no failed attempts.

| Pair | Order | Baseline seconds | Candidate seconds | Saving seconds |
| --- | --- | ---: | ---: | ---: |
| 1 | baseline, candidate | 27.630 | 28.010 | -0.380 |
| 2 | candidate, baseline | 29.143 | 28.158 | +0.984 |
| 3 | baseline, candidate | 28.265 | 28.519 | -0.254 |
| 4 | candidate, baseline | 27.980 | 28.664 | -0.683 |
| 5 | baseline, candidate | 28.113 | 27.044 | +1.069 |

Positive saving means faster candidate. Baseline range: 27.630-29.143 s;
candidate: 27.044-28.664 s. All 5/5 tasks passed in each arm.

Mean time per task, seconds:

| Component | Baseline | Candidate |
| --- | ---: | ---: |
| Whole task | 28.226 | 28.079 |
| All command calls | 26.945 | 26.762 |
| Jev requests | 1.083 | 1.096 |
| Other work | 0.198 | 0.220 |

Mean command time per task, summed across occurrences, seconds:

| Command | Baseline | Candidate |
| --- | ---: | ---: |
| `open` | 1.039 | 1.181 |
| `click` | 0.747 | 0.700 |
| `scroll` | 4.444 | 4.342 |
| `screenshot` | 12.171 | 12.213 |
| `snapshot` | 7.106 | 7.040 |
| `read-value` | 1.438 | 1.287 |

These command durations include host startup, transport, readiness, Android work,
result processing and exit. They are not isolated implementation costs. Eight
screenshots alone account for about 12.2 s per task; screenshot capture behavior
is unchanged by this PR.

Two preliminary pilots passed at 27.624 s baseline and 28.135 s candidate. They
preceded the run-ID normalization fix and are retained separately, excluded from
the primary table. There were no failed or discarded primary trials. The primary
runtime build was frozen for all ten tasks; no builds or test suites ran during
the batch.

### Reproduction method

Use the existing `benchmark.cjs`, summary module and Settings helper as the
measurement base. In a private helper copy remove only the hardcoded
`--no-daemon` argument. Point each arm at its own built CLI, while using the same
helper copy and working directory. Keep explicit device and development package
selection. Do not alter provider choices, observation checks or retry budgets.

Construct the complete helper environment first, including run directory, CLI
path, device, skill ID, timing and logging variables. Start a fresh owned daemon
with **that exact environment and cwd** before the task timer. Starting it from a
different outer harness environment would correctly decline this optimization
and invalidate the comparison. Refuse to replace an unrelated running daemon.

Doctor readiness, Settings close/reset, daemon status/start and daemon stop are
outside the task clock. Time the existing `open`, `jev` and `finish` helper
processes, including command startup/exit, provider time, evidence writes and
terminal verification. No extra device command primes the candidate. Alternate
five pairs after pilots; retain failures and their original budgets. Audit the
actual endpoint used, not just the selected arm label.

Raw local evidence is retained under ignored `tmp/production-comparison/` in the
implementation worktree: private harness/helper copies, trial summaries, command
ledgers, PNGs, snapshots, logs, provider records, routing/visual audits and host
probe data. These contain device/UI identifiers and must not be committed.

## Reliability and validation

- All 12 retained tasks had identical command sequences, navigation selectors and
  extracted fields. All **96 PNGs** decoded at 1080 x 2410. Independent macOS Vision
  audits verified **24/24** post-click and final About phone titles. This verifies
  those saved frames; it does not introduce a production rendering gate.
- All **264 task commands** matched their run/command/task IDs to exactly one
  dispatch and terminal envelope. Each candidate task used 22 `/cli` requests;
  each baseline used 22 `/execute` requests. Every owned trial daemon stopped.
- Ten additional physical commands verified cold startup, warm execution,
  relative screenshot output, changed-environment and changed-cwd fallback,
  explicit direct execution, stop/restart, and stale-build recovery from the
  baseline daemon. All ten had one dispatch and one matching envelope. Routing
  showed six `/cli` attempts (two context declines) and five `/execute` requests,
  plus one explicit direct command. No uncertain action was replayed.
- Unit coverage includes an actual Unix socket dropped after receiving POST,
  truncated/mismatched responses, pre-dispatch fallback, concurrent request output
  and logging isolation, normalized run IDs, and private endpoint exposure.
  Socket loss returned unknown state after exactly one POST. This fault check is
  host-local; it does not claim physical kill-at-dispatch coverage.
- **1,498/1,498 Node tests passed**, plus build, documentation pipeline, diff checks,
  and 17 exact baseline/candidate CLI stdout/stderr/exit comparisons covering
  help, version, invalid/missing values and supported flag placement.
- The initial refactor exposed an MCP stdin-close exit regression caused by
  top-level await. It was fixed before primary measurements; existing MCP tests
  passed in the full suite. Independent review found padded run IDs were accepted
  but logged without normalization; the fix and regression check are included.
- Cleanup explicitly closed and reopened Settings, verified its root hierarchy,
  and stopped the owned daemon. A simple open initially resumed the prior page;
  that was not treated as proof of returning to root.

## Interpretation and remaining work

This completes a working integration candidate, not evidence of a substantial
user-visible speedup or broad reliability certification. The known-route sample
is small and covers one phone/host. Concurrent output is covered with controlled
handlers; device execution conflicts retain existing tested runtime policy.
Default-device selection, platform fallbacks and uncommon caller contexts are
not all physically exercised. Long-lived memory use and a wider device/task mix
remain unproven.

The previous experimental in-process and separate-worker results came from other
paths and batches. Retain them as motivation, not as rollout predictions. This
production path preserves stronger caller-context and ownership checks, and the
measured request-arrival saving is modest. Review the added complexity against
that limited benefit; these timings do not justify promising a faster full loop.

Reliable post-action rendered-destination evidence and a maintained reduced-buffer
screenshot helper with full-resolution fallback remain separate follow-ups.
Broader device/vision tests and Decisions skill packaging also remain separate.
No screenshot policy, rendering wait, provider or Android internal API is changed
by this integration.
