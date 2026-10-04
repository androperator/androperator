# On-screen log implementation and verification

The public contract is [On-screen logs](../../api/on-screen-logs.md).
Literal text remains caller-supplied. Templates resolve device and application
metadata locally through Android. Arbitrary expressions, host polling and
capture interleaving are outside the implemented contract.

## Ownership and invariants

- `OnScreenLogPanelController` in the Androperator Operator App module owns the window,
  generation, draw acknowledgement, and expiry on the main thread. Invalid
  replacement preserves existing state. A configuration change deferred during
  a set must draw within the original deadline; reflow preserves absolute expiry.
  Controller comments and tests own these invariants.
- The custom-drawn view has no accessible text descendants. Exact controller
  identity distinguishes this panel from unrelated overlays. App selectors and
  foreground selection must not fall back to the panel.
- The Node CLI builds canonical actions and uses `runActionExecution`; the
  canonical validator owns limits and normalization. Mutation proxy tests cover
  safe pre-dispatch fallback and no replay after uncertain dispatch.
- The fixed-scenario proof Activity is debug-only and absent from release
  builds. It is not production ingress or proof of CLI behavior.

## Repeatable proof

Build the branch-local Node CLI and matching debug APK before running proof.
Do not rebuild or run the docs pipeline concurrently with live CLI proof:
`docs_build.sh` runs `npm ci` and replaces dependencies and compiled output.
Use an explicitly selected dedicated debug device.

```bash
bash validation/on-screen-logs/test_overlay_mechanism_proof.sh
bash validation/on-screen-logs/test_raw_execution_contract.sh
bash validation/on-screen-logs/test_cli_contract_proof.sh
bash validation/on-screen-logs/run_cli_contract_proof.sh --device <device_serial> --output-dir <absolute_output_dir>
```

The CLI harness records each command, result, status, expected image label,
and saved/restored device settings. Offline tests cover failures with settings
already changed, service deletion, interruption, and service restoration before
cleanup clear. Empty accessibility-service lists require deleting the setting;
adb can drop an empty value passed to `settings put`.

Review every capture independently and supplement the harness with playable
replacement/clear video, app bounds/foreground comparisons, read/wait/click
exclusion for panel-only labels, touch-through interaction, and another real
overlay. A successful draw or screenshot command does not prove capture pixels.
Use separate awaited set, screenshot, replacement, screenshot, and clear calls.
MCP must omit screenshot paths and use its returned runtime-managed path.

Use branch-local snapshots for app inspection. Standalone `uiautomator dump`
was observed to disrupt the active accessibility-service environment during
proof. For app navigation, await the expected foreground before comparing
bounds; an immediate post-back snapshot can still describe the outgoing app.

## Coverage and follow-up

The implementation proof at `33d69ed` passed the Node package selection (280
tests), focused public-interface selection (210 tests), relevant Android build
and unit suites, harness tests, and docs build. API 35 emulator proof inspected
30 full-display PNGs, including all 20 images from ten capture cycles without
missing/stale labels, and a playable H.264 replacement/clear video. Settings
were restored and the final panel was hidden. Original local evidence remains
ignored under `validation/on-screen-logs/artifacts/pr2/`; it is not a required
build input or a publicly hosted artifact.

API 35 is the only live-tested platform in that evidence. API 21 fails closed;
API 22+ supports placement except API 28 devices declaring a built-in cutout.
Older compatibility paths retain unit coverage. Before expanding live support
claims, run the public CLI proof on the additional OS/device, inspect all
captures, and record its result and limitations here. Physical-device and
secure-window capture remain unverified. Serve/MCP transport proof uses local
executor tests, not a live remote client.

The host screenshot pipeline captures pixels after the Android action list
returns. If atomic action/capture interleaving is later required, design it
separately against `apps/node/src/domain/executions/runExecution.ts` and add
cross-transport capture tests before changing the documented guarantee. The
separate-execution sequence is the supported workflow today; this is not an
unfinished requirement of the static panel feature.

