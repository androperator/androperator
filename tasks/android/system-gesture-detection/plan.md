# Android System Gesture Detection Plan

Created: 2026-03-19

## Goal

Implement reliable semantic detection for Android system navigation actions that do not consistently surface as raw `press_key` events during accessibility recording.

Initial semantic targets:

- `back`
- `home`
- `recents`

This is a dedicated task because the problem is not a single event hook. It is a normalization and inference problem with device-specific behavior, launcher-specific behavior, and a real risk of flakiness if the implementation is not test-driven.

This task should not begin until the recording functionality is complete enough that recorded output, parser boundaries, and fixture inputs are stable. The point of this plan is to preserve the implementation approach now so we can return to it later without rediscovering the groundwork.

## Non-Goals

- Do not fold this work opportunistically into unrelated recording PRs.
- Do not assume true `onKeyEvent()` coverage will become the universal source of truth.
- Do not ship heuristic normalization without a focused unit-test matrix derived from real recordings.
- Do not treat this task as complete after only emulator validation.
- Do not start this task before the recording stream and its downstream parsing shape are stable enough to support durable fixtures.

## Why This Needs Its Own PR

- Back currently appears in multiple shapes depending on navigation mode.
- Home can be confounded with Recents.
- Cancelled gesture Back must be distinguished from successful gesture Back.
- OEM and launcher variation are expected, not edge cases.
- The most important correctness layer is deterministic inference from event sequences, which deserves isolated review and test coverage.

## Inputs

Primary findings:

- [findings.md](~/src/androperator/tasks/android/system-gesture-detection/findings.md)

Supporting artifacts:

- raw recordings stored outside the repo under `~/src/androperator-dumps/recordings/`

Representative current surfaces:

- Samsung physical device, Android `16`, SDK `36`
- Google Play emulator, Android `15`, SDK `35`

Known gaps in the current evidence:

- every scenario currently has a sample size of one run
- no explicit millisecond threshold has been extracted for "immediate" follow-up transitions
- Samsung gesture Home is not yet sampled
- Samsung three-button Home is not yet sampled
- Samsung three-button Recents is not yet sampled
- Pixel or AOSP physical-device behavior is not yet sampled
- localization sensitivity exists for labels such as `"Back"`

## Proposed Development Approach

This task should be done with test-driven development.

The order matters:

1. Collect and preserve representative recordings.
2. Convert those recordings into deterministic test fixtures.
3. Write failing Kotlin unit tests that express the desired semantic output.
4. Implement the smallest normalization logic needed to make those tests pass.
5. Add integration-smoke validation only after fixture-based unit coverage is solid.
6. Only then consider broadening device coverage or tightening heuristics.

Do not start by writing heuristics directly in production code and then trying to retro-fit tests afterward.

## Fixture Strategy

Build a fixture set from real NDJSON event streams. Each fixture should represent one whole interaction sequence and the expected semantic interpretation.

Initial fixture categories:

- Samsung three-button Back completed
- Samsung gesture Back completed
- Samsung gesture Back cancelled
- Emulator gesture Back completed
- Emulator gesture Back cancelled
- Emulator Home completed
- Emulator intentional Recents
- Emulator Recents with task switching

Required next fixture categories before calling the heuristic set mature:

- Samsung gesture Home completed
- Samsung three-button Home completed
- Samsung three-button Recents interaction
- repeated successful gesture Back samples with timestamp deltas
- repeated cancelled gesture Back samples with timestamp deltas

Each fixture should include:

- source device metadata
- Android version and launcher context
- ordered event sequence
- event timestamps or timestamp deltas needed for timing-sensitive rules
- expected semantic classification
- expected completion state
- notes on ambiguity if applicable

## Test-First Milestones

### Milestone 1 - Normalization Unit Tests

Add a pure Kotlin normalization component with no Android runtime dependencies beyond simple data models.

Start with table-driven unit tests like:

