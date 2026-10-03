# Snapshot I/O Optimization Future Work

Date: 2026-04-26
Status: future-work handoff with daemon online

## Purpose

This task item is the forward-looking home for remaining snapshot and skill-loop
performance work after the Node daemon is online.

The daemon and Node-side logcat cleanup are baseline behavior. Future work should
not reopen those completed paths unless a regression is found. Start from the
remaining latency sources below.

## Current Baseline

Daemon-backed execution is available and should be treated as the normal local
path for repeated CLI calls. The daemon materially improves repeated bare device
calls and skill loops that avoid arbitrary fixed sleeps.

Observed baseline with daemon-backed execution:

| Surface | Prior measured median | Current daemon-aware median | Delta |
| --- | --- | --- | --- |
| Warm snapshot | 1599ms no-daemon | 846ms warm daemon | -753ms (-47.1%) |
| SolaX battery skill | 21363ms with fixed sleeps | 10326ms with condition-based daemon polling | -11037ms (-51.7%) |
| Google Home climate skill | 17237ms with fixed sleeps | 9080ms with condition-based daemon polling | -8157ms (-47.3%) |

Interpretation:

- The daemon is effective for repeated observation and action loops.
- Skill runtime improves most when skill code polls observable UI readiness and
  stops as soon as the target state appears.
- Fixed sleeps hide daemon benefits because app workflow time dominates the run.
- The remaining latency floor is mostly Android UI traversal, app readiness, and
  broadcast/logcat transport behavior.

## Invariants To Preserve

- Do not reintroduce per-command `logcat -c` or post-success `logcat -d`
  snapshot recovery for the standard snapshot path.
- Do not embed full snapshot XML inside the single-line `[Androperator-Result]`
  envelope.
- Keep snapshot capture scoped to the active command's dispatch-to-envelope
  interval.
- Treat snapshot log lines as uncorrelated by `commandId`; current safety comes
  from timing boundaries, execution locking, and replay quarantine.
- Keep auto-resolve device selection sequential unless a future design proves a
  safe equivalent.
- Keep daemon proxy behavior compatible with commands that have host-side file
  effects. Screenshot calls with caller-relative output paths must not use
  post-dispatch fallback.

## Remaining Bottlenecks

| Segment | Current state | Why it matters |
| --- | --- | --- |
| Android `snapshot_ui` traversal and serialization | Often hundreds of ms on moderately complex screens | This is the main latency floor once daemon and host startup costs are reduced. |
| Snapshot payload size | Full XML includes many unused attributes | Larger payloads increase Android serialization, logcat transport, and Node parsing cost. |
| Broadcast/logcat transport | Still subprocess and logcat based | The daemon reduces host startup cost but does not remove the Android transport model. |
| App readiness | App-specific values may appear seconds after open or navigation | Skills must poll observable readiness rather than sleeping guessed durations. |

## Future Task Candidates

### F1 - Android-side snapshot filtering

Add opt-in filter parameters to `snapshot_ui` so callers can request a relevant
subtree instead of the full UI hierarchy.

Candidate filters:

- foreground package only
- visible nodes only
- actionable nodes only
- resource-id prefix
- window index

Start from these source files:

- `apps/android/shared/data/task/src/main/kotlin/androperator/task/runner/TaskScopeDefault.kt`
- `apps/android/shared/data/task/src/main/kotlin/androperator/task/runner/UiActionEngine.kt`
- `apps/android/shared/data/uitree/src/main/kotlin/androperator/accessibilityservice/AccessibilityNodeInfoExtAndroid.kt`
- `apps/android/shared/data/uitree/src/main/kotlin/androperator/uitree/UiTreeFilterer.kt`
- `apps/node/src/contracts/execution.ts`
- `docs/api/snapshot.md`

Acceptance shape for a future task pack:

- unfiltered `snapshot_ui` remains unchanged by default
- new filters are opt-in and documented
- Android unit or instrumentation coverage proves filtering behavior
- Node contract validation rejects malformed filter values
- live-device measurements compare filtered and unfiltered snapshot latency

### F2 - Reduced snapshot output mode

Add an explicit compact snapshot mode that omits redundant always-false or
rarely used XML attributes.

Do not silently change the existing default XML shape. Treat this as a public
contract addition unless the future task explicitly chooses a breaking change.

A future task should first inventory which snapshot fields are consumed by:

- Node helpers
- runtime skills
- docs examples
- common agent workflows

### F3 - Persistent Android transport

Design a direct Android transport to replace broadcast dispatch plus logcat
scraping for command results.

Candidate shape:

- Android operator hosts a local socket or equivalent endpoint
- Node forwards or connects through adb
- `[Androperator-Result]` semantics remain preserved or explicitly versioned
- large payloads can be chunked or streamed without logcat line limits

This is higher risk than filtering or reduced output because it touches the main
execution transport. Do not start here unless the goal is transport redesign.

### F4 - Incremental or diff snapshots

Explore stateful snapshot deltas after filtering and compact output are better
understood.

This should come after F1 and F2 because a diff contract over today's full XML
would likely be expensive to maintain and hard for agents to consume.

### F5 - Skill-loop performance guidance and exemplars

Continue updating high-value skills so they use daemon-backed condition polling
instead of arbitrary fixed sleeps.

Authoring rule:

- use `wait_for_node`, `read_text`, `snapshot_ui`, or small bounded polling loops
- stop as soon as terminal state is observed
- keep fixed `sleep` only when no observable UI condition exists, and document
  why in the skill
- ensure nested skill calls use the wrapper-injected `ANDROPERATOR_BIN`

Durable guidance already lives in:

- `docs/skills/development.md`
- `docs/skills/authoring.md`
- `apps/node/bundled-skills/androperator-skill-author-by-recording/SKILL.md`
- `apps/node/bundled-skills/androperator-skill-author-by-agent-discovery/SKILL.md`
- `apps/node/bundled-skills/androperator-agent-orientation/SKILL.md`

## Suggested Next Task Prompt

Author a task pack for Android-side snapshot traversal and serialization
reduction.

Scope the first PR to one opt-in `snapshot_ui` filtering mode, preferably
foreground-package or visible-only filtering. Require before/after live-device
measurements, Android coverage, Node contract tests, and docs regeneration. Keep
unfiltered snapshot behavior unchanged by default.
