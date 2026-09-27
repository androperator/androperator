# Settings transport benchmark: emulator results

Measured on 2026-09-27. This report contains sanitized aggregates; raw hierarchies, screenshots, command evidence, and device identities remain in local timing artifacts.

## Method

- Runtime and harness commit: `5248fae96941ecf109a784028ed44abbecfde04b`. Node package version `0.12.5`, host Node `v24.11.1`.
- Same debug APK for both transports, package `com.clawperator.operator.dev`. Installed APK hashes were verified before each device run. SHA-256: `a5978b460b05be2359e1fe905eabb2f7be7ea516cc8babfe7aeda888bf91e6eb`.
- Devices: Android 15 / API 35, `sdk_gphone64_arm64`, portrait; Android 17 / API 37, `sdk_gphone16k_arm64`, unfolded. Both are ARM64 emulators.
- Three warmup runs and ten measured runs per transport per device. Alternating logcat/direct and direct/logcat pairs; devices measured sequentially. Both use the persistent Node API, without fresh CLI or daemon startup.
- Settings opens from a force-stopped state for every trial. The timer starts after the reset, includes readiness, main-list bottom verification, opening About, detail-list bottom verification, final snapshot, and screenshot acquisition/persistence. Reset and post-capture verification are reported separately. Raw JSON/report persistence is outside the timer.
- Each swipe lasts 300 ms followed by 300 ms settling. Bottom verification requires the configured final label plus two unchanged visible-label layouts after swipes. Selecting About also requires two stable observations with the target visible. System animation settings were unchanged (window and transition scales 1.0; animator scale unset).
- Both main lists end in Tips & support. The test verifies that bottom but selects About emulated device to avoid help content. API 35 ends the About page at Build number; API 37 ends it at Send feedback. Neither final entry is pressed.
- Each final PNG was validated, with matching hierarchy layouts before and after capture. The preliminary smoke screenshots were also visually checked. Profiles and reproduction commands are in [the prototype guide](direct-result-transport-prototype.md#repeatable-settings-flow-benchmark).
- Statistics below include only successful measured runs. All attempted runs and failures are retained. p95 uses nearest rank, so with ten samples it equals the maximum. These are debug emulator diagnostics, not release or physical-device guarantees.

## Complete flow

| Device | Transport | Passed / measured | Mean (ms) | Median (ms) | Min (ms) | Max / p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Phone emulator (API 35) | logcat | 10 / 10 | 13617.9 | 13597.8 | 13470.8 | 13810.4 |
| Phone emulator (API 35) | direct | 10 / 10 | 12882.5 | 12849.6 | 12451.1 | 13289.3 |
| Unfolded emulator (API 37) | logcat | 10 / 10 | 14910.9 | 14173.6 | 12581.8 | 23138.9 |
| Unfolded emulator (API 37) | direct | 10 / 10 | 12213.5 | 11702.1 | 11210.0 | 14464.5 |

Phone emulator (API 35): direct median flow time was **5.5% lower**, a reduction of **748.2 ms**. Median paired logcat-minus-direct difference was 801.3 ms. Warmups: 6/6 passed.

Unfolded emulator (API 37): direct median flow time was **17.4% lower**, a reduction of **2471.5 ms**. Median paired logcat-minus-direct difference was 1941.0 ms. Warmups: 6/6 passed.

## Stage medians

All values are milliseconds. Stage medians do not sum to the median complete flow.

| Stage | API 35 logcat | API 35 direct | API 37 logcat | API 37 direct |
| --- | --- | --- | --- | --- |
| openReady | 1705.0 | 1586.1 | 2873.1 | 1421.2 |
| mainBottom | 4943.9 | 4511.8 | 3867.4 | 3532.8 |
| selectDetail | 2280.1 | 2093.5 | 4195.6 | 3565.7 |
| detailBottom | 4169.2 | 4044.0 | 2642.1 | 2539.0 |
| finalSnapshot | 175.2 | 197.0 | 178.8 | 153.1 |
| screenshot | 334.4 | 359.0 | 390.8 | 406.6 |
| reset | 73.0 | 73.0 | 79.1 | 71.8 |
| verifyScreenshot | 180.1 | 156.5 | 192.1 | 151.3 |

`reset` and `verifyScreenshot` are outside the complete-flow timer. Screenshot still uses ADB screencap in both modes.

## Work and result sizes

| Device | Capture pixels | Commands per flow | Swipes: main / select / detail | Final hierarchy bytes | Nodes | Screenshot byte range |
| --- | --- | --- | --- | --- | --- | --- |
| Phone emulator (API 35) | 1080 x 2400 | 14 | 4 / 0 / 4 | 24460-24461 | 55 | 159783-161733 |
| Unfolded emulator (API 37) | 2076 x 2152 | 15-18 | 4 / 1 / 3, 4 / 3 / 3 | 27644 | 62 | 154340-156053 |

Phone emulator (API 35) command counts: logcat median 14, range 14-14; direct median 14, range 14-14.

Unfolded emulator (API 37) command counts: logcat median 15, range 15-18; direct median 15, range 15-15.

## Direct transport timing

These aggregate all timed-flow commands, including action-plus-snapshot commands and the screenshot result envelope. Reset and post-capture verification commands are excluded. Values are milliseconds unless labeled bytes.

| Metric | API 35 median | API 35 p95 | API 37 median | API 37 p95 |
| --- | --- | --- | --- | --- |
| handshakeRoundTripMs | 1.571 | 6.729 | 1.683 | 3.317 |
| connectionSetupMs | 54.634 | 87.672 | 55.337 | 71.674 |
| dispatchToResultHeaderMs | 816.915 | 1393.826 | 659.302 | 1225.702 |
| resultReceiveMs | 0.021 | 0.045 | 0.023 | 0.051 |
| resultReceiveAndValidateMs | 0.260 | 0.400 | 0.314 | 0.464 |
| androidResultWriteMs | 0.108 | 0.349 | 0.101 | 0.381 |
| androidResultAckRoundTripMs | 2.400 | 7.667 | 2.712 | 6.221 |
| totalTransportLifecycleMs | 908.456 | 1500.083 | 735.794 | 1331.362 |
| resultBytes | 49443.000 | 68303.000 | 77123.000 | 77491.000 |

Dispatch-to-header and lifecycle measurements include Android action execution and settling. Receipt may be very short when data has already buffered. Android write-to-ACK is a round trip that includes host receipt and validation; it is not one-way network flight time.

Phone emulator (API 35): 140 direct timing samples; 0 missing timing confirmations.

Unfolded emulator (API 37): 150 direct timing samples; 0 missing timing confirmations.

## Android snapshot timing

Correlated by command ID. These include snapshots used for navigation verification and the final snapshot, but exclude the post-capture check. Android values below are converted from microseconds to milliseconds.

| Device | Transport | Observed / expected commands | Hierarchy build median (ms) | Snapshot median (ms) |
| --- | --- | --- | --- | --- |
| Phone emulator (API 35) | logcat | 130 / 130 | 66.018 | 118.647 |
| Phone emulator (API 35) | direct | 130 / 130 | 67.816 | 108.689 |
| Unfolded emulator (API 37) | logcat | 143 / 143 | 23.161 | 28.849 |
| Unfolded emulator (API 37) | direct | 140 / 140 | 23.817 | 28.910 |

## Diagnostic batch retained separately

The initial harness revision, commit `c20d6302`, completed all API 35 trials but failed once per transport during About selection on API 37. In each failure, the preceding snapshot reported the row visible but the following click returned `NODE_NOT_FOUND`; the direct failure result was received and verified normally. Residual scrolling is a plausible explanation, not a proven transport fault. The revised harness waits for target stability before dispatching a click. All initial artifacts remain local; none of those measurements enter the tables above.

## Interpretation and remaining work

The transport comparison holds runtime code, APK, app flow, and verification policy constant within each device. The endpoint layout and work differ between Android versions, so compare transports within a device rather than treating the two emulators as interchangeable.

The verification policy is identical, but it can execute extra observations or reveal swipes when the UI is still moving. Command-count ranges above expose that variation; this is an end-to-end policy comparison, not an equal-packet microbenchmark.

Direct did not improve every stage: the phone emulator's final snapshot median increased from 175.2 to 197.0 ms, and screenshot median increased from 334.4 to 359.0 ms. The foldable's final snapshot decreased from 178.8 to 153.1 ms. These results do not establish a universal per-command speedup.

Flow totals are dominated by navigation, gestures, and intentional settling. Smaller result-delivery times therefore cannot translate directly into the same percentage improvement for the whole task. Launch-time variation and a small sample size also limit causal claims from the aggregate differences.

Next: repeat the same paired method on a physical device with an inspected local profile, matching APK, and fixed orientation. Preserve all failures. Release-build measurements and larger payloads remain separate follow-up before changing the default transport.
