# Drag and drop feasibility prototype

Status: research prototype, 2026-09-27. This does not add a public drag action.

## Verdict

A coordinate-based press, hold, move, and release action is feasible. Pixel
Launcher exposes enough workspace icon information in the existing snapshot
API to verify an ordinary move to an empty cell. Grid interpretation and
launcher-specific success checks belong in the agent or skill.

The prototype uses diagnostic ADB motion events. It establishes launcher and
snapshot behavior, not accessibility gesture execution. The recommended
production implementation must still be built and proved through the Operator.

## Observed behavior

On an Android 16 (API 36) emulator running Pixel Launcher, Photos initially had
workspace bounds `[696,1800][957,2154]`. A touch over the icon at `(826,1935)`,
a 1200 ms hold, movement to `(209,1173)`, and release moved it to
`[78,996][339,1350]`. The existing branch-local snapshot API returned the new
bounds. Both positions were on the same workspace page. The repeatable probe
then moved Photos back to its original bounds and observed those same bounds
again after pressing Home.

A later verification read hit a readiness timeout, and subsequent inspection
found an Android system dialog reporting that Settings Services was not
responding. This limits any reliability claim from the session. The probe now
preserves failures and retries only snapshot timeouts, never the drag itself.
It also refused to act when the system dialog obscured the workspace.

Two initial `input draganddrop` attempts opened the app drawer instead. Their
failure does not establish whether touch targeting, timing, or injection
behavior caused the result. Explicit down/hold/move/up succeeded. Shell input
behavior must not be treated as equivalent to accessibility dispatch.

The hierarchy also contains off-screen workspace icons and can contain duplicate
app labels in the drawer. Match the launcher package, workspace ancestry,
visibility, label, and positive-area bounds; require a unique source. Bounds
changing alone does not prove the requested drop. Require the destination to
lie inside the resulting icon bounds on the workspace, and check the placement
again after leaving the drag state. Duplicate copies of the same app need a
stronger source selection rule than this prototype supports.

Empty cells are not individually exposed as labeled snapshot nodes. A request
such as column 3, row 2 to column 1, row 1 therefore needs a known grid geometry
or launcher-specific interpretation. Pixel Launcher's first-page top row can
contain its At a Glance area; it is not an unrestricted empty drop target.

## Reproduce

Build the Node checkout and put a uniquely labeled icon on the visible Pixel
Launcher workspace. Choose an empty destination from the current layout.

```bash
npm --prefix apps/node ci
npm --prefix apps/node run build
node apps/node/prototypes/drag-drop.mjs \
  --device '<device_serial>' --label Photos --x 209 --y 1173 \
  --output-dir tmp/drag-drop-probe --restore
```

The output directory must be new. The script saves full snapshot envelopes,
XML, touch coordinates and timestamps, and verified bounds. It checks placement
after pressing Home and optionally restores the source position. It fails if
there is no unique visible workspace source, the requested placement is not
observed, or restoration does not reproduce the original bounds. It does not
retry an unverified drag automatically. Inspect the launcher if it fails.

This diagnostic uses separate ADB calls for touch events, so movement duration
is host-dependent and can be much slower than a real gesture. It is not a
shipping backend or a duration benchmark. Local raw evidence may contain device
metadata; keep it under ignored `tmp/`, outside committed documentation.

## Proposed implementation

Add a distinct `drag` action with explicit `start`, `end`, `holdDurationMs`, and
`moveDurationMs` fields. Keep the first version to one straight path on the
default display. Reuse swipe's strict coordinate validation, display bounds
checks, correlated execution envelope, and dispatch diagnostics. Reject
unsupported Android versions before touching the screen. Do not change swipe
semantics or silently substitute shell input.

Android API 26 supports a stationary `GestureDescription.StrokeDescription`
with `willContinue=true`. Once that segment completes, use its `continueStroke`
with a path beginning at the same coordinates and `willContinue=false` for
movement and release. Separate long-click and swipe calls cannot substitute:
they release the first touch. A longer ordinary swipe also starts moving
immediately rather than holding at the source.

The current repository minimum SDK is 21, so this implementation needs an
explicit API 26 capability guard. Existing swipe only requires API 24.

Cancellation, rejected continuation, timeouts, and exception cleanup need
particular care because the first segment deliberately leaves a pointer down.
Bound total duration, propagate cancellation, ensure a best-effort release on
failure, report partial dispatch accurately, and do not automatically retry a
possibly applied drag. A completed gesture callback means delivery completed;
it cannot assert that the launcher accepted the drop.

Integration follows the existing swipe route:

- Node action contract and execution validator, then CLI and MCP exposure.
- Android command parser, `UiAction`, action engine, `TaskUiScope`, and
  `UiTreeManager` gesture dispatch.
- Strict parameter and capability tests, continued-pointer/callback tests,
  failure and cancellation tests, and live snapshot verification.
- Public documentation and affected runtime skill updates before shipping.

For the first implementation, prove same-page empty-cell moves and reversal
through accessibility dispatch. Folder creation, occupied-cell reordering,
edge-hover page changes, drawer-to-workspace placement, widgets, and cross-app
drops need separate scenarios. They should not be claimed from this result.

## Sources

- [Android StrokeDescription and continued strokes](https://developer.android.com/reference/android/accessibilityservice/GestureDescription.StrokeDescription)
- [Android accessibility gesture guide](https://developer.android.com/guide/topics/ui/accessibility/service)
- [AOSP shell input implementation](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/input/InputShellCommand.java)
- Existing implementation: `apps/android/shared/data/uitree/src/main/kotlin/clawperator/accessibilityservice/AccessibilityNodeInfoExtAndroid.kt`
- Existing dispatch validation: `apps/android/shared/data/uitree/src/main/kotlin/clawperator/uitree/UiTreeManagerAndroid.kt`
