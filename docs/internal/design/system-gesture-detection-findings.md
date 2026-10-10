# Android System Gesture Detection Findings

Historical research migrated from the former planning area. Observations and
proposals below apply to the recorded revision/date, not a claim of current
behavior. Reconcile against current code before acting. Task plans and unresolved
work live in the project notebook; durable evidence remains here.

Created: 2026-03-19

This document captures runtime findings about how Android system navigation is exposed through accessibility during recording. It is the findings log for the dedicated system-gesture-detection task, and it should be read together with plan.md (Notebook task android-system-gesture-detection) when implementation begins.

The main question is not just "did Back happen?", but "what accessibility evidence do we get when Back or Home happens under different navigation modes, and is that evidence strong enough to reconstruct replayable intent?"

This task is intentionally deferred until recording is complete enough that its output can serve as stable fixture input. The purpose of this document is to preserve the findings and their caveats so recording work can continue without losing the gesture-detection context.

## Current Scope

These findings are based on:

- `com.androperator.operator.dev`
- Play Store flows used as the primary manual test surface
- direct inspection of recorded NDJSON output after each manual interaction

This document currently covers:

- Samsung three-button navigation
- Samsung gesture navigation
- Google Play emulator gesture navigation
- Google Play emulator Home gesture navigation
- Google Play emulator intentional Recents navigation
- Google Play emulator Recents task-switching navigation
- successful Back navigation
- cancelled Back gesture navigation
- Home / launcher transitions as observed incidentally during those runs

This document does not yet claim behavior is universal across:

- Pixel / AOSP gesture navigation
- OEM skins other than Samsung
- third-party launchers
- Recents / app-switcher replayability
- long-press or predictive-back-specific variants

## Device Matrix

Behavior differs across OEMs, launchers, Android versions, and navigation modes. Future implementation work should treat device context as part of each finding rather than as incidental setup.

### Physical Samsung Device

- manufacturer: `samsung`
- model: `SM-S901E`
- Android version: `16`
- SDK level: `36`
- tested navigation modes:
  - Samsung three-button navigation
  - Samsung gesture navigation

### Google Play Emulator

- manufacturer: `Google`
- model: `sdk_gphone64_arm64`
- Android version: `15`
- SDK level: `35`
- image type: Google Play emulator image
- launcher package: `com.google.android.apps.nexuslauncher`
- tested navigation mode:
  - gesture navigation

## High-Level Findings

- True `press_key` recording for Back is still not working end to end on the tested Samsung device.
- Back is nevertheless observable through accessibility.
- The observed accessibility shape depends on the system navigation mode.
- Samsung three-button Back appears as a `click` on `com.android.systemui`.
- Samsung gesture Back appears as a transient `window_change` into `com.android.systemui`.
- Google Play emulator gesture Back matches the Samsung gesture pattern in the current samples.
- A successful gesture Back and a cancelled gesture Back are distinguishable in the current samples.
- Home is also observable through accessibility, but not as `press_key`.
- On the Google Play emulator, Home appears as launcher-owned `window_change` events rather than a `com.android.systemui` transition.
- Intentional Recents on the emulator appears noisier than Home and produces repeated launcher `Recent apps` transitions.
- Intentional Recents with task switching on the emulator is even more distinct: repeated `Recent apps`, launcher `scroll`, launcher `click`, then `window_change` into the chosen app.

## Limits Of Current Evidence

- Every named scenario currently has a sample size of one run.
- The successful-vs-cancelled gesture Back discriminator has evidence from two surfaces, but only one sample per surface.
- The Home-vs-Recents discriminator is currently grounded only in emulator samples.
- Samsung Home has not been tested yet.
- Samsung three-button Home has not been tested yet.
- Samsung three-button Recents has not been tested yet.
- Pixel or AOSP physical-device behavior is still untested.
- The current rules use temporal phrases like "immediately" and "quickly" without a measured time window yet.
- The current findings preserve event sequences, but they do not yet extract timestamp deltas needed to ground timing thresholds.
- String-based clues such as `"Back"` may be localized and should not be treated as universal.
- Predictive Back may affect the observed event stream and is not isolated yet.

