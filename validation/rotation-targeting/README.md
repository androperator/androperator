# Background rotation selector regression

This account-free fixture places separately counted `LEFT_TARGET` and
`RIGHT_TARGET` buttons at opposite screen edges. Its `UP` marker and counters
refresh on display changes, including the 180-degree turn between landscape
orientations. It uses platform widgets so no external UI dependencies are needed.

Build the branch-local Node CLI and debug Operator, install the Operator and
verify interactive readiness first. Select an emulator explicitly. For the
reported case use API 37, natural size 1280 x 2856 and density 480 dpi.

```sh
bash validation/rotation-targeting/fixture/build.sh /tmp/rotation-fixture.apk
# The build uses an ephemeral signing key. Before repeating installation,
# uninstall only this disposable fixture if it is already installed.
adb -s <device_serial> install /tmp/rotation-fixture.apk
python3 validation/rotation-targeting/run.py \
  --device <device_serial> --output /tmp/rotation-proof
```

`ADB_SERVER_SOCKET` is honored for an isolated ADB server. Use a new output
directory for every attempt. The runner initializes the Operator Activity in
portrait, opens the fixture through the CLI, then rotates portrait -> 90 degrees
-> 270 degrees -> portrait while the fixture stays foreground. It restores the
original rotation settings in `finally`. It force-stops only the fixture to reset
counters; it never clears Operator data or changes another app.

For every orientation, it saves a raw snapshot, all/on-screen queries, strict
semantic action receipts, independent post-action counter snapshots, active
Activity/display diagnostics and screenshots. It checks hidden-target
no-dispatch behavior. Both buttons must resolve uniquely and reach four clicks
each. No coordinate action substitutes for a semantic click. Failure receipts
and stderr remain in order beside successful observations. A process or fixture
failure is a failed validation, even if `summary.json` has no selector failures.

The off-device `LandscapeTargetingTest` covers stale-frame initialization,
90/270-degree rotation and portrait return without Activity callbacks, hidden
nodes, nodes beyond the current right/bottom edges, and preserved duplicate
candidates. Existing strict-selection tests cover ambiguity and no dispatch.
CI compiles and signs this fixture through `check-fixtures.sh`; live device
validation remains explicit.

Raw evidence is local and may contain device identifiers and personal paths.
Share only allowlisted synthetic labels, dimensions, bounds, counts and result
fields. Do not publish raw evidence directories.
