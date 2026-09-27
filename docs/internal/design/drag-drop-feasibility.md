# Drag and drop implementation

The public `drag` action implements a coordinate-based hold, straight movement,
and release through Android accessibility. See [the action contract](../../api/actions.md#action-drag)
for fields, error values, evidence, and cancellation semantics.

## Why a separate action

A long-click followed by a swipe releases the first touch. A slower swipe moves
immediately. Neither expresses a stationary hold followed by movement of the
same pointer. `drag` uses an API 26 continuing stationary stroke followed by a
non-continuing movement stroke; it does not change `swipe` behavior.

A zero-distance continuing stroke can complete immediately after DOWN because
there are no later motion events. Giving it a long Android stroke duration does
not implement a real hold. Live evidence caught this: a 1200 ms hold plus an
800 ms move completed in 810 ms and opened the app drawer. Dispatch a minimal
stationary continuing stroke, then wait `holdDurationMs` on the main handler
after its completion acknowledgement before continuing. The regression test
requires no movement before that timer expires.

The execution timeout governs the full operation. Do not derive a shorter
callback deadline from hold and movement durations: those describe physical
gestures, not main-thread scheduling or callback latency. An early prototype
with a durations-plus-2000-ms deadline timed out on a loaded emulator. A
regression test now covers delayed hold callbacks.

After an accepted hold, failed movement retains `dispatch_accepted: "true"`.
Cancellation removes the pending hold timer and requests a stationary release.
If the initial down acknowledgement is pending, its callback requests release. A movement already accepted finishes with its own
pointer-up; cancellation does not reverse app effects. No failure automatically
replays the drag, and cleanup cannot be guaranteed if the service disappears.

## Verify effects, not dispatch

Pixel Launcher exposes icon bounds through the snapshot API, including
visibility and workspace ancestry. Match the launcher package, visible workspace,
label, and positive-area bounds; require a unique source. The hierarchy can also
contain off-screen icons and duplicate labels in the drawer or dock.

Require the destination to lie inside the resulting icon bounds, then verify
placement after pressing Home. A changed rectangle alone can describe opening
the drawer rather than a successful drop. Duplicate copies of one app need a
stronger source selection rule than the live regression uses.

Empty cells are not individually exposed as labeled nodes. Mapping column/row
positions to coordinates remains launcher-specific. At a Glance can occupy the
first-page top row. Folder creation, occupied-cell reordering, edge-hover page
changes, drawer-to-workspace placement, widgets, and cross-app drops require
separate live scenarios; the same-page empty-cell check does not prove them.

## Validation

`validation/drag-drop/run.mjs` moves a visible Pixel Launcher icon through the
branch-local Node CLI, verifies its destination and placement after Home, and
optionally restores the exact original bounds. Its correlated drag envelopes
and before/after XML are local evidence. It retries timed-out snapshot reads,
never gestures. The manual `Launcher drag and drop` GitHub workflow invokes the
same check on a disposable Google Play emulator and uploads its evidence.

An earlier feasibility probe used ADB motion events. It established that Photos
could move from `[696,1800][957,2154]` to `[78,996][339,1350]`, and that snapshot
bounds could verify this. The live regression now uses the actual accessibility
backend; no shell-injection fallback is part of the public action.

The initial research emulator also encountered a Settings Services ANR and
readiness failures. Preserve such infrastructure failures rather than treating
them as successful gesture verification.

## Sources

- [Android continued strokes](https://developer.android.com/reference/android/accessibilityservice/GestureDescription.StrokeDescription)
- [Android accessibility gesture guide](https://developer.android.com/guide/topics/ui/accessibility/service)
- Gesture implementation: `apps/android/shared/data/uitree/src/main/kotlin/clawperator/accessibilityservice/DragGestureAndroid.kt`
- Live regression: `validation/drag-drop/README.md`