## Core Conclusion So Far

The current implementation does not yet support a normalized semantic `press_key/back` event on this device path.

However, the proof of concept is in a better place than that statement alone suggests:

- system navigation actions are still entering the recording stream
- they may be inferable as semantic navigation intent
- that inference currently appears to be mode-dependent and OEM-dependent

The immediate engineering problem is therefore:

- not "Back is missing"
- but "Back is present in non-normalized accessibility shapes"

This matters because proper detection of Back, Home, and Recents is likely its own dedicated implementation task. The important question is whether the evidence captured here is sufficient to support a first-pass normalization layer.

## Test Inventory

### 1. Samsung Three-Button Navigation - Successful Back

Session:

- `manual-back-verify-20260319-093607`

Manual flow:

1. Leave Androperator.
2. Open Play Store.
3. Dismiss Play Pass popup.
4. Open account menu.
5. Press Samsung three-button Back.

Observed event mix:

- `window_change=7`
- `click=4`
- `press_key=0`

Key sequence excerpt:

```text
0  click          com.android.systemui             "Home"
1  window_change  com.sec.android.app.launcher     "One UI Home"
2  click          com.sec.android.app.launcher     "Play Store"
3  window_change  com.android.vending              "Play Store"
8  window_change  com.android.vending              "Account and settings. Dialogue"
9  click          com.android.systemui             "Back"
10 window_change  com.android.vending              "Play Store"
```

Interpretation:

- The Samsung three-button Back action was captured.
- It was not captured as `press_key`.
- It appeared as a `click` on `com.android.systemui` with title/text `Back`.
- The follow-up `window_change` back into Play Store strongly suggests this click represents a completed Back navigation.

### 2. Samsung Gesture Navigation - Successful Back

Session:

- `manual-gesture-back-20260319-094923`

Manual flow:

1. Leave Androperator.
2. Open Play Store.
3. Open account dialog.
4. Perform successful edge Back gesture.

Observed event mix:

- `window_change=10`
- `click=2`
- `press_key=0`

Key sequence excerpt:

```text
8  click          com.android.vending              null
9  window_change  com.android.vending              "Account and settings. Dialogue"
10 window_change  com.android.systemui             "android.view.View"
11 window_change  com.android.vending              "Play Store"
```

Interpretation:

- The successful gesture Back was captured.
- It was not captured as `press_key`.
- It was not captured as a System UI `click`.
- Instead, it appeared as a transient `window_change` into `com.android.systemui`, followed by a `window_change` back to the app's prior screen.

### 3. Samsung Gesture Navigation - Cancelled Back Gesture

Session:

- `manual-gesture-back-cancel-20260319-095545`

Manual flow:

1. System briefly entered Recents.
2. Return home.
3. Open Play Store.
4. Open account dialog.
5. Start edge Back gesture and cancel it before completion.

Observed event mix:

- `window_change=6`
- `click=2`
- `scroll=1`
- `press_key=0`

Key sequence excerpt:

```text
6 click          com.android.vending              null
7 window_change  com.android.vending              "Account and settings. Dialogue"
8 window_change  com.android.systemui             "android.view.View"
```

Interpretation:

- The cancelled gesture still produced a transient `window_change` into `com.android.systemui`.
- Unlike the successful gesture sample, there was no follow-up `window_change` back to `com.android.vending` `Play Store`.
- In the current samples, this is the clearest observable distinction between successful and cancelled gesture Back.

### 4. Google Play Emulator Gesture Navigation - Successful Back

Session:

- `emu-mainline-nav-20260319-100206`

Manual flow:

1. Start on launcher.
2. Open Play Store.
3. Open account dialog.
4. Perform successful gesture Back.

