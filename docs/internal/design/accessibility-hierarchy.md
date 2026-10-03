# Accessibility hierarchy availability

Queries and XML snapshots obtain their hierarchy from the Operator accessibility
service. A visible screenshot does not guarantee an accessible root. A missing
root must remain a failure, not a zero-match result or another window's tree.
See [query failure behavior](../../api/actions.md#action-query-ui).

## Access and capture contract

Both Operator variants declare `android:isAccessibilityTool="true"` in the
shared service configuration. Android defines
[`isAccessibilityTool`](https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo#attr_android:isAccessibilityTool)
as identifying services used to assist users with disabilities. Androperator uses
this declaration for access to sensitive hierarchies and is distributed outside
Google Play.

Android 15's [AccessibilityInteractionController](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r1/core/java/android/view/AccessibilityInteractionController.java)
returns null from `getRootView()` when the root is sensitive and the request is
not from an accessibility tool. This filtering occurs before Androperator matching
or serialization. Selecting another window or clearing the accessibility cache
does not provide the requested application's hierarchy.

Queries and XML capture work on supported Android versions. Native capture reads
`AccessibilityNodeInfo.isAccessibilityDataSensitive` on Android 14 (API 34) and
later. Below API 34, or when the read fails, the flag is unknown. `UiNode` retains
nullable evidence; `NodeResolver` emits `accessibilityDataSensitive`, including
explicit nulls, in schema version 1. XML emits `accessibility-data-sensitive`
only when known. An absent JSON field also means unknown. CLI/raw/MCP preserve
the sensitivity evidence. See the [public contract](../../api/actions.md#action-query-ui).

The flag is metadata. It does not change matching, success, or logging and does
not establish private browsing or screenshot protection. A missing service or
root remains a capture failure; host screenshots are independent.

## Verification scope

Live verification covers Android 15 (API 35). This is the tested platform, not
the minimum API level for queries or XML capture. The Settings > Network &
internet > Internet screen has a sensitive root; its native content is a
`NetworkProviderSettings` preference/RecyclerView screen inside `SubSettings`.
Unit tests cover sensitivity reads on API 34 and unknown values on API 33.

## Regression and verification

The [device harness](../../../validation/sensitive-hierarchy-access/README.md)
uses branch-local CLI, raw execution, and a real named MCP call. It checks three
consecutive Internet queries, sensitive Settings root identity, Wi-Fi control
state/bounds/sensitivity against XML, a decoded screenshot, and a normal Display
& touch control screen. Loading content cannot satisfy readiness. Missing roots
fail immediately; all navigation and subprocess waits are bounded. The harness
leaves the device on Home and never changes network settings.

The manual CI workflow runs both APK variants on an API 35 Google APIs x86_64 revision-9
image with English locale. It checks the revision explicitly, verifies packaged
service metadata through the compiled resource table, runs offline assertions,
and executes the actual emulator regression. A new image requires deliberate
requalification. Android test suites use the shared Robolectric 4.11.1
dependency, which supports the API-34 method.

Implementation verification uses CLI 0.10.0, development APK 0.10.0-d, and release
APK 0.10.0 on an API 35 arm64 Google image, build AE3A.240806.036/12592187.
Evidence remains outside Git. APK inspection covers AAPT's version-qualified
service resource and release path shortening, including the manifest binding.

Acceptance completed on the implementation branch:

| Check | Outcome |
| --- | --- |
| Development upgrade, then connected service | Full Internet/CLI/raw/MCP/XML/screenshot/control harness passed |
| Release variant after fresh binding | Full harness passed |
| Restored development APK after fresh binding | Full harness passed, starting from a retained Internet subpage |
| Isolated same-code APK with `isAccessibilityTool=false` | Harness failed at Internet `query_ui` with `UI_TREE_UNAVAILABLE`, `serviceAvailable=true`, `rootAvailable=false`; correlation and failed step retained |
| Screenshot with unavailable hierarchy | Independent failure PNG decoded successfully |
| Packaged declaration and manifest binding | Both intended APKs passed; false-declaration APK was rejected |
| Android build and unit tests | Both variants built and all `testDebugUnitTest` tasks passed with shared Robolectric 4.11.1 |
| Node build and standard tests | 306 tests passed with the then-current limited discovery |
| Focused query/MCP tests | 94 tests passed, including sensitivity transport and older-payload compatibility |
| Offline harness fixtures | Five tests passed for hierarchy/state/XML failures and old-payload handling |
| Authored docs | Full docs build and route validation passed |

The negative-control source edit was restored, both intended APKs rebuilt, and
the intended development APK reinstalled. The temporary release installation
was removed and the original development service selection restored. No network
settings were changed. These results prove local acceptance. A manually
dispatched GitHub run is optional under the
[current release requirements](../release-reference.md#v010-acceptance-requirements).

The development upgrade briefly disconnected the service and then reconnected
without a manual re-enable. The release install encountered a stale/crashed
Android binding; disabling the selected service, stopping its process, and
re-enabling it restored navigation. Setup guidance describes re-enabling a
service that remains unavailable. These are observed lifecycle limits, not
permission to replay failed mutations inside capture.

The local emulator proves the Android filtering rule and capture contract. It
does not establish universal OEM/version support, a physical-device result,
Google Play eligibility, or private-browser behavior. The GitHub-hosted x86_64
job runs only through `workflow_dispatch`, by user direction to avoid slow PR
checks. It has no PR or push trigger; local validation does not claim a remote
CI result. No runtime skill consumes a strict NodeSummary schema requiring a
migration for this additive field.

## Test discovery and remaining MCP transport work

The [repository test runner](test-execution.md), merged in `39352855`, recursively
discovers every built Node test file without shell glob expansion. The focused
query/MCP checks above were run explicitly before that consolidation; their
historical counts describe only those checks.

The MCP transport sanitizer removes path-named fields, including `nodePath` and
`parentPath`, from the parsed query object. The serialized query inside the raw
envelope retains them. The live harness compares application content, state,
bounds, and sensitivity; it does not claim parsed observation-path parity.
A separate MCP transport change should distinguish observation paths from host
filesystem paths and test both field preservation and host-path sanitization.
