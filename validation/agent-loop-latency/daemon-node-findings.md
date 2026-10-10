# Physical daemon-backed CLI versus persistent Node

Measured 2026-10-10 using source commit `9a83c76e` from PR #395, whose benchmark/runtime sources are unchanged from merged PR #394 (`1c816a7d`). This follows [the no-daemon comparison](persistent-node-findings.md). No production source, example policy, device setting or APK changed.

## Question and controlled method

Compare the normal daemon-backed CLI with the experimental persistent controller on the same physical Pixel 10 Pro, API 37, portrait 1080 x 2410, development Operator, and branch-local CLI. Jev remains `jev-1.13.0`; stock full-resolution screenshots, compact snapshots, candidate selection, prompt, eight-action/30-second delegation budget and independent terminal verification remain unchanged. Jev consumes snapshot-derived text, not screenshot bytes. No Decisions calls or direct-buffer helper are involved.

The daemon arm runs the existing three phase helpers and fresh CLI children, with normal daemon routing enabled. An ignored private copy of `examples/skills/utils/` removes exactly the single `--no-daemon` argument from `settings_version_runtime.js`; all other helper files are byte-identical. A private copy of the benchmark points to those helpers and the original build and summary module. The unmodified production CLI retains normal startup, socket/version/ownership checks, dispatch and fallback semantics. `ANDROPERATOR_NO_DAEMON=0` is explicit. No wrapper process is added to individual commands. Raw summaries call this arm `cli`; the trial manifest and analysis identify it as daemon, supported by actual routing evidence rather than the label alone.

The persistent arm runs the original `--backend persistent` benchmark unchanged: one controller and one worker per task, canonical Node CLI handlers, no-daemon execution and existing process-local readiness caching. This is a whole execution-path comparison, not an isolated HTTP/socket, cache or Node startup microbenchmark. Both paths can reuse the existing eight-second readiness cache inside their respective long-lived process; cache hits were not separately instrumented.

Task time includes helper/controller startup, canonical commands and per-command readiness, provider calls, observations, terminal proof, evidence writes and helper/worker shutdown. Pre-trial doctor and a separate no-daemon Settings reset are excluded. The daemon stays alive between tasks, representing ordinary reuse; its startup is included only in the separately reported cold pilot, and daemon shutdown is excluded. Each persistent worker is new per task. A live daemon does not imply a warm readiness cache at every task boundary. No OS/Operator restart, animation tuning, thermal control or fixed inter-command sleep was used. The host was not reserved or quiescent: brief local inspection and one interim saved-PNG/evidence analysis ran during the batch. This possible host contention is a measurement limit, not device/model work attributed to either path. One serialized device controller owns this experiment.

Protocol: confirm no daemon initially exists, run one cold daemon pilot and one persistent pilot, then five alternating pairs (daemon/persistent, persistent/daemon, daemon/persistent, persistent/daemon, daemon/persistent). Retain every attempt; stop on readiness or task failure rather than silently replace a trial. Follow with independent saved-evidence and pixel audits and cleanup.

## Results

Five measured tasks per arm passed. Median task time was **25.42 s daemon versus 21.65 s persistent**, an observed **3.77 s (14.8%) reduction**. All five paired differences favored persistent execution.

| Metric | Daemon-backed CLI | Persistent Node |
| --- | ---: | ---: |
| Verified measured tasks | 5/5 | 5/5 |
| Task median | 25.422 s | 21.648 s |
| Command-total median | 24.154 s | 20.424 s |
| Four Jev requests, median total | 1.048 s | 1.060 s |
| Other orchestration, median | 0.214 s | 0.129 s |
| Task mean | 25.199 s | 21.832 s |
| Task range | 23.890-26.131 s | 20.874-23.514 s |