Observed event mix:

- `window_change=4`
- `click=2`
- `press_key=0`

Key sequence excerpt:

```text
0 click          com.google.android.apps.nexuslauncher  "Play Store"
1 window_change  com.android.vending                    "Play Store"
2 click          com.android.vending                    null
3 window_change  com.android.vending                    "Account and settings. Dialog"
4 window_change  com.android.systemui                   "android.view.View"
5 window_change  com.android.vending                    "Play Store"
```

Interpretation:

- The emulator did not emit `press_key`.
- The successful gesture Back matched the Samsung gesture-navigation pattern.
- A transient `com.android.systemui` `window_change` was followed by a return `window_change` into the app's previous screen.

### 5. Google Play Emulator Gesture Navigation - Cancelled Back Gesture

Session:

- `emu-mainline-nav-cancel-20260319-100404`

Manual flow:

1. Start on launcher.
2. Open Play Store.
3. Open account dialog.
4. Start gesture Back and cancel before completion so the dialog remains open.

Observed event mix:

- `window_change=3`
- `click=2`
- `press_key=0`

Key sequence excerpt:

```text
0 click          com.google.android.apps.nexuslauncher  "Play Store"
1 window_change  com.android.vending                    "Play Store"
2 click          com.android.vending                    null
3 window_change  com.android.vending                    "Account and settings. Dialog"
4 window_change  com.android.systemui                   "android.view.View"
```

Interpretation:

- The cancelled gesture still produced the transient `com.android.systemui` `window_change`.
- Like the Samsung cancelled-gesture sample, it did not produce the follow-up app transition back to Play Store.
- This strengthens the provisional success-vs-cancel discriminator for gesture Back.

### 6. Google Play Emulator Gesture Navigation - Home

Session:

- `emu-mainline-home-20260319-100829`

Manual flow:

1. Start in Play Store.
2. Perform Home gesture.

Observed event mix:

- `window_change=2`
- `click=0`
- `press_key=0`

Key sequence excerpt:

```text
0 window_change  com.google.android.apps.nexuslauncher  "Recent apps"
1 window_change  com.google.android.apps.nexuslauncher  "Home screen 1 of 1"
```

Interpretation:

- Home did not emit `press_key`.
- Home did not emit a `com.android.systemui` transition in this sample.
- The gesture stayed entirely within launcher-owned `window_change` events.
- The launcher briefly exposed `Recent apps` before settling on `Home screen 1 of 1`.
- This suggests that at least on this emulator surface, a Home gesture may transiently pass through launcher overview state on the way to Home.

### 7. Google Play Emulator - Intentional Recents

Session:

- `emu-mainline-recents-20260319-101242`

Manual flow:

1. Start in Play Store.
2. Perform slow gesture to open Recents.
3. Wait several seconds in Recents.
4. Click empty space.

Observed event mix:

- `window_change=5`
- `click=0`
- `press_key=0`

Key sequence excerpt:

```text
0 window_change  com.google.android.apps.nexuslauncher  "Recent apps"
1 window_change  com.google.android.apps.nexuslauncher  "Recent apps"
2 window_change  com.google.android.apps.nexuslauncher  "Recent apps"
3 window_change  com.google.android.apps.nexuslauncher  "Home screen 1 of 1"
4 window_change  com.google.android.apps.nexuslauncher  "Recent apps"
```

Interpretation:

- Intentional Recents did not collapse to a single `Recent apps` -> `Home screen` pair.
- It produced repeated `Recent apps` transitions, which makes it materially noisier than the simple Home sample.
- This supports a practical heuristic: a brief single-hop through `Recent apps` into `Home screen` can be treated as Home, while repeated or sustained `Recent apps` transitions should be treated as intentional Recents interaction.
- Clicking empty space after pausing in Recents did not yield a clean final "Home only" signature; the launcher still emitted another `Recent apps` transition. This reinforces the need to treat Recents normalization as heuristic-driven rather than exact.

