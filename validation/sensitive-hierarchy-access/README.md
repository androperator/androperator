# Sensitive hierarchy access regression

Run from the repository root after building Node and installing the matching APK:

```sh
python3 validation/sensitive-hierarchy-access/run.py --device <device_serial> --operator-package com.androperator.operator.dev --out /tmp/sensitive-hierarchy-proof
```

Use an unlocked Android 15/API 35 emulator with Google APIs image revision 9,
English (`en-US`), and Settings from that image. The manual CI workflow uses
`system-images;android-35;google_apis;x86_64`, revision 9, Pixel 6 profile.
The image revision is checked and a changed image fails CI until deliberately
requalified. The publisher's revision-9 archive is
`https://dl.google.com/android/repository/sys-img/google_apis/x86_64-35_r09.zip`
(SHA-1 `0103e6dab21290c4b9d16550a3ce99476f884eef`). Local implementation proof
uses the corresponding API 35 arm64 image. No network connection is required.

Only the selected Operator should be active on this dedicated test device.
Use the checked-in setup helper before each variant:

```sh
python3 validation/sensitive-hierarchy-access/prepare_operator.py \
  --device <device_serial> --operator-package com.androperator.operator.dev \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk --out /tmp/hierarchy-debug-setup
```

The helper holds the device lock, disables accessibility, removes the enabled
service list and waits for all bindings to disconnect before stopping the two
Operator packages and installing the selected APK. It launches the selected
Operator, enables only its service, grants notification permissions, waits for
one healthy binding, and requires both doctor and a nonempty query to succeed.
Binding observations are bounded by 15 seconds and 30 attempts per phase; failed
commands are not retried. Each setup uses a new artifact directory and records
commands, outputs, deadlines and the APK hash. CI uses this same helper for both
variants sequentially. This explicitly replaces accessibility-service selection
on the dedicated emulator; it does not clear application data or change network
settings. The capture harness itself does not install APKs or change permissions.

The harness uses branch-local CLI commands and a real stdio MCP session. It
requires successful correlated envelopes, three consecutive Internet queries,
raw/MCP query parity, the sensitive Settings root, Wi-Fi switch state/bounds/XML
parity, a decoded PNG, and the Display & touch control screen. Internet readiness requires the destination's `collapsing_toolbar` labeled
`Internet`, the `Wi-Fi` row, and `switchWidget` together. The outgoing Network &
internet page's Airplane mode switch and the Internet loading page cannot satisfy
readiness. At most 30 successful queries run within 15 seconds, with each process
bounded by the remaining deadline. Query/service/transport failures fail
immediately; no navigation is replayed. Sensitivity, unique switch/state and
parity assertions still apply to the separate captures after readiness.
`internet-preparation.json` retains the readiness verdict and observation count. A missing hierarchy fails immediately; it is never
converted to zero matches or a skip. Connected-row evidence is compared when
present. Each subprocess has a deadline; readiness is bounded. A per-device lock
serializes cooperating harnesses. Do not run other automation on the device.

Preparation supports a fresh Settings process, an ordinary restored subpage, and
a restored `com.google.android.settings.intelligence` search activity. Under the
same device lock, it records the activity stack, force-stops only that search
package and `com.android.settings`, then launches Settings once through the CLI.
It does not clear application data, reset the device, or change network settings.
Launch success is required but does not itself establish readiness.

Within a 60-second preparation deadline, at most five successful queries check
for unique on-screen `settings_homepage_container` and
`main_content_scrollable_container` nodes and the `Network & internet` row.
API 35 also requires the expanded, scrollable outer homepage container. A search
label alone cannot satisfy the check. Only successful queries of an unsettled
screen can be observed again; command, service and transport failures stop the
run immediately, with no replay. Capture assertions cannot run until preparation
passes. The Display scroll scenario remains unchanged.

API 35 remains the default for this device harness. For an explicit
API 36 comparison, pass `--api 36`. Its Settings homepage has a fixed outer header;
preparation instead also requires the on-screen `search_action_bar` and first
`Google` row. This comparison does not qualify the API 35 image or reproduce its
collapsing-container scroll transition. Other API values are rejected.

Cleanup attempts Home once, including after failure, and records whether it
succeeded. Settings retains its last visited page. Network settings are unchanged. Output contains raw responses, errors, device/package
metadata, XML, and screenshots; keep it outside Git on personal devices.
`preparation.json` records the preparation verdict, selected device/Operator,
expected API, original and launched activity stacks (including foreground package
when available), deadline, observation count and elapsed time. Each numbered
command retains its arguments, stdout/stderr, exit status and stage/timeout
context. Source commit, the repository-wide tracked diff against HEAD (including
staged and unstaged changes and binary patches), a NUL-delimited inventory of
non-ignored untracked files, CLI version and installed-package metadata are also
captured. Untracked file contents and ignored build outputs are not archived;
commit source files before collecting release evidence. `failure.json` distinguishes prerequisites, preparation,
Internet navigation, capture/parity and Display control failures. The original
failure remains in `failure.txt`; `failure-screenshot.json` and `cleanup.json`
record secondary attempts without replacing it. Use a new output directory for
each attempt and retain failed runs alongside later runs. CI uploads evidence from its disposable emulator.

Offline checks:

```sh
python3 -m unittest discover -s validation/sensitive-hierarchy-access -p 'test_*.py'
python3 validation/sensitive-hierarchy-access/check-apk.py --aapt2 <aapt2_path> <debug_apk> <release_apk>
```