## Template implementation

`OnScreenLogTemplate` and the Node template validator share the closed grammar
and `validation/on-screen-logs/template-fixtures.json`. Validation precedes panel
mutation. The public page owns names, delimiter escaping, UTF-16 limits and
fallbacks. `OnScreenLogSpec` retains the caller's template separately from literal
text; expanded content never enters action results or snapshot metadata.

`OnScreenLogTemplateSession` belongs to one accepted panel lifetime. It starts
after initial draw acknowledgement. Its initial content contains device/system
values and unavailable application fields, so PackageManager latency is outside
the draw deadline. The panel uses the existing `StaticLayout` and `ImageSpan` for
inline icons, including the legacy layout path; it creates no accessible child
views. Icon resources use the application's declared resource ID, not a guessed
launcher name. Loading a missing resource produces a neutral gray icon instead
of PackageManager's implicit default-icon substitution.

The session collects the production [foreground observer](foreground-application-observation.md)
only when a parsed token requires application data. It reads the overlay window
manager's display ID. A service context's `display` accessor is not valid here:
that caused a panel to disappear immediately in the first live attempt and is
covered by the service-context session regression test.

Each observation supplies one package for all app fields. A new observation
immediately draws cached metadata or the new package with unavailable metadata.
A conflated refresh channel and `collectLatest` permit one metadata resolution
per session at a time. Revision checks reject stale results, even if a lookup
ignores cancellation. Two process-wide semaphore permits also bound obsolete
lookups across rapid replacement of whole sessions. Cache mutation and drawing
happen on the main dispatcher; PackageManager and icon rasterization run on IO.

The per-session access-order cache holds at most eight packages. Each icon is
rasterized to 128 x 128 ARGB pixels and each inline drawable is capped at 256 px.
The grammar bounds token count through the 2048-unit input limit; expansion is
capped at 8192 units and each metadata string at 256. Surrogate pairs are not
split. Package added/removed/replaced/changed broadcasts invalidate cached and
pending reads. Locale broadcasts invalidate locale-dependent metadata. Session
close unregisters both receivers, clears the cache and cancels all its work.

System language uses `LocaleManager.systemLocales` on API 33+, independently of
per-app overrides, and system resources on older APIs. The native display name
uses that locale as its own display locale. Build manufacturer/model are static
Android values. Configuration changes reflow the panel and refresh its values.

Controller lifetime identity is separate from draw generations: refresh reflows
can change the draw generation without invalidating the live subscription. TTL
retains its original absolute monotonic deadline. Replacement, clear, expiry,
detach and refresh failure invalidate the lifetime before cancelling work.
Refresh layout or drawing setup failures remove the panel. They cannot emit a
second result into a completed execution. Literal-text behavior and the original
initial-draw deadline remain unchanged.

## Template verification on the Fold emulator

Verified on 2026-09-19 on the requested Pixel 10 Pro Fold AVD, confirmed by its
console AVD name and `hw.device.name=pixel_10_pro_fold`, on Android 37.2. The
branch-local Node CLI explicitly selected the discovered serial and debug
Operator package. The matching debug APK was installed. No physical device or
other emulator substituted for this target.

A single all-nine-token template remained configured while shell input switched
applications, entered split-screen, changed focus and typed with the soft
keyboard. No additional Node requests drove the focus sequence. Eighteen
captured pane changes (six slower, twelve rapid) matched independent window
focus dumps and inspected pixels. Settings rendered its settings icon,
`com.android.settings`, `37`, `17`; Chrome rendered its Chrome icon,
`com.android.chrome`, `782700532`, `149.0.7827.5`. Settings search correctly
identified `com.google.android.settings.intelligence`, rather than its parent
Settings app. Soft-key input in both panes and focus changes in both directions
kept the icon/package/version tuple coherent. A tap on the search field through
the panel confirmed touch-through input. Home and recents identified the launcher;
split entry included an explicit unavailable state with a neutral icon.

