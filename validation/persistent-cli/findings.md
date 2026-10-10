# Persistent CLI forwarding feasibility

Base: merged PR #396, `b0fdeaf5`. This is an experimental implementation and
physical comparison, not a production CLI change. The proposed user experience
remains the same existing commands; no new agent-facing API is proposed.

## Result

A thin Node launcher forwarding argv to a warm CLI process reduced median task
time from **26.929 to 25.543 seconds (5.1%)** in five frozen-code pairs. Mean
changed from **26.957 to 25.763 seconds (4.4%)**. Four pairs improved and one
regressed; one improvement was only 18 ms. This is a modest measured opportunity,
not a universal speed guarantee and not the earlier 14.8% result.

| Retained pair ID | First arm | Merged #396 | Prototype | Saving |
| --- | --- | ---: | ---: | ---: |
| 2 | persistent | 27.420 s | 25.372 s | 2.048 s |
| 3 | baseline | 27.371 s | 24.215 s | 3.155 s |
| 4 | persistent | 26.534 s | 26.774 s | -0.241 s |
| 5 | baseline | 26.929 s | 26.912 s | 0.018 s |
| 6 | persistent | 26.533 s | 25.543 s | 0.989 s |

Mean component totals per task:

| Component | Merged #396 | Prototype |
| --- | ---: | ---: |
| 22 CLI invocations | 25.586 s | 24.314 s |
| Four Jev calls | 1.162 s | 1.241 s |
| Other helper work | 0.210 s | 0.208 s |

The device-free check ran one excluded warm-up pair then 20 alternating pairs of
`snapshot --max-nodes invalid`, checking identical output and exit code. Median
was **46.21 ms versus 29.94 ms**, mean **46.24 versus 29.96 ms**. This isolates a
short parser/handler error path, including launcher start/exit and relay transport,
not a complete valid device-command import graph. It saved about 16.28 ms but
still spent about 30 ms starting and using the thin Node launcher. Do not scale
that error-path result into a claimed attribution of all physical task savings.

## Method and retained exclusions

Physical Pixel 10 Pro, API 37, portrait 1080 x 2410, development Operator, Jev
`jev-1.13.0`, full-size stock captures and independent snapshot/read-value terminal
verification. Both arms used the same merged #396 build and normal existing daemon.
The experimental worker ran the existing CLI parser/handlers sequentially, with
normal daemon readiness/ownership/build checks still in place. See [README](README.md)
for the exact laboratory adaptation and its limits.

Setup, doctor, direct Settings reset, daemon start and warm-worker start were
outside task timing. Task CLI invocation, model and evidence work were included.
Each task had a newly started matching daemon with no previous task priming its
readiness cache. The private helper removed only its hardcoded no-daemon flag in
both arms. No capture size, rendering policy, decision budget or device setting
changed. All measured tasks used one open, one click, three scrolls, eight
screenshots, seven snapshots and two read-value commands.

Two initial pilots verified at 27.246 s baseline and 24.982 s prototype. The first
pair also verified at 27.287 versus 25.800 s. After that pair, the experimental
socket reader was hardened with UTF-8 stream decoding. This was a development
change, so that pair was explicitly designated preliminary before subsequent
results were available, rather than mixed into the primary frozen-code comparison.
Pairs 2-5 used the fixed code and a sixth pair was added, yielding five measured
pairs on the same worker/relay version. The saved hashes identify the frozen
worker, relay and host. The preliminary pair remains available and is not a failed
trial. A local extra-pair driver initially had a syntax error and exited before
setup or device actions; it was corrected and the pair completed. No task failure
was removed or replaced.

The committed driver runs the normal two pilots plus five alternating pairs with
its frozen current code. The retained development dataset uses IDs 2-6 for the
primary sample, so its private analysis selects that range explicitly. The default
analyzer selects 1-5 for fresh reproductions.

## Reliability evidence and limits

All ten primary tasks verified the same route, command sequence and extracted
fields. All 40 primary model choices were accepted. Including pilots and the
preliminary pair, all 14 tasks verified, all 112 PNGs decoded at full size and all
28 audited post-click/final images had the About phone title. All 308 commands
matched exactly one daemon request, broadcast and correlated terminal envelope.
There were no detected duplicate dispatches, silent direct fallbacks, provider
failures or command failures. Owned daemons and prototype workers were stopped;
cleanup returned to Settings root, verified by a fresh snapshot.

Tests cover byte-identical help, error output, aliases, Unicode and exit-code
isolation; disconnect after dispatch without reconnect/replay; and failure after
worker exit followed by explicit replacement. These are small off-device tests,
not physical unplug/kill-during-action recovery validation. The extra experiment
uses fixed caller directory/environment and serial requests; it is not evidence
of production concurrency safety or full CLI compatibility. Page titles do not
prove scroll settling or screenshot/snapshot atomicity. Jev used snapshot text,
so these trials do not establish image-model accuracy. One phone and five pairs
cannot establish tail latency or cross-device gains.

The Node build, three prototype tests and validation-runner tests passed. Production
Node/Android code is unchanged. No new libraries or licensed assets were added.
Raw private evidence is retained under the worktree's ignored
`tmp/persistent-cli/` directory, including summaries, log audits, PNGs, title checks,
loading timings and frozen hashes. Device IDs, credentials and UI data are excluded
from source control.

## Interpretation

This experiment supports removing repeated CLI work, but it does not reproduce
all advantages of the earlier in-process execution experiment. It retains a Node
process per command and all normal daemon checks, plus an extra experimental
forwarding hop. The earlier 14.8% comparison used a different batch and execution
path. Do not add that percentage to #396's gain or claim this is the final
production architecture.

The thin Node launcher by itself still costs about 30 ms on this host. Removing
that startup would require a different launcher/runtime strategy and packaging
work. Persisting JavaScript behind an unchanged Node executable does not make
separate invocations reuse the same interpreter automatically.
## Production implementation boundaries

The prototype preserves the existing command parser and measured command outputs, but its process-global capture is not suitable for product use. The next implementation should:

1. Extract a request-scoped CLI runner that accepts argv, caller directory, explicit logging/run context and output sinks. Return stdout/stderr/exit status without process.exit, process.chdir or mutable process-wide environment. Keep the original entry point as the normal fallback, using the same parser and command registry. Cover aliases and global/command-local options with the same fixtures.
2. Host eligible short device commands in the existing owned daemon. Use the canonical execution path directly inside the server; do not recursively proxy to itself. Preserve readiness and exclusive-device execution contracts. Keep long-lived interactive/server/lifecycle commands on the current path. An optimization can decline unsupported requests before execution while maintaining their behavior.
3. Add a thin launcher that preserves build/version and ownership checks. Request data must include caller-relative file context and precisely defined environment/config inputs, never arbitrary credential forwarding. Fallback is legal only on a positively known pre-dispatch rejection or connection failure; lost/partial responses after dispatch must report uncertain outcome with no replay.
4. Validate deadline accounting, cancellation, worker/daemon death, restart, upgrade/build mismatch, alternate caller directories, relative screenshots/execution files, device/package selection, parallel callers, environment changes, stdin/TTY behavior and correlation. A simple fixed-environment worker cannot establish these contracts.
5. Compare the integrated production path with merged #396 using a frozen build and matched physical evidence. Keep Node-launch cost separate from parsing/transport savings. If additional startup removal is necessary, evaluate packaging a native launcher separately; do not imply a Node shebang reuses an interpreter across separate commands.

This is a transparent CLI optimization goal: agents should not choose or learn a new API. The optional persistent Node library interface can remain separate. The prototype's extra worker is measurement infrastructure, not the proposed deployment architecture.