### 8. Google Play Emulator - Recents With Task Switching

Session:

- `emu-next-nav-20260319-101739`

Manual flow:

1. Start in Play Store.
2. Use slow gesture to open Recents.
3. Swipe between recent apps.
4. Open Settings from Recents.

Observed event mix:

- `window_change=6`
- `scroll=3`
- `click=1`
- `press_key=0`

Key sequence excerpt:

```text
0 window_change  com.google.android.apps.nexuslauncher      "Recent apps"
1 window_change  com.google.android.apps.nexuslauncher      "Recent apps"
2 window_change  com.google.android.apps.nexuslauncher      "Recent apps"
3 scroll         com.google.android.apps.nexuslauncher      null
4 scroll         com.google.android.apps.nexuslauncher      null
5 click          com.google.android.apps.nexuslauncher      null
6 window_change  com.google.android.settings.intelligence   "Settings Services"
```

Interpretation:

- Recents with task switching is clearly richer than the Home path.
- Repeated `Recent apps` transitions are followed by launcher `scroll` events and then a launcher `click`, after which the chosen task is opened.
- This is a strong positive sample for classifying genuine Recents interaction rather than Home.
- It suggests that launcher-owned `scroll` events during or after `Recent apps` are especially valuable evidence that the user remained in overview and interacted with it intentionally.

## Working Inference Rules

These rules are provisional and based on the device/version matrix documented above.

### Three-Button Navigation

Potential semantic Back signal:

- `click` on `com.android.systemui` with title/text `Back`

Completion evidence:

- followed by app `window_change` to the expected prior screen

### Gesture Navigation

Potential semantic Back-start signal:

- `window_change` to `com.android.systemui`
- currently observed with class name `android.view.View` in both successful and cancelled gesture samples

Potential successful Back completion:

- `com.android.systemui` `window_change`
- followed immediately by app `window_change` to the expected prior screen

Potential cancelled Back gesture:

- `com.android.systemui` `window_change`
- no follow-up app `window_change` back to the prior screen

### Home Gesture On Mainline-Style Emulator

Potential semantic Home signal:

- launcher `window_change` to `Recent apps`
- followed quickly by launcher `window_change` to `Home screen`

Working hack:

- if `Recent apps` appears only briefly and is immediately followed by `Home screen`, treat that sequence as a Home gesture rather than an intentional Recents stop

Important caveat:

- this is a heuristic, not a guaranteed platform contract
- it should be documented as a best-effort normalization rule
- repeated or sustained `Recent apps` transitions should bias interpretation toward intentional Recents, not Home
- no millisecond threshold has been derived yet for "quickly"

Additional Recents signal:

- launcher `scroll` events while `Recent apps` is active strongly suggest intentional overview interaction rather than a simple Home gesture

## Suggested Normalization Rules

These are candidate implementation rules, not settled product behavior.

### Rule 1 - Samsung Three-Button Back

If all of the following occur:

- event type is `click`
- package is `com.android.systemui`
- title/text is `Back`
- followed by app `window_change` to a prior screen

Then infer:

- semantic action: `back`
- completion: `completed`

Current limitations:

- the observed `"Back"` label may be localized
- the current evidence base is one Samsung sample

### Rule 2 - Gesture Back Completed

If all of the following occur:

- transient `window_change` to `com.android.systemui`
- class name currently observed as `android.view.View`
- immediately preceded by an app screen that could navigate back
- immediately followed by app `window_change` to a prior screen

Then infer:

- semantic action: `back`
- source: `gesture`
- completion: `completed`

### Rule 3 - Gesture Back Cancelled

If all of the following occur:

- transient `window_change` to `com.android.systemui`
- class name currently observed as `android.view.View`
- preceded by an app screen that could navigate back
- no follow-up app transition to the prior screen

Then infer:

- semantic action: `back`
- source: `gesture`
- completion: `cancelled`