The APK check resolves the compiled resource table, including version qualifiers
and release resource path shortening. It must find a true declaration for API 31+.
Offline tests cannot prove Android's filtering behavior. The manual CI workflow actually
runs `ci-device.sh` under the emulator runner; it does not stop at APK installation.

Run the **Sensitive hierarchy access** workflow manually from GitHub Actions when
release validation or an explicit device regression is needed. It has no pull
request or push trigger. Ordinary PR checks do not boot this emulator. For v0.10,
the release owner selected local `./validation/test_all.sh` verification on
13 September 2026; a GitHub run is optional. The default local suite runs offline
assertions, not this live device harness. See the
[release requirements](../../docs/internal/release-reference.md#v010-acceptance-requirements).


## Integrated hierarchy and transport acceptance

Scroll eligibility (`28b8b1fa`), homepage preparation (`460e654c`), and result
transport (`0c4ed5ce`) were tested together with harness follow-ups in `76713f9` and
`306b38d`. Runtime code was unchanged from merged `0c4ed5ce`. Matching CLI
`0.10.0`, debug `0.10.0-d` and release `0.10.0` APKs were built locally. The
13 September 2026 final run used a dedicated English API 35 Google Play arm64
revision-9 emulator, build `AE3A.240806.036/12592187`, at 1080 by 2400, density 420.
This local image is distinct from the manual Google APIs x86_64 CI image above.

Two remaining harness problems were repaired:

- Readiness previously accepted the Airplane mode `switchWidget` on the outgoing
  Network & internet page. The next capture could then see the Internet loading
  page without its Wi-Fi switch. Requiring the destination toolbar and Wi-Fi row
  fixes that premature readiness; the capture assertions remain unchanged.
- During variant replacement Android retained two connections to the release
  service, listed it as both bound and crashed, and reported input-method
  bind/unbind mismatches. Doctor's handshake passed, but launch waits timed out
  and queries had no root. A controlled complete disconnect/reconnect restored
  the same APK's hierarchy and launch behavior. The setup helper now waits for
  teardown before installation and verifies a healthy binding and usable query
  after activation. This addresses the observed setup state without weakening
  foreground-package contracts or retrying failed runtime commands.

The final fixed matrix ran once after these repairs. Each starting activity was
observed before invoking the checked-in capture harness; subpage/search fixtures
used strict CLI clicks. All six runs passed preparation, three repeated Internet
queries, raw/MCP/XML state and bounds parity, PNG decoding, the unchanged Display
scroll, its Brightness level postcondition, and Home cleanup.

| Variant | Initial state | Preparation observations / seconds | Internet readiness observations | Full harness |
| --- | --- | --- | --- | --- |
| Debug | Fresh processes | 1 / 1.81 | 2 | Pass |
| Debug | Restored Settings subpage | 1 / 1.90 | 3 | Pass |
| Debug | Verified Settings Intelligence search | 1 / 2.00 | 3 | Pass |
| Release | Fresh processes | 1 / 1.73 | 3 | Pass |
| Release | Restored Settings subpage | 1 / 1.86 | 3 | Pass |
| Release | Verified Settings Intelligence search | 1 / 1.81 | 3 | Pass |

Homepage container, content container, search bar and Network & internet bounds
and state were identical across all six preparations. The final fixed transport
series then passed 20 immediate Settings open/query cycles and 20 full Internet
queries per variant: 60/60 commands each, 120/120 total. Full query responses were
32,345-69,786 bytes in both variants and exercised chunking. Settings processes
were closed before each transport series so it began at the homepage. No failed
attempt was retried within a series. Both variants ended on Home.

The tested source was `306b38dfe778b075094ec7187b3d3af2166eee4c`. APK SHA-256:

- Debug: `a155fd245ce1dbfa4eae95639f2e4e33a634abb91f19f07a77ed2f8e37ae1b75`.
- Release: `1e9535d884d05079e23f50ecd5bb6e55fc56acd1baab3cf874eb582714b4861d`.

Node's 1,496 tests, Android's 463 unit tests, both APK builds, all 25 focused
hierarchy/setup/source-evidence tests, repository validation and the docs build
passed. Docs route/link checks passed with no organization warnings. Device
runs happened after builds completed. Evidence includes source/build identity,
all raw command outputs, screenshots, XML, activity stacks, setup state and
transport attempt reports. Captures remain private and untracked.

### Retained failures and release limits

Earlier evidence is not erased by the passing final matrix. The original API 36
investigation passed debug preparation but failed the sensitive-root assertion;
release also showed launch/root/cleanup failures. The initial API 35 recheck of
`460e654c` retained scroll-container loss, transport errors, a premature Internet capture,
and device interruptions. Those findings motivated integrated validation.

With the Internet readiness fix alone (`76713f9`), debug passed all three full
runs and 60/60 transport commands. Release failed its fresh launch and both
subpage/search setup launches in the stale-binding state described above. Its
transport series was stopped for diagnosis: two completed commands failed, the
next command was interrupted, and remaining attempts were not run. The failed
commands and interruption are retained separately from the final post-setup-fix
series. The controlled rebind preserved before/after evidence using the same APK.

This revision completed the local hierarchy and transport integration matrix.
A later reader-exit recurrence and subsequent diagnostic work are recorded in
the transport design record below; this matrix does not close that causal gate.
A finite passing sample is not a zero-failure transport guarantee, and original
historical transport root-cause limits remain in the
[transport design record](../../docs/internal/design/result-transport-reliability.md).
The supported-image GitHub workflow remains an optional regression tool under
the local verification decision above. These historical local passes do not
claim a run on that CI image or close the transport causal gap.
