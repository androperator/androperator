# Background rotation and semantic targets

The account-free fixture has independent left/right counters, two ambiguous
controls, one hidden control and one off-screen control. It has no network or
storage permissions. Rotation preserves its counters.

Build the branch-local CLI and Dev Operator, then use a disposable phone emulator.
Install the APKs and enable the Operator accessibility service with `operator setup`.
The following ADB commands configure the test environment; all target actions in
the runner use strict semantic Androperator clicks.

```sh
bash validation/landscape-targeting/fixture/build.sh /tmp/landscape-fixture.apk
adb -s <device_serial> install -r /tmp/landscape-fixture.apk
adb -s <device_serial> shell wm size 1280x2856
adb -s <device_serial> shell wm density 480
python3 validation/landscape-targeting/run.py --device <device_serial> \
  --output /tmp/landscape-targeting-evidence
```

The fixture build uses an ephemeral test signing key. Before installing a rebuilt
fixture, uninstall only `com.androperator.landscapefixture` from the disposable
emulator. This removes its transient test state.

Choose a new output directory. The runner initializes the Operator in portrait,
backgrounds it, then checks portrait, 90 degrees, 270 degrees and portrait return.
It checks raw XML rotation, exact candidate/dispatch receipts and separately
observed counter increments. Hidden, off-screen and ambiguous strict clicks must
fail without dispatch or counter changes. It restores the original rotation
settings, retains every attempt, stops on uncertain results, and never substitutes
coordinate input. Screen-size/density overrides are caller-owned; restore them
when finished with the disposable emulator.

`check-fixture.sh` builds and verifies the fixture without a device, and runs in
the standard Android CI suite. Robolectric coverage uses the real frame manager
and filter with an absent Activity, plus existing resolver and no-dispatch tests.