| Pair | Order | Daemon | Persistent | Saving |
| --- | --- | ---: | ---: | ---: |
| 1 | daemon/persistent | 25.485 s | 20.874 s | 4.611 s |
| 2 | persistent/daemon | 26.131 s | 23.514 s | 2.617 s |
| 3 | daemon/persistent | 25.067 s | 20.907 s | 4.160 s |
| 4 | persistent/daemon | 23.890 s | 21.648 s | 2.241 s |
| 5 | daemon/persistent | 25.422 s | 22.214 s | 3.208 s |

Median paired saving: **3.208 s**. This differs from the difference of arm medians because values are ranked separately. The range of paired savings is 2.24-4.61 s. Five pairs cannot establish a reliable tail percentile or general performance guarantee.

Excluded pilots: cold daemon **25.710 s**, persistent **20.791 s**, both verified. The single cold-versus-warm comparison is not an estimate of daemon startup cost. No pilot or measured task failed; no attempt was replaced.

Mean time per task, grouped by command (these are sums across each task, not individual-call means):

| Operation | Calls/task | Daemon | Persistent | Saving |
| --- | ---: | ---: | ---: | ---: |
| open | 1 | 0.925 s | 0.820 s | 0.105 s |
| click | 1 | 0.754 s | 0.872 s | -0.118 s |
| scroll | 3 | 3.841 s | 3.550 s | 0.291 s |
| screenshot | 8 | 10.508 s | 8.994 s | 1.514 s |
| snapshot | 7 | 6.582 s | 5.257 s | 1.325 s |
| read-value | 2 | 1.307 s | 1.116 s | 0.191 s |
| All commands | 22 | 23.918 s | 20.610 s | 3.308 s |
| Jev | 4 | 1.063 s | 1.095 s | -0.032 s |
| Other orchestration | - | 0.219 s | 0.127 s | 0.092 s |

Mean task saving is **3.367 s**; command spans account for **3.308 s**. Jev mean totals are 1.063 versus 1.095 s, so faster model replies do not explain the benefit. Screenshot plus snapshot command sums explain 2.839 s of the mean difference. These spans include client execution, readiness, daemon dispatch where applicable, device work and result presentation; they are not isolated screenshot capture or wire latency.

## Reliability and routing evidence

- 12/12 completed tasks after readiness: two pilots and ten measured tasks. No readiness failures in this batch, failed task commands, failed/retried provider requests, discarded tasks or replacements.
- All 12 saved terminal proofs passed independent revalidation against their original envelopes, snapshot rows and read-value references. Extracted fields, full command-name sequence and navigation arguments matched across both arms.
- Every task used 22 commands: one open, one click, three scrolls, eight screenshots, seven snapshots and two read-value calls, plus four accepted Jev choices. Across all tasks: **264 commands and 48 accepted Jev requests**.
- All **96 PNGs** fully decoded at **1080 x 2410**. The independent local OCR audit recognized About phone in all **24 post-click and terminal images**. Both final-pair post-click images were also manually viewed. No stale old-page post-click image was detected by these checks.
- All **132 daemon-arm commands** across the cold pilot and five measured trials matched one `/execute` request per command and one dispatch plus one received envelope with matching runId/commandId/taskId in the daemon log. Response diagnostics pointed to that same daemon log. No silent direct fallback or duplicate dispatch was detected. This count excludes readiness/reset/cleanup.
- Exactly one server-start event was recorded. Daemon PID and branch-local build identity were unchanged from after the cold pilot through the end of the measurements. The persistent arm remained explicitly no-daemon.

The daemon inherited the first caller's log destination, so later requests' runtime logs remain in the cold pilot's log directory while fresh CLI logs also exist in individual trial folders. The audit reads the actual response diagnostics and central daemon log; reading only each later trial's local log folder would miss daemon evidence. Private retained logs are not published.

Title recognition is an independent post-run check, outside measured time, not a rendering barrier in the task. It does not prove every animated/scrolling row is settled or make screenshot and snapshot atomic. The sample is one familiar text-rich route on one phone. No intentional lock during the readiness cache lifetime, disconnect, daemon crash, timeout, incompatible build, or post-dispatch failure was tested live. Normal success does not establish recovery safety. Existing proxy/lifecycle tests are reported separately below.

