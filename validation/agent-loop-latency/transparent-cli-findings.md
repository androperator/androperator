# Transparent CLI startup optimization

Measured against main `219dcf05` (merged PR #395). This implementation keeps the existing CLI commands, arguments, stdout/stderr, exit classification and daemon protocol. Agents do not need to adopt a new API or change invocation style.

## Change and scope

Daemon clients previously imported the full direct execution graph before asking the existing daemon to execute a command. A small lazy wrapper now imports that implementation only when an existing direct or fallback call actually runs. Action, execute and observation commands use it, as do shared snapshot/screenshot and notification builders' direct helpers, preventing a transitive import from defeating the boundary. The emulator storage normalizer is loaded only when an emulator command needs it.

Command construction and validation still run in the caller. Daemon ownership/build checks, readiness, command/task correlation, result formatting, relative screenshot paths and dispatch-loss behavior remain unchanged. This adds no daemon endpoint, cache, retry, connection/session API or capture implementation. Explicit `--no-daemon` and eligible direct fallback still execute the original implementation. Errors returned after uncertain dispatch do not trigger another device action.

This is deliberately smaller than moving CLI parsing into the daemon. It removes avoidable imports without duplicating parsing or changing the daemon trust boundary. Each CLI invocation still starts Node; the full persistent-worker speedup is not a target or a promised result of this change.

## Physical comparison

Physical Pixel 10 Pro, API 37, 1080 x 2410 portrait, matching installed development Operator. The unchanged main build was copied privately before edits; the candidate uses the branch-local build. Both use their matching normal daemon-backed CLI, Jev `jev-1.13.0`, identical helper policy, full-size stock screenshots and independent snapshot/read-value terminal verification.

The example helper explicitly opts out of the daemon, so both benchmark arms use an identical private copy removing only that opt-out. This is measurement setup, not a shipped helper-policy change. Raw summaries label both arms `cli`; output directory names and the private driver identify baseline versus optimized. Runtime logs independently establish daemon dispatch.

Protocol: one excluded pilot per arm, followed by five alternating pairs (baseline/optimized, optimized/baseline, baseline/optimized, optimized/baseline, baseline/optimized). Before each trial, start the matching owned daemon outside the task timer and stop it afterward. Both daemons therefore have a warm server process but no task-level readiness cache primed by an earlier task. This avoids counting a build-switch restart in one arm. Setup, doctor and separate direct Settings reset are excluded; all task CLI process startup, commands, model calls, evidence and helper shutdown are included. No device setting, rendering gate, model budget or capture size changed. Failed trials must be retained and stop the sequence rather than be replaced.

| Pair (execution order) | Main CLI | Optimized CLI | Saving |
| --- | ---: | ---: | ---: |
| 1 (main first) | 26.207 s | 26.707 s | -0.500 s |
| 2 (optimized first) | 29.700 s | 27.770 s | 1.930 s |
| 3 (main first) | 27.859 s | 26.089 s | 1.769 s |
| 4 (optimized first) | 28.188 s | 26.923 s | 1.265 s |
| 5 (main first) | 26.386 s | 26.715 s | -0.329 s |

Median task time: **27.859 s versus 26.715 s**, 1.143 s / 4.1% lower in this batch. Mean: **27.668 s versus 26.841 s**, 0.827 s / 3.0% lower. Optimized was faster in three pairs and slower in two; this does not establish a guaranteed 4.1% improvement. Ranges were 26.207-29.700 s and 26.089-27.770 s. Excluded pilots both verified: main 28.213 s and optimized 26.325 s.

Mean component totals per task:

| Component | Main CLI | Optimized CLI | Main minus optimized |
| --- | ---: | ---: | ---: |
| All 22 CLI calls | 26.360 s | 25.468 s | 0.891 s |
| Four Jev requests | 1.100 s | 1.149 s | -0.049 s |
| Other helper work | 0.208 s | 0.223 s | -0.015 s |

Mean CLI totals by command, including process startup and execution:

| Command (calls/task) | Main CLI | Optimized CLI |
| --- | ---: | ---: |
| open (1) | 0.997 s | 0.868 s |
| click (1) | 0.783 s | 0.683 s |
| scroll (3) | 4.461 s | 4.222 s |
| screenshot (8) | 11.799 s | 11.577 s |
| snapshot (7) | 7.002 s | 6.786 s |
| read-value (2) | 1.319 s | 1.331 s |

These totals do not isolate device execution from client cost. The separately measured loading reduction below supports the mechanism; it does not explain the entire observed task difference.

## Reliability and compatibility

- All five measured tasks per arm and both pilots verified. No failed trial was replaced.
- Every task used the same 22 commands, navigation sequence, four accepted Jev choices and independently verified extracted fields. Across all 12 tasks: 48 accepted choices, no provider failures and no failed CLI commands.
- All 96 saved PNGs decoded at 1080 x 2410. All 24 independently audited post-click/final images had the expected About phone title. Representative post-click images in the last pair were also inspected manually.
- All 264 task commands matched one daemon request, one broadcast and one terminal envelope with the expected runId/commandId/taskId. No silent direct fallback or duplicate dispatch was detected. Every owned daemon was stopped afterward.
- A separate live candidate `--no-daemon` snapshot and caller-relative screenshot succeeded with canonical envelopes. The saved PNG decoded at full size. Back navigation and a fresh snapshot verified Settings root; daemon status was `not_running`. These checks were outside timing. Their default-log writes were sandbox-denied and reported as warnings; capture and canonical action results still succeeded. Timed trials used a writable explicit log directory.

All measurements cover one known Settings route on one phone. PNG decoding and page-title checks do not establish every scrolling row has settled or screenshot/snapshot atomicity. Jev receives snapshot-derived text, so this is not a vision-accuracy test. The small sample and uncontrolled host/device scheduling do not establish tail latency or a universal speedup. Instrumentation was not added to the measured production builds.

## Isolated loading check

Twenty alternating host-only pairs started a fresh Node process, imported the CLI registry plus action, observe and execute command modules, then exited. Both builds used identical locked dependencies. Parent elapsed includes Node startup, imports and exit; there is no device, daemon request or provider work in this check.

| Loading check | Main | Optimized |
| --- | ---: | ---: |
| Median | 97.08 ms | 83.86 ms |
| Mean | 97.40 ms | 84.62 ms |
| Range | 92.98-106.55 ms | 81.85-97.91 ms |

Median reduction is 13.23 ms (13.6% of this loading check), not 13.6% of a device task. The mean reduction is 12.78 ms. Applying that to all 22 task invocations would be about 0.28 s, a rough scale estimate only: actual commands load different graphs. Do not attribute the full 0.827 s mean physical difference to imports or extrapolate to the earlier persistent-process comparison.

## Validation and interpretation

- Branch-local Node build and full suite: 1,488 tests, 206 suites, zero failures/skips.
- Four new fresh-process import-boundary regressions cover successful daemon execution, eligible fallback, explicit direct execution and uncertain-dispatch failure without replay.
- Seventeen baseline/candidate CLI cases had byte-identical stdout/stderr and matching exit codes: help/version, malformed/missing values, blank inputs, global/local timeout placement and emulator storage validation/alias conflicts. Existing full-suite emulator tests cover valid sizes and aliases.
- Full docs build passed, including 38 navigation pages, 402 generated-document links and 24 llms routes; no organization warnings.
- Independent GPT-6 Astra review of the runtime/test working-tree diff against main returned `REVIEW_RESULT=NO_ISSUES`. Runtime/test code was unchanged after review.
- No Android changes, new dependencies or provider/capture-policy changes.

This is a modest, transparent improvement with a measured reduction in loading cost and no detected reliability regression in the tested route. Keep the current CLI as the agent interface. The task-level sample is small and mixed; advertise reduced unnecessary startup work, not a universal task-speed percentage. Explicit direct workflows still need the direct runtime, and the shipped example helper still explicitly opts out of the daemon, so do not promise it the normal-daemon result.

The user preference for transparent CLI optimization supersedes the earlier proposed new session API as the immediate next step. A production session API, moving CLI parsing into the daemon, changing ownership checks and transport replacement are outside this PR. Rendering verification, maintained reduced-buffer capture, the optional Decisions skill and broader compatibility/vision evaluation remain separate planned follow-ups.

## Reproduction and private evidence

Build main `219dcf05` and the candidate with the same locked dependencies. Use the existing `validation/agent-loop-latency/benchmark.cjs` with `--backend cli` and private helper copies removing only the runtime argv's `--no-daemon`. Pin each copy to its own built CLI. Supply `JEV_API_KEY` in the environment, select one explicit physical device and development Operator, and use new output directories. Run the two pilots and five alternating pairs. Start/stop only the owned matching daemon outside each task clock; preserve daemon logs outside the fresh trial directory.

Verify each saved command's runId/commandId/taskId against the daemon's request, dispatch and envelope records, then revalidate terminal evidence, command/navigation sequences and fields locally. Decode all PNGs and independently audit post-click/final pages. Keep private UI, model logs, device identifiers and machine paths out of commits.

The private worktree directory `tmp/transparent-comparison/` retains original task evidence, setup and daemon logs, aggregate analysis, routing/image audits and loading/CLI-output checks. `tmp/baseline/` retains the unchanged build. The notebook preserves this report and prior experiments; no earlier finding is removed. This PR changes loading only and must not be described as a new agent API or a capture optimization.
