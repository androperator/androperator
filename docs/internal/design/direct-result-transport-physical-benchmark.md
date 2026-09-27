# Physical Pixel 10 Pro: Settings transport benchmark

Measured on 2026-09-27 using the same debug APK as the [emulator comparison](direct-result-transport-settings-benchmark.md). The requested device label is used throughout; no device identifier or raw screen evidence is retained in these results.

## Method

- Runtime/harness commit: `0bf47886639f0c0ba5285986422c92d020e92413`; Node package `0.12.5`, host Node `v24.11.1`.
- Debug Operator `com.clawperator.operator.dev`; installed APK hash verified against the measured file. SHA-256: `a5978b460b05be2359e1fe905eabb2f7be7ea516cc8babfe7aeda888bf91e6eb`.
- Physical Pixel 10 Pro: Android 17, API 37, USB connection, portrait. Three warmup and ten measured trials per transport, alternating pair order.
- The same endpoint and target-stability policy as the corrected emulator runs: close Settings outside the timer, open and wait, verify the main-list bottom, select About phone, verify its bottom, take a final hierarchy snapshot and screenshot. A post-capture snapshot checks that the layout stayed stable outside the flow timer.
- The physical profile uses Network and internet for readiness, Device health and support as the main-list final row, About phone as the selected page, and Build number as its final row. The final row is never pressed.
- Runs used `--device-label "Physical Pixel 10 Pro" --summary-only`. Raw results and hierarchy XML were not persisted. PNGs were verified and deleted after each trial. Android timing logs contain only numeric timings and benchmark-generated command IDs. Summary files were checked for the connected device identifier; no occurrences remained.
- Timing logging was enabled for the run and its original setting restored. Counts and timing summaries include the same measured interval as the emulator report. Privacy output handling changed after that report, but the device-action and verification policy is unchanged.
- p95 uses nearest rank, so with ten successful samples it equals the maximum. Statistics exclude warmups and failed trials, with failure counts retained separately.

## Complete flow

| Transport | Passed / measured | Mean (ms) | Median (ms) | Min (ms) | Max / p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| logcat | 10 / 10 | 25825.3 | 25761.3 | 24881.2 | 26637.6 |
| direct | 10 / 10 | 28744.0 | 28685.7 | 28193.6 | 29335.7 |

Direct median flow time was **11.4% higher** than logcat (2924.4 ms difference). Warmups: 6/6 passed. Measured failures: logcat 0, direct 0.

Median paired direct-minus-logcat difference: 2974.1 ms. This is an observed end-to-end difference, not a pure transport-speed estimate.

## Stage medians

All values are milliseconds. Stage medians do not sum to the median total.

| Stage | Logcat | Direct |
| --- | --- | --- |
| openReady | 2003.1 | 2062.9 |
| mainBottom | 7205.8 | 7242.3 |
| selectDetail | 8159.2 | 9022.7 |
| detailBottom | 5761.3 | 7036.9 |
| finalSnapshot | 859.3 | 1129.3 |
| screenshot | 1802.2 | 2218.6 |
| reset | 490.9 | 526.6 |
| verifyScreenshot | 844.4 | 1112.8 |

`reset` and `verifyScreenshot` are outside the flow timer. Screenshot acquisition and persistence use ADB in both modes; privacy-mode deletion occurs outside the measured interval.

## Work and evidence

| Transport | Commands median / range | Hierarchy bytes | Nodes | Capture pixels | Screenshot byte range |
| --- | --- | --- | --- | --- | --- |
| logcat | 16 / 16-16 | 28102 | 63 | 1080 x 2410 | 179158-182005 |
| direct | 16 / 16-16 | 28102 | 63 | 1080 x 2410 | 179267-181697 |

## Direct connection timing

These aggregate measured-flow commands only. Values are milliseconds except `resultBytes`.

| Metric | Median | p95 |
| --- | --- | --- |
| handshakeRoundTripMs | 6.212 | 12.169 |
| connectionSetupMs | 351.722 | 401.825 |
| dispatchToResultHeaderMs | 1081.375 | 1672.458 |
| resultReceiveMs | 0.037 | 3.397 |
| resultReceiveAndValidateMs | 0.486 | 4.445 |
| resultBytes | 80049.000 | 80423.000 |
| androidResultWriteMs | 2.351 | 5.404 |
| androidResultAckRoundTripMs | 11.434 | 19.814 |
| totalTransportLifecycleMs | 1451.949 | 1993.566 |

Direct timing confirmations missing: 0. Android send-to-ACK includes socket write, host receipt/validation, and acknowledgment. It is a round trip, not one-way flight time. Setup is measured separately; dispatch-to-header and total lifecycle include Android execution.

## Android snapshot timing

Android microseconds are converted to milliseconds here. Navigation-verification and final snapshots are included; post-capture verification is excluded.

| Transport | Observed / expected commands | Hierarchy build median (ms) | Snapshot median (ms) |
| --- | --- | --- | --- |
| logcat | 150 / 150 | 95.471 | 119.605 |
| direct | 150 / 150 | 92.915 | 121.956 |

## Interpretation

Compare transports within this device. The emulator and physical layouts, payloads, and connection costs differ; their total times are not interchangeable. These small debug-build samples do not establish release performance or behavior across all physical devices.

Both transports executed exactly 16 commands per flow and captured the same 28,102-byte final hierarchy. Android snapshot medians were similar (119.6 ms logcat, 122.0 ms direct), while direct setup alone had a 351.7 ms median per command versus an 11.4 ms send-to-ACK round trip. Setup is a substantial transport-specific cost, although this experiment does not isolate every source of the total difference. A focused follow-up is to measure connection reuse while preserving device/session isolation. Keep logcat as the default while that is investigated.

Before changing the default transport, measure release builds and larger result payloads, and complete the remaining contention/restart/isolation checks in the prototype guide. The per-command setup cost and result-to-ACK interval are distinct optimization targets.