## Interpretation and follow-up

Persistent execution still helped against the real daemon-backed path, but the measured median benefit is **14.8% here**, not the **28.3%** found against fresh no-daemon CLI processes in the earlier batch. These are distinct measured baselines; comparing absolute times between batches is contextual, not another randomized three-arm comparison.

The existing daemon already provides reusable execution state. This experiment does not justify creating a second daemon. Remaining overhead is consistent with repeated client startup, imports, proxy checks, request transport and presentation, but the current command spans cannot attribute the measured difference among those components. Keep that distinction explicit: the residual difference is measured; its detailed cause is not yet isolated.

Keep independent result verification and visual evidence. Production work should reuse canonical validation, correlation and fail-closed mutation handling. Measure client/startup, daemon health/version checks, socket round trips, readiness and device work separately before choosing a production API shape. Do not transplant the experimental synchronous worker bridge into production based on these timings. A persistent client to the existing service is a candidate to measure, not an implemented or validated recommendation to add another daemon.

Rendering contracts, reduced-buffer capture and wider model/device evaluation remain separate planned work. Do not add this experiment's percentage to prior screenshot or Decisions improvements. The earlier no-daemon comparison remains valid for its explicitly different baseline; it was not a measurement of the normal CLI.

## Validation, retention and reproduction

The previously built branch-local Node CLI and matching installed development Operator were reused. No tracked runtime or helper source changed, and no Android build/install was needed. Doctor passed critical readiness/version checks. Existing focused benchmark/example tests passed **24/24**; existing daemon lifecycle/proxy/action tests passed **66/66**. These are unit/fixture tests, not substitutes for live failure-injection coverage.

After measurement, canonical Back succeeded and a fresh snapshot verified the Settings root via its Search Settings bar and top-level category rows. The owned benchmark daemon was stopped; canonical status then reported `not_running`, restoring its initial state. Device settings were unchanged. No capture helper was deployed and no external artifact was published. Temporary dependency linkage was removed after verification. All original notebook entries remain preserved; this report adds the normal-daemon comparison to the earlier measurements.

Use the same checkout and existing installed dependencies; build its Node CLI if needed. Supply the authorized `JEV_API_KEY` only through the environment. Select an explicit physical device and development Operator. Confirm initial daemon state with the canonical `daemon status` command; do not stop someone else's daemon merely to manufacture a cold measurement. This run began with no daemon.

To reproduce the experimental daemon helper without editing tracked sources, create a new ignored/private directory, copy `examples/skills/utils/` there, and delete only `,'--no-daemon'` from the argv construction in the copied runtime. Verify that this is the sole helper difference. Copy `validation/agent-loop-latency/benchmark.cjs` into that directory and change only its root constant to the absolute original checkout, its `summary.cjs` import to the original absolute module, and its helper path to the copied helper. Use this copy only with `--backend cli`. It preserves the canonical doctor and no-daemon reset. Run the original benchmark with `--backend persistent` for the other arm. All output directories must be new.

Run the cold daemon and persistent pilots first, then the five alternating pairs. Keep the daemon alive across measured trials. Match all daemon task commands to `/execute` requests and single dispatch/envelope log entries with their runId, commandId and taskId; verify response log provenance and daemon build identity/PID. Count fallback or unmatched commands rather than silently treating the request as daemon-backed. Re-run terminal evidence validation, compare navigation arguments and extracted fields locally, fully decode PNGs, then check post-click and final image pixels independently. Preserve all failures and explicitly label pilot and measured samples.

Private evidence lives in the measurement worktree's ignored `tmp/daemon-node-20261010/`: both pilots, five trials per arm, copied experimental helpers/harness, raw results, provider logs, PNGs, source hashes, routing audit, timing analysis, OCR audit and cleanup records. This report includes only sanitized aggregates and reproducible methodology; credentials, serial, private extracted values and machine paths are excluded.
