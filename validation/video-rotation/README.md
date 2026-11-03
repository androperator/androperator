# Recording across rotation

Use an explicitly selected disposable phone emulator and matching branch-local
CLI/Dev Operator. The platform-widget fixture contains an upright `UP` marker,
rotation value and separate semantic-click counters, with no accounts or network
permissions. A visible monotonic clock changes every 100 ms to provide continuous
frame evidence. Sparse static recordings can still fail the existing duration
coverage check; this harness does not weaken that check or claim to solve it.

```sh
bash validation/video-rotation/fixture/build.sh /tmp/video-rotation-fixture.apk
adb -s <device_serial> install /tmp/video-rotation-fixture.apk
python3 validation/video-rotation/run.py --device <device_serial> \
  --output /tmp/video-rotation-evidence
```

The output parent must exist; choose a new output directory. The fixture uses an
ephemeral signing key; uninstall only this disposable fixture before replacing it.
`ADB_SERVER_SOCKET` is honored. The runner saves and restores rotation settings.
ADB configures orientation; semantic clicks and counter observations use the CLI.
Every process attempt and timeout is retained. A failed action is never replayed.

The portrait, landscape, opposite landscape and portrait sequence must increment
the independently observed counter once at each stage. Finalization must expose
three ordered MP4 spans with portrait, landscape and portrait geometry, contiguous
source boundaries, nonempty frames and positive durations. Both landscape
rotations share dimensions, so they stay in the same span. The runner extracts
actual frames from every span. Inspect the landscape samples for both `ROTATION=1`
and `ROTATION=3`, upright text and the upward marker; a success manifest alone
does not establish visual orientation. Evidence remains private until sanitized.

CI compiles/signs this fixture and checks runner syntax. The existing
`validation/video-stream-verification/` harness checks real segment encoding,
full decoding, exact frame counts and source timestamp preservation. Unit tests
retain startup, cancellation, recovery, ownership and locking guarantees.
