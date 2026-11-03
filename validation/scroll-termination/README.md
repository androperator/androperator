# Scroll termination and click safety

Use a disposable phone emulator with the matching branch-local CLI and Dev
Operator installed and ready. The synthetic fixture has no accounts, network or
storage permissions. Its fixed header reports click count, scroll position and
list length independently of Androperator receipts.

```sh
bash validation/scroll-termination/fixture/build.sh /tmp/scroll-fixture.apk
adb -s <device_serial> install /tmp/scroll-fixture.apk
python3 validation/scroll-termination/run.py --device <device_serial> \
  --output /tmp/scroll-termination-evidence
```

Choose a new output directory. Fixture builds use ephemeral signing keys; to
replace a rebuilt fixture, uninstall only `com.androperator.scrollfixture` from
the disposable emulator first. Its state consists only of transient test counters.

The runner uses strict semantic controls to create independent scenarios after
known terminal results. It verifies the unchanged ten-swipe cap while the long
list still moves, a stationary boundary, the plain search's independent limits,
and a reachable short-list target. Every negative case must leave the click
counter at zero; a found target must increment it once. Canonical results must
retain termination reason, executed count, configured limit and available progress.
It records commands before launch and partial process output on timeout using the
shared process-evidence helper from `validation/landscape-targeting/`. It stops on
uncertain effects and never replays input or substitutes coordinate taps.

`check-fixture.sh` compiles and verifies the fixture in standard Android CI.
Android tests cover the real legacy wrapper, per-action receipt, action engine
and canonical serializer. Separate cases retain every supported termination
value, including edge and lost-container outcomes. The signature-based runtime
currently establishes no movement rather than inferring an edge from identical
content; live checks do not claim positive edge detection.