- `three_button_systemui_back_click_is_classified_as_back_completed`
- `gesture_back_systemui_transition_followed_by_prior_screen_is_classified_as_back_completed`
- `gesture_back_systemui_transition_without_return_is_classified_as_back_cancelled`
- `recent_apps_then_home_screen_without_overview_interaction_is_classified_as_home`
- `repeated_recent_apps_is_not_classified_as_home`
- `recent_apps_with_launcher_scroll_is_classified_as_recents`
- `recent_apps_with_launcher_click_and_app_open_is_classified_as_recents_completed`

The unit-test suite is the core of the task. It should be extensive.

The first implementation pass should prefer explicit `unknown` outcomes over overconfident classification if a fixture set does not yet justify a narrower rule.

### Milestone 2 - Negative And Ambiguity Tests

Add tests that prove the heuristic does not over-classify:

- random `window_change` to `com.android.systemui` without surrounding navigation context
- random `window_change` to `com.android.systemui` with matching package but different class patterns
- launcher transitions that should remain raw events
- short noisy sequences that should remain `unknown`
- Recents transitions that should not be collapsed into Home
- localized or label-free variants of system UI clicks that should not depend on English-only strings

If uncertain, prefer `unknown` over false confidence.

### Milestone 3 - Integration Boundary Tests

After pure normalization is stable, add tests around the integration boundary:

- where normalization is invoked
- whether raw events are preserved alongside semantic interpretation
- whether replay consumers receive enough context

These tests should verify system behavior, not replace the fixture-driven unit tests.

## Key Design Decisions To Make

Before coding, the task owner should explicitly decide:

1. Where normalization lives:
   - capture time
   - parse time
   - replay time

2. Output shape:
   - replace raw events
   - emit semantic wrapper events
   - preserve raw evidence plus derived semantic interpretation

3. Confidence model:
   - binary classification
   - classification plus `confidence`
   - classification plus `completed` / `cancelled` / `unknown`

My current recommendation is to preserve raw evidence and add derived semantic interpretation rather than destructively rewriting the source stream.

My current recommendation for location is:

- parse time, as a discrete normalization pass after extraction

Why:

- it keeps Android capture unchanged
- it keeps raw recordings intact
- it makes the inference engine easy to test without Android dependencies
- it still allows replay and agent layers to consume normalized semantics without hiding the underlying evidence

Important constraint:

- this choice should be confirmed before parser work expands, because parse-time normalization is a meaningful scope decision rather than a trivial implementation detail

## Implementation Principles

- Keep the normalization engine deterministic and side-effect free.
- Prefer explicit state-machine logic over scattered ad hoc conditionals.
- Encode time-window assumptions explicitly if timing is part of a rule.
- Treat OEM-specific behavior as data-backed rules, not hidden special cases.
- Make every heuristic traceable to a recording-backed test.
- Document known failure modes in code comments and task docs.
- Avoid English-only string matching unless it is explicitly guarded and documented as fallback logic.

## Minimum Definition Of Done

- Fixture-backed Kotlin unit tests cover the known Back, Home, and Recents cases from current recordings.
- Fixture-backed Kotlin unit tests cover repeated positive and negative samples, not just one-off happy paths.
- Successful and cancelled gesture Back are both classified correctly for the currently tested Samsung and emulator samples.
- Home is not misclassified as Recents for the currently tested emulator samples.
- Intentional Recents is not collapsed into Home for the currently tested emulator samples.
- Raw evidence remains inspectable for debugging.
- The findings doc and this plan are updated with any new device-specific discoveries made during implementation.

## Nice-To-Have Follow-Ups

- Add Pixel physical-device recordings.
- Add predictive-Back-specific samples on newer Android builds.
- Add launcher-specific fixtures beyond Samsung and Nexus Launcher.
- Consider a replay-facing abstraction for semantic navigation actions once normalization accuracy is proven.