The 180-second H.264 screen recording was decoded and its sampled pixel frames
inspected alongside full-display captures. The rapid segment's saved captures
were approximately half a second apart, including input, settling, capture and
window inspection overhead. This measures the test sequence, not an
observer-to-render latency guarantee. Intermediate states can be coalesced.

Changing the system locale from `en-US` to `de-DE` updated the same panel to
`de | de-DE | Deutsch`. Setting the Operator's per-app locale to `fr-FR` left
those system-language fields unchanged. Locale settings were restored afterward.

The privileged debug-only `OnScreenLogProofActivity` adds fixed template
scenarios through the production controller's internal injectable metadata seam:

- `template-missing` preserves the real observed package while forcing missing
  metadata and icon; inspected pixels show the neutral icon and unavailable text.
- `template-long` injects a 64-bit decimal code and oversized version name into
  an 80 dp panel; captures show wrapping and bounded ellipsis truncation.
- `template-clear-pending`, `template-expire-pending` and
  `template-replace-pending` delay metadata for 2500 ms in a non-cancellable block.
  Logs establish lookup start/end. Before/after captures show no resurrection
  after clear or 1000 ms expiry, and only the literal replacement after replacement.

These forced scenarios establish real controller/window behavior with controlled
metadata. They do not claim an installed app actually lacked metadata, used a
version code above 32 bits, or performed a package update during the live run.
Package invalidation, failed lookups, stale non-cancellable results, zero
foreground subscriptions for device-only templates, expansion bounds and
refresh failure cleanup also have controlled regression coverage. Older locale
and layout compatibility paths remain offline coverage.

Repeat a fixed scenario after installing the debug APK and enabling its service:

```bash
adb -s <device_serial> shell am start \
  -n com.androperator.operator.dev/androperator.operator.debug.OnScreenLogProofActivity \
  --es scenario template-clear-pending
```

The existing activity requires `android.permission.DUMP` and is absent from
release builds. Forced lookup delays are bounded and are not public action
parameters. Capture before and more than 2500 ms after starting a pending
scenario, and inspect `OnScreenLogTemplateProof` logs. Clear after proof.

### Capture limits on this image

The standard branch-local screenshot action returned
`UNSUPPORTED_RUNTIME_SCREENSHOT`; its resulting file was not a decodable PNG.
The existing mechanism harness likewise produced invalid default-display PNGs.
Those files are not counted as pixel evidence. Explicit SurfaceFlinger display
selection produced valid 2076 x 2152 PNGs and video, which were inspected.
Separate awaited set, capture, replacement and clear executions were used.
The screenshot pipeline and its result contract were not redesigned.

Raw evidence, window dumps, command results, video and contact sheets are retained
locally outside tracked sources. The task report links that directory. Public
capture guarantees remain those on the API page. Secure-window, physical-device,
other-display and older-API template behavior were not live-verified.

### Final revision follow-up

After the final immediate-focus clearing and declared-icon fallback changes, a
fresh matching APK passed another eight Settings/Chrome pane switches, including
six rapid switches, with coherent icons and versions in all eight inspected
captures. A separately decoded recording showed both focus directions and exit
from split-screen into full-screen Chrome. A branch-local snapshot omitted the
unique visible template label, confirming selector isolation.

One attempted follow-up reused coordinates while Settings search still owned
an active text field. Focus brought back the IME, and later taps entered text
rather than changing panes. Window dumps agreed with the panel. That sequence
is retained as failed test input and excluded from the eight passing switches;
the successful retry used settled Settings main and inspected pane geometry.

The Node build/full suite passed 1665 tests. Android assembly and the app,
operator and shared test suites passed (1, 89 and 346 tests respectively).
All three existing overlay harness self-tests passed. The live CLI harness
completed its command-contract cases and restored its saved rotation, font scale
and accessibility settings, but its default screenshot files share the Fold
capture limitation above. Those visual gates are supplied by the separate
explicit-display captures, not by the harness's process exit. Runtime skill
consumers were inspected; no sibling skill uses these actions, so no skill
contract or version changed.