### Rule 4 - Home On Mainline-Style Gesture Navigation

If all of the following occur:

- launcher `window_change` to `Recent apps`
- very shortly followed by launcher `window_change` to `Home screen`
- no launcher `scroll`
- no launcher `click`
- no sustained repeated `Recent apps` sequence

Then infer:

- semantic action: `home`
- completion: `completed`

Current limitation:

- "very shortly" is not grounded to a measured time window yet

### Rule 5 - Intentional Recents

If any of the following occur while launcher overview is active:

- repeated `Recent apps` transitions
- launcher `scroll`
- launcher `click` followed by `window_change` into another app

Then infer:

- semantic action: `recents`
- completion: `interactive` or `completed`

## What We Can Say With Confidence

- `press_key/back` is not the only possible representation of Back in Android accessibility recordings.
- System navigation can be recorded even when the dedicated key path does not fire.
- On Samsung, Back semantics differ between three-button and gesture navigation.
- Successful and cancelled gesture Back appear distinguishable in the current samples on both Samsung gesture navigation and the Google Play emulator.
- On the emulator, Home appears distinguishable from Back because it stays in launcher-owned transitions and does not produce the `com.android.systemui` blip seen for gesture Back.
- On the emulator, Home also appears distinguishable from intentional Recents because Home produced a short `Recent apps` -> `Home screen` sequence, while intentional Recents produced repeated `Recent apps` transitions.
- On the emulator, Recents task switching is more distinct again because it adds launcher `scroll` and launcher `click` before transitioning into the chosen app.
- The current samples are strong enough to start a fixture-driven test suite for Back, Home, and Recents normalization.

## What We Cannot Yet Claim

- That these gesture-navigation event shapes generalize to all Pixel or AOSP devices outside the tested Google Play emulator.
- That every successful gesture Back will always produce the same `com.android.systemui` transition pattern.
- That every cancelled gesture Back will always omit the follow-up app transition.
- That replay should directly click observed System UI controls.
- That a single normalized Back heuristic is ready for production.
- That a single Home heuristic is ready for production without more intentional Recents testing.
- That Recents exit behavior is stable enough yet to model as anything stronger than a documented heuristic.
- That launcher `scroll` in Recents is universal across launcher implementations rather than specific to the tested emulator surface.
- That these heuristics are production-ready across OEMs.
- That the current rules have enough repeated samples to lock thresholds.
- That the current rules have a justified millisecond window for "immediate" or "quickly."
- That Samsung Home or Samsung three-button Recents will resemble the emulator patterns.

## Implications For The Record Proof Of Concept

- The proof of concept does not need to block on dedicated `press_key/back` support.
- Non-Back flows are already valid and useful.
- Back may also be POC-usable if replay or post-processing can infer semantic Back from recorded accessibility evidence.
- Gesture Back normalization now has evidence from two surfaces: Samsung gesture navigation and a Google Play emulator.
- Home may also require explicit heuristics, including a documented shortcut that treats a very short-lived `Recent apps` state followed by `Home screen` as Home on surfaces that animate through overview.
- Recents likely needs its own heuristic bucket rather than being treated as a special case of Home.
- Recents task switching may be one of the easiest system-navigation cases to detect, because the launcher can expose explicit overview scrolling and task selection.
- The right near-term goal is likely heuristic normalization with explicit documentation, not waiting for perfect raw `press_key` coverage.
- Any POC claim should currently be phrased as "Back is observable but not normalized."

## Recommended Near-Term Next Tests

1. Repeat Home on the emulator to see whether the `Recent apps` -> `Home screen` sequence is stable.
2. Repeat intentional Recents on the emulator to see whether repeated `Recent apps` transitions plus launcher `scroll` are stable.
3. Repeat cancelled gesture Back at least once more on the same Samsung device to check pattern stability.
4. Repeat successful gesture Back on a different screen and app.
5. Repeat three-button Back with a different app and target screen.
6. Test Samsung gesture Home.
7. Test Samsung three-button Home.
8. Test Samsung three-button Recents.
9. Test on a physical Pixel or AOSP-style gesture-navigation device if available.
10. Extract timestamp deltas from successful and cancelled samples to ground any time-window-based rule.

