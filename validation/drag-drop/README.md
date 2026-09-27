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

`.github/workflows/drag-drop.yml` runs this on a disposable Google Play emulator.
Only its `ci-device.sh` wrapper resets launcher data. Do not run that wrapper on
a personal device. The local runner does not reset launcher data.
