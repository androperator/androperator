# Drag gesture implementation

The public `drag` action implements a coordinate-based hold, straight movement,
and release through Android accessibility. See [the action contract](../../api/actions.md#action-drag)
for fields, error values, evidence, and cancellation semantics. Source selection,
destination selection, and interpretation of the drop belong in the agent or
app-specific skill.

## Pointer continuity and hold timing

A long-click followed by a swipe releases the first touch. A slower swipe moves
immediately. Neither expresses a stationary hold followed by movement of the
same pointer. `drag` uses an API 26 continuing stationary stroke followed by movement
continuations. The final moving stroke releases the pointer.

A stationary continuing stroke can complete as soon as DOWN is delivered because
there are no later motion events. Its Android stroke duration alone does not
provide the requested hold. Dispatch a minimal stationary continuing stroke,
then wait `holdDurationMs` on the main handler after its completion
acknowledgement before continuing. The gesture regression test requires no
movement before that timer expires. Callback and scheduling latency can extend
the actual hold.

The execution timeout governs the full operation. Do not derive a shorter
callback deadline from hold and movement durations: those describe physical
gestures, not main-thread scheduling or callback latency. The regression test
also covers delayed hold callbacks.

## Dispatch evidence and cancellation

After an accepted hold, failed movement retains `dispatch_accepted: "true"`.
Cancellation before movement removes the pending hold timer and requests a
stationary pointer-up continuation. If the initial down acknowledgement is
pending, its callback requests release when it arrives. Rejected movement also
requests that release. An accepted final movement owns its pointer-up; queued cancellation cleanup must
not continue that completed, non-continuing stroke. An accepted intermediate
movement is released after its callback. Cancellation does not reverse app effects. No failure automatically
replays the drag, and cleanup cannot be guaranteed if the service disappears.

State changes and platform calls run on the main handler. Keep cancellation
cleanup tied to the existing stroke so it cannot inject a fresh tap or start a
new movement.

## Validation boundaries

`DragGestureAndroidTest` covers pointer continuity, hold timing, cancellation,
rejected dispatch, bounds, and unsupported Android versions using Robolectric.
These tests check the gesture lifecycle, not an application's response to it.

The [opt-in launcher regression](../../../validation/drag-drop/README.md) checks
one application's drop result through the branch-local CLI and accessibility
backend. It is a launcher scenario, not the general gesture contract, and is
not run by CI. A controlled target that records down/move/up and verifies a drop
would strengthen live coverage independently of launcher layout; that remains
follow-up work.

## Implementation sources

- `apps/android/shared/data/uitree/src/main/kotlin/androperator/accessibilityservice/DragGestureAndroid.kt`
- `apps/android/shared/test/src/test/kotlin/androperator/uitree/DragGestureAndroidTest.kt`


## Hover waypoints

Raw execution `drag` parameters accept optional `waypoints`: an ordered array of
`{x, y, durationMs, holdDurationMs?}`, addressing
[issue 426](https://github.com/androperator/androperator/issues/426). During development,
use the branch-local CLI and **dev APK** (`com.androperator.operator.dev`). An older
installed release CLI/APK does not support these fields. No named CLI
waypoint flags are added. MCP forwards the optional array to execution validation.

Each waypoint continues the original pointer and optionally holds before the next
segment. The final leg uses `end` and `moveDurationMs`. Start and end must still
differ. Up to eight points are accepted; movement durations are 1–10000 ms, holds
are 0–10000 ms, and total requested hold/movement time is at most 60000 ms. The
execution timeout must also accommodate callbacks and scheduling latency. Bounds
are checked before dispatch. A segment whose point equals the current position
(a hold at the end of a path) dispatches no stroke: the pointer is already down, so
it waits on a handler timer. A zero-length continuation stroke is rejected by real
devices (observed on an API 36 emulator as GESTURE_FAILED right after the preceding
move), although Robolectric accepts it.

A path may end at its start when a waypoint differs, so the node contract, the
Operator parser, `TaskUiScope` and `UiTreeManager` all check that the whole path moves.
A rejected Operator parse currently produces no result envelope, so the client
waits for its timeout; the Node layer must validate first.

Cancellation during a hover removes the timer and releases that continued pointer.
Cancellation during a continuing movement waits for its callback, releases, and
never visits later points. A final non-continuing movement already owns release.
Execution deadlines are checked before initial dispatch and each new movement.
Receipts still prove dispatch only: verify target UI and persisted state separately.

Focused tests cover parameter preservation, invalid paths and time budgets, held
pointer continuity across hover points, and cancellation without later movement.
The existing straight-drag dispatch, deadline and cancellation tests remain required.
