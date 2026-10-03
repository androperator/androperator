# Drag gesture implementation

The public `drag` action implements a coordinate-based hold, straight movement,
and release through Android accessibility. See [the action contract](../../api/actions.md#action-drag)
for fields, error values, evidence, and cancellation semantics. Source selection,
destination selection, and interpretation of the drop belong in the agent or
app-specific skill.

## Pointer continuity and hold timing

A long-click followed by a swipe releases the first touch. A slower swipe moves
immediately. Neither expresses a stationary hold followed by movement of the
same pointer. `drag` uses an API 26 continuing stationary stroke followed by a
non-continuing movement stroke.

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
requests that release. A movement already accepted finishes with its own
pointer-up; cancellation does not reverse app effects. No failure automatically
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
