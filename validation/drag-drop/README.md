# Launcher drag regression

This opt-in live check uses the branch-local `drag` and `snapshot` commands and
the debug Operator. Install the APK from this checkout first. On Pixel Launcher,
put a uniquely labeled app shortcut on the visible workspace and choose an empty
destination in screen pixels:

```bash
node validation/drag-drop/run.mjs --device '<device_serial>' \
  --label Photos --x 200 --y 1000 --output-dir tmp/drag-round-trip --restore
```

The output directory must be new. The check requires the icon to move to bounds
containing the destination, verifies placement after Home, then restores and
checks the exact original bounds when `--restore` is supplied. It preserves raw
snapshots and correlated drag result envelopes. Timed-out snapshot reads can be
retried; gestures are never automatically replayed. A failed check can leave the
icon moved; inspect its actual state before another run.

The runner does not reset launcher data. It is a manual, opt-in scenario and is
not run by CI. Use `adb devices` to select the explicit target before running it.
The example coordinates must be replaced with a known empty destination in the
current layout.

## Scenario assumptions and limits

The runner matches a uniquely labeled, visible, long-clickable node inside
Pixel Launcher's workspace with positive-area bounds. Drawer, dock, off-screen,
and duplicate matches must not be mistaken for the source. Empty cells are not
individually exposed as labeled nodes; choosing one remains the caller's job.
A changed rectangle alone is insufficient evidence of a drop, so the runner
checks destination containment and placement after Home.

This scenario covers same-page movement into an empty cell and optional
restoration. It does not establish folder creation, occupied-cell reordering,
edge-hover page changes, drawer-to-workspace placement, widgets, cross-app drops,
or behavior in other launchers. Snapshot retries only handle
`RESULT_ENVELOPE_TIMEOUT`; readiness and infrastructure failures remain failures.

The gesture lifecycle rationale belongs in the
[internal design note](../../docs/internal/design/drag-gesture.md).
