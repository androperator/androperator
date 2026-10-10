# Physical persistent Node execution comparison

Measured 2026-10-10 from main commit `1c816a7d` (merged experimental benchmark PR #394). This report completes the previously blocked persistent-process comparison. No production runtime, default behavior, provider policy or device settings changed.

## Question and method

Does retaining Node command-handler state reduce whole-agent latency without changing the work or weakening the tested outcome? Compare the existing `cli` and `persistent` benchmark modes on a physical Pixel 10 Pro, API 37, portrait 1080 x 2410, using the development Operator and branch-local Node build.

Both arms use the same Jev model (`jev-1.13.0`), prompts, candidate policy, four-choice route, stock full-resolution screenshots, compact snapshots and independent snapshot/read-value completion checks. Daemon routing is disabled in both arms. No direct-buffer helper, reduced-size capture, Decisions adapter or new rendering gate is used. This isolates the existing persistent-controller path against fresh CLI calls, not against the product's normal daemon-backed path.

The persistent mode runs open, Jev delegation and finish in one controller, with a long-lived worker invoking the existing Node CLI handlers. The CLI mode starts individual CLI children and separate phase helper processes. This changes process startup, module initialization and process-local state reuse, including the existing eight-second readiness cache. It does not isolate the cache's contribution from other startup costs, and it does not introduce a different Android result transport.

The task clock includes controller/worker startup, canonical actions, all observations, provider calls, final evidence and shutdown. Pre-trial doctor/readiness and the separate Settings reset are excluded; per-command readiness remains inside command timings. Each task starts fresh host processes; OS/Operator are not rebooted between tasks. No animation, display, rotation, transport or cache settings were tuned. Runs are serialized on one explicit device; host/device scheduling and thermal state are uncontrolled.

Protocol: one persistent pilot, one CLI pilot, then five matched pairs in alternating order (CLI/persistent, persistent/CLI, CLI/persistent, persistent/CLI, CLI/persistent). Pilots and failed readiness are retained separately and excluded from timing aggregates. No failed measured task may be replaced.

## Results

Five measured tasks per arm completed, with no task failure or replacement. Median end-to-end time fell from **30.78 s to 22.08 s**, an observed **8.70 s (28.3%) reduction**.

| Metric | Fresh CLI | Persistent Node |
| --- | ---: | ---: |
| Verified measured tasks | 5/5 | 5/5 |
| Task median | 30.78 s | 22.08 s |
| Task mean | 30.85 s | 22.33 s |
| Task range | 30.26-31.24 s | 21.55-23.14 s |
| Command-total median | 29.30 s | 20.69 s |
| Four Jev requests, median total | 1.22 s | 1.25 s |
| Other orchestration, median | 0.20 s | 0.13 s |

| Pair | Order | Fresh CLI | Persistent Node | Saving |
| --- | --- | ---: | ---: | ---: |
| 1 | CLI/persistent | 30.259 s | 21.907 s | 8.352 s |
| 2 | persistent/CLI | 31.242 s | 23.137 s | 8.105 s |
| 3 | CLI/persistent | 31.219 s | 22.998 s | 8.221 s |
| 4 | persistent/CLI | 30.733 s | 21.549 s | 9.185 s |
| 5 | CLI/persistent | 30.778 s | 22.075 s | 8.703 s |

All five paired differences favored persistent Node, ranging from 8.11 to 9.18 s; median paired saving was 8.35 s. The paired median differs from the difference of arm medians because samples are ranked differently. Five pairs do not establish a general latency guarantee or a reliable tail percentile.

The excluded pilots were 22.66 s persistent and 30.61 s CLI. The earlier blocked pilot never started the task and has no task duration; its readiness failure is retained, not pooled with completed-task timings.

### Where time changed

The following are **mean totals per task**, so operation costs can be added subject to rounding. They include all host/device work inside each command, not isolated Android execution or wire time.

| Operation | Count per task | Fresh CLI mean | Persistent mean | Saving |
| --- | ---: | ---: | ---: | ---: |
| open | 1 | 0.93 s | 0.85 s | 0.08 s |
| click | 1 | 1.07 s | 0.84 s | 0.23 s |
| scroll | 3 | 4.78 s | 3.61 s | 1.18 s |
| screenshot | 8 | 12.74 s | 9.17 s | 3.57 s |
| snapshot | 7 | 7.98 s | 5.26 s | 2.72 s |
| read-value | 2 | 1.90 s | 1.24 s | 0.65 s |
| All commands | 22 | 29.40 s | 20.96 s | 8.44 s |
| Jev requests | 4 | 1.25 s | 1.23 s | 0.01 s |
| Other orchestration | - | 0.20 s | 0.14 s | 0.06 s |

The all-commands row is the subtotal of the six operation rows, not an extra cost. Mean task saving was 8.51 s, of which 8.44 s appeared inside command spans. Mean provider time was nearly unchanged (1.247 s versus 1.232 s). This supports an execution/observation-path improvement rather than a model-speed explanation. Snapshot and screenshot command totals together account for about 6.29 s of the mean reduction. These observations do not assign the savings separately to startup, readiness caching, module loading, logging or device scheduling.

## Reliability and evidence

- Both pilots and all ten measured tasks passed independent re-verification of retained command envelopes, final snapshot rows, read-value responses and terminal evidence references. Extracted fields, full command-name sequence and navigation arguments matched across all 12 successful tasks.
- Each successful task used one open, one click, three scrolls, eight screenshots, seven snapshots and two read-value calls: 22 task commands and four accepted Jev choices. Across successful pilots and measured tasks: 264 commands, 48 accepted Jev requests, zero failed task commands and zero failed/retried provider attempts. Readiness/reset and final cleanup calls are outside these counts.
- All 96 retained PNGs fully decoded and were 1080 x 2410. No scaled image, capture helper, capture fallback or image-policy change was introduced.
- A separate post-run local OCR audit verified the About phone title in all 24 post-click and terminal images (two per successful task), with original OCR retained privately. Representative persistent post-click images from the pilot and final measured run were also visually inspected. No old-page post-click image was detected in these checks. OCR was outside the task clock and was not used to change task behavior or select actions.
- Thirteen harness invocations are retained: one initial readiness failure before the user unlocked the phone, two successful pilots and ten successful measured tasks. The failed attempt stopped before reset/navigation/provider calls; no measured attempt failed, was discarded or was replaced. This is 12/12 task completions after readiness, not an unconditional 13/13 readiness success claim.

The Jev model uses snapshot-derived text, not screenshot bytes. Successful extraction alone is not proof of current visual evidence. Post-click screenshot review is therefore reported separately. Stock screenshots are sequential with snapshots, not atomic observations; visible page title does not certify every scrolling row has settled. This small known-route sample cannot establish general reliability, image accuracy, human parity, locked-state recovery, cross-device behavior or tail latency.

The persistent worker uses the existing readiness cache, so this comparison on an awake stationary phone does not test locking the phone during its cache lifetime. Existing timeout tests verify worker poisoning and refusal to continue; no new live timeout or disconnect injection was included.

## Interpretation and next step

Keeping canonical Node command handlers alive materially reduced time in this tested workflow without changing command count, navigation or the checked evidence. The effect is large enough to prioritize process reuse over replacing the decision provider for this task. It does not require weakening screenshot or terminal verification policy.

The subsequent [normal daemon-backed CLI comparison](daemon-node-findings.md) is now complete: median 25.42 s daemon versus 21.65 s persistent, a 14.8% reduction with 5/5 verified tasks per arm. Those are separate paired measurements, not a three-arm comparison or a replacement for the 28.3% no-daemon result above. The next execution-specific step is to isolate client startup/imports, daemon checks, request transport, readiness and device work before choosing a production API. Neither comparison establishes a need for a second daemon.

Preserve canonical command semantics and independent outcome verification; do not simply move this worker bridge into production.

Post-action rendering contracts and maintained reduced-buffer capture remain separate follow-ups. These stock-screenshot results do not establish their combined speedup, and the gain must not be added to earlier percentages from other experiments.

## Reproduction and validation

Build the branch-local Node CLI and use the existing harness. Supply `JEV_API_KEY` in the environment; never write it in command examples or evidence. Each trial output directory must be new and its parent must exist.

```sh
npm --prefix apps/node run build
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/private/output/new-cli-trial --backend cli
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/private/output/new-persistent-trial --backend persistent
```

Run pilots first, alternate pair order and retain failed attempts. Independently recheck terminal envelope references, snapshot rows and read-value results. Compare navigation/command sequences and extracted fields locally; fully decode all PNGs and inspect post-click/terminal evidence. Only publish sanitized timing aggregates, not raw UI data, device identifiers, local paths or provider logs.

The branch-local Node build and all 46 focused benchmark/example tests passed before device runs. Benchmark/runtime source remained unchanged from `1c816a7d`; this PR adds the measurement report and guide references only, so no new Android build/install or unrelated runtime suite was needed. Doctor verified version compatibility and readiness after user unlock. The existing development Operator was reused.

After the trials, canonical Back succeeded and a fresh snapshot verified Settings root. No temporary capture helper was deployed and no device configuration was changed. Private ignored artifacts are retained under this worktree's `tmp/persistent-node-20261010/`, including the blocked pilot, both successful pilots, five trials per arm, original command/provider logs, snapshots, PNGs, sanitized analysis and the post-run OCR audit. No private screen values, device identifiers or credentials are committed.

This is a completed measurement of experimental tooling, not a production implementation or default change.