## Candidate Follow-Up Design Directions

These are hypotheses, not settled design decisions.

### Option A - Keep `press_key` As The Semantic Target

- Continue pursuing true `onKeyEvent` capture for Back.
- Treat current System UI observations as fallback diagnostics only.

Pros:

- cleaner schema
- simpler replay contract

Cons:

- may not match how modern Android surfaces navigation in accessibility

### Option B - Normalize Accessibility Evidence Into Semantic Navigation

- Accept that system navigation may surface as clicks or window transitions rather than key events.
- Add post-capture or parse-time normalization that infers semantic Back from observed patterns.

Pros:

- better aligned with what the runtime is actually exposing
- more likely to work across navigation styles

Cons:

- inference logic is more complex
- OEM variation risk is higher

## Open Questions

- Should Home and Back be represented as semantic actions inferred from accessibility evidence rather than raw key events?
- Is the distinction between successful and cancelled gesture Back stable across multiple runs?
- Does predictive Back animation change the observed accessibility signal?
- Does gesture sensitivity or edge region configuration affect the signal?
- Do Pixel devices expose gesture Back differently from Samsung?
- Should Home normalization explicitly collapse a short-lived launcher `Recent apps` state into Home on devices that animate through overview?
- What is the cleanest heuristic for distinguishing intentional Recents from a Home gesture that briefly traverses overview?
- How stable are launcher `scroll` signals during Recents task switching across launchers and OEMs?

## Implementation Readiness

An implementation agent should be able to start a first-pass Back / Home / Recents normalization layer from this document and plan.md (Notebook task android-system-gesture-detection) alone.

What this document already provides:

- device and Android version context for each finding
- positive and negative samples
- exact event-sequence excerpts for each tested case
- candidate heuristic rules
- explicit caveats about where the rules may fail

What an implementation agent would still need beyond these task documents:

- access to the codebase where normalization should live
- a product decision about whether normalization belongs at capture time, parse time, or replay time
- more device coverage before calling the heuristics production-ready
- explicit confirmation that parser responsibilities may expand if normalization lives at parse time

What the agent should not need:

- access to `<private_recordings_dir>/` just to understand the findings in this document

The `<private_recordings_dir>/` files were useful during investigation, but the key findings and representative event sequences are preserved here precisely so future work does not depend on local capture artifacts.

## Current Bottom Line

Back is not absent from recordings.

Back is present, but in different accessibility forms depending on navigation mode:

- Samsung three-button Back: `com.android.systemui` `click`
- Samsung gesture Back: transient `com.android.systemui` `window_change`
- Google Play emulator gesture Back: transient `com.android.systemui` `window_change`

Home also appears to be observable without `press_key`, and on the emulator it currently looks like:

- launcher `window_change` to `Recent apps`
- then launcher `window_change` to `Home screen`

Intentional Recents on the emulator currently looks different:

- repeated launcher `window_change` events titled `Recent apps`
- potentially interleaved with a later `Home screen` transition
- possibly followed by another `Recent apps` transition depending on how the launcher settles
- and, in the stronger task-switching sample, launcher `scroll` plus launcher `click` before opening the chosen task

That likely means some system-navigation actions will require explicit normalization hacks. That is acceptable for the proof of concept as long as the heuristics are clearly documented, tested against positive and negative samples, and treated as best-effort rather than as a guaranteed Android contract.

The dedicated `press_key` path remains unresolved, but the system-navigation evidence recorded so far is strong enough to justify further testing and likely supports a proof-of-concept path based on inference and normalization.

That future normalization work should remain a separate task while recording capture and parsing are completed first.
