# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow Semantic Versioning.

## Clawperator is now Androperator

Clawperator has been renamed to **Androperator**, starting with version **1.0.0**.
It remains the deterministic hand for an agent's brain: a tool for agents to
navigate, observe, and control Android apps, especially during agentic development.

The rename includes the npm package, CLI, Android app, environment variables,
local configuration paths, and runtime result envelope. Existing integrations
must adopt the new names together; the renamed Android app installs separately
and needs its permissions granted. See the [migration guide](docs/migration-to-androperator.md).

Entries below version 1.0.0 describe releases published as Clawperator. Their
original names and links are retained as historical records.

## [1.0.0] - Unreleased

### Breaking changes

- Rename the product, npm package and CLI to Androperator. Use `ANDROPERATOR_*`,
  `~/.androperator/`, `com.androperator.operator` and `.dev`, Kotlin packages
  `androperator.*`, and the `[Androperator-Result]` envelope together.
- Initialize local skill workspaces instead of downloading a companion skills
  catalog. Git-ref catalog synchronization is no longer supported.

### Changes

- Adopt the new Android headset logo and prepare new release/download surfaces.
- Remove Firebase and remote task-status reporting while retaining local crash
  logs, logcat and structured task-status evidence.
- Preserve the former landing site and historical releases. See
  [migration guidance](docs/migration-to-androperator.md) before upgrading.

## [0.12.5] - 2026-09-28

This release adds coordinate drag gestures across the CLI, named MCP tools, raw executions, and the Android Operator.

### 🤖 Node API & CLI

- **Added:** Accepted `drag` with distinct start and end screen coordinates and required hold and movement durations of 1-10000 ms. Strict validation rejects missing, extra, or invalid parameters before dispatch. Results retain correlated execution envelopes and gesture receipts, including an accepted hold when movement fails; completion confirms the gesture, not an application's drop result.

### 📚 Documentation & Website

- **Added:** Documented drag inputs, timing, Android API requirements, dispatch receipts, cancellation limits, and the need to observe the app to verify a drop.
- **Changed:** Updated public release and installer version markers to the published 0.12.4 release.

### 📱 Android Operator APK

- **Added:** Dispatched drag gestures on Android API 26 or newer by holding, moving in a straight line with the same pointer down, and releasing. Cancellation attempts release before movement; an already accepted movement may finish after cancellation.

Pull requests:
- [chore(release): complete 0.12.4 follow-up](https://github.com/clawperator/clawperator/pull/351)
- [feat: add coordinate drag gestures across CLI MCP and Android](https://github.com/clawperator/clawperator/pull/352)

## [0.12.4] - 2026-09-27

**Breaking:** Screenshot step results now use `data.persistedAt` in place of `data.capturedAt`. This release also exposes saved-image geometry, reports text-entry and submission outcomes separately, and clarifies MCP snapshot presentation options.

### 🤖 Node API & CLI

- **Added:** Returned `text_entry`, `submission`, and `submit_method` in `enter_text` results so callers can distinguish accepted typing from requested submission. Acceptance acknowledges dispatch; callers must observe the destination to confirm navigation or entered text.
- **Added:** Returned original PNG width, height, coordinate space, and origin on successful screenshot steps and complete evidence artifacts. The metadata describes the saved image and may differ from resized previews or current input geometry.
- **Breaking:** **Changed:** Replaced screenshot step `data.capturedAt` with `data.persistedAt`, with no alias. The new timestamp marks host PNG file-write completion rather than the exact screen-capture instant; the `query_ui` timestamp is unchanged.
- **Fixed:** Explained raw XML and compact JSON modes in MCP snapshot tool discovery, encoded option dependencies in its schema, and returned actionable validation errors for incompatible options before device dispatch.

### 📚 Documentation & Website

- **Added:** Documented text-entry submission receipts and screenshot image geometry, timestamps, and preview-coordinate limits in the action, evidence, and MCP guides.
- **Changed:** Updated public release and installer version markers to the published 0.12.3 release.
- **Changed:** Clarified MCP snapshot compact-mode requirements, raw-mode limits, and a minimal valid compact call.

### 📱 Android Operator APK

- **Added:** Reported text-entry and submission outcomes separately, including IME action, fallback click, and unavailable submission, while keeping submission best-effort and preserving successful typing when submission is rejected.

Pull requests:
- [fix(mcp): explain snapshot compact option dependencies](https://github.com/clawperator/clawperator/pull/346)
- [chore(release): complete 0.12.3 follow-up](https://github.com/clawperator/clawperator/pull/347)
- [feat(type): distinguish text entry from submission](https://github.com/clawperator/clawperator/pull/348)
- [feat(screenshot)!: expose capture geometry and persistence timestamp](https://github.com/clawperator/clawperator/pull/349)

## [0.12.3] - 2026-09-27

This release makes large UI snapshots more reliable by carrying the hierarchy in the verified result envelope. It also speeds up Android node counting and preserves timeout evidence when capture budgets expire.

### 🤖 Node API & CLI

- **Fixed:** Verified snapshot XML through the correlated, paced result-envelope chunks, including byte counts and SHA-256, and preferred that canonical result over legacy log extraction. Public snapshot arguments and success shapes remain unchanged.
- **Fixed:** Preserved `COMMAND_TIMEOUT`, dispatch state, earlier effects, and partial artifacts when an evidence capture budget expires.

### 📚 Documentation & Website

- **Changed:** Updated public release and installer version markers to the published 0.12.2 release.
- **Changed:** Documented canonical snapshot delivery, chunk verification, and timeout behavior in the snapshot, action, and evidence guides.

### 📱 Android Operator APK

- **Fixed:** Included snapshot XML in the canonical result envelope and counted hierarchy nodes with a literal scan. Counting 4,496 nodes on an API 36 emulator fell from 10.164 seconds to 12.700 milliseconds; this measures node counting, not the full snapshot operation.

Pull requests:
- [chore(release): complete 0.12.2 follow-up](https://github.com/clawperator/clawperator/pull/343)
- [fix(snapshot): verify hierarchy delivery and speed up node counting](https://github.com/clawperator/clawperator/pull/344)

## [0.12.2] - 2026-09-25

**Breaking:** Video recording now requires ffmpeg 6.1 or newer with a working libx264 encoder. This release checks video encoding support before capture, preserves frame timing and the original recording when finalization fails, and makes doctor guidance easier to read.

### 🤖 Node API & CLI

- **Breaking:** **Changed:** Required ffmpeg 6.1 or newer and a successful encoder capability probe before video recording. Older or unsupported installations return `HOST_DEPENDENCY_MISSING` with recovery guidance before capture starts.
- **Fixed:** Preserved every video frame and its timing through variable-frame-rate input and display-size changes, while retaining strict decoding and frame-count checks. If MP4 finalization fails, preserved the original Matroska recording and reported the encoder error without adding a misleading missing-file error.
- **Fixed:** Wrapped commands, flags, package names, and other code references in Markdown backticks in doctor's pretty diagnostics while leaving structured JSON command values unchanged.

### 📚 Documentation & Website

- **Changed:** Updated public release and installer version markers to the published 0.12.1 release.
- **Changed:** Documented the ffmpeg 6.1 video prerequisite, capability checks, and recording recovery behavior.
- **Changed:** Clarified how code references appear in doctor pretty output and that JSON command values remain executable.

Pull requests:
- [chore(release): complete 0.12.1 follow-up](https://github.com/clawperator/clawperator/pull/339)
- [fix(evidence)!: modernize video encoding and verification](https://github.com/clawperator/clawperator/pull/340)
- [fix(doctor): format code references in pretty diagnostics](https://github.com/clawperator/clawperator/pull/341)

## [0.12.1] - 2026-09-25

**Breaking:** New video recordings require separately installed scrcpy 3.0 or newer, ffprobe, and ffmpeg with libx264. This release preserves continuous capture through rotation and folding, produces verified clips for each display-size span, and selects the active physical display for screenshots.

### 🤖 Node API & CLI

- **Breaking:** **Changed:** Required the video recording tools on `PATH` and returned `HOST_DEPENDENCY_MISSING` with structured requirements and recovery guidance when they are unavailable. Folding can produce multiple video artifacts, which consumers must read to cover the complete recording.
- **Fixed:** Kept one continuous video capture through rotation and folding without dropping frames, and verified the resulting MP4 clips for each display-size span. Rotation retains the initial canvas and may show full-size sideways content.
- **Fixed:** Captured screenshots from the active physical display while retaining default capture behavior for legacy Android dumps without activity metadata.

### 📚 Documentation & Website

- **Changed:** Documented video tool prerequisites, recording artifacts, host dependency errors, and active-display capture behavior in setup, API, and error guidance.

Pull requests:
- [chore(release): complete 0.12.0 follow-up](https://github.com/clawperator/clawperator/pull/336)
- [test(evidence): isolate worker fixture device identities](https://github.com/clawperator/clawperator/pull/335)
- [fix(evidence)!: preserve capture across rotation and folding](https://github.com/clawperator/clawperator/pull/337)

## [0.12.0] - 2026-09-20

**Breaking:** Raw snapshots now rejected missing or malformed XML, and successful framed skill responses gained an explicit wrapper `status`. This release added a provider-neutral agent control loop and improved Node capture diagnostics, failure evidence, and daemon ownership handling.

### 🤖 Node API & CLI

- **Added:** Bundled a provider-neutral observe, decide, act, and verify control-loop skill for adaptive Android goals and explicitly requested orchestrated skill authoring, with bounded recovery and optional delegation.
- **Added:** Exposed bounded snapshot extraction facts, including parser positions, received size, capture boundaries, and explicit diagnostic logging availability across CLI, daemon, MCP, and skill results.
- **Breaking:** **Changed:** Rejected missing or malformed snapshot XML before raw or compact presentation, returning failed steps and exit code 1. Added wrapper `status` to framed skill success responses; consumers must distinguish it from nested domain status. Verified screenshot PNGs and artifact writes before accepting host fallback success.
- **Fixed:** Preserved requested and probe correlation, failure phase, dispatch uncertainty, earlier host effects, and diagnostic evidence through public failure responses without fabricating Operator results.
- **Fixed:** Selected the CLI, device, and installed Operator before first-run readiness checks, and distinguished host-model readiness from device readiness in bundled orientation guidance.
- **Fixed:** Preserved package-query failures and Operator variant mismatches instead of reporting them as missing installations.
- **Fixed:** Reported responding sockets without verified managed ownership as `unowned` and preserved their listeners when removing stale daemon metadata.

### 📚 Documentation & Website

- **Added:** Documented optional Jev delegation, bounded proposals, credentials, privacy filtering, and failure recovery for Android automation skills.
- **Added:** Documented the provider-neutral compact observation context contract, including ancestry, coverage, capture-local selectors, payload limits, and recovery boundaries.
- **Added:** Documented bounded snapshot diagnostics, logging availability, stale evidence, and recovery without replaying prior mutations.
- **Added:** Documented the bundled agent control loop and its orientation, discovery, verification, and authoring routes.
- **Changed:** Documented snapshot validation, screenshot provenance, and skill wrapper status compatibility changes.
- **Changed:** Clarified failure phases, dispatch uncertainty, and observation before repeating mutations.
- **Changed:** Clarified required terminal frames for agent-driven skill scripts and kept investigation history separate from public runtime contracts.
- **Changed:** Aligned host-agent setup guidance with device and Operator selection before readiness checks.
- **Changed:** Documented package-query error preservation and installation guidance only for confirmed absence.
- **Changed:** Documented daemon socket ownership and preservation of unowned listeners.

Pull requests:
- [chore(release): complete 0.11.3 follow-up](https://github.com/clawperator/clawperator/pull/320)
- [perf(release): speed up code version bumps](https://github.com/clawperator/clawperator/pull/321)
- [fix(runtime): make capture results and failure evidence trustworthy](https://github.com/clawperator/clawperator/pull/322)
- [fix(runtime): preserve failure phase and dispatch evidence](https://github.com/clawperator/clawperator/pull/323)
- [docs(runtime): keep investigation history in the research repository](https://github.com/clawperator/clawperator/pull/324)
- [docs(skills): select Android targets before first-run readiness checks](https://github.com/clawperator/clawperator/pull/325)
- [docs(skills): explain Jev integration for Android automation](https://github.com/clawperator/clawperator/pull/326)
- [docs(skills): document provider-neutral observation context](https://github.com/clawperator/clawperator/pull/327)
- [fix(skills): ignore Finder metadata in packaging test](https://github.com/clawperator/clawperator/pull/328)
- [feat(diagnostics): expose bounded snapshot extraction facts](https://github.com/clawperator/clawperator/pull/329)
- [feat(skills): add provider-neutral agent control loop](https://github.com/clawperator/clawperator/pull/330)
- [fix(execution): preserve Operator package query failures](https://github.com/clawperator/clawperator/pull/331)
- [fix(deps): resolve eight flagged transitive dependencies](https://github.com/clawperator/clawperator/pull/332)
- [fix(daemon): preserve unowned socket listeners](https://github.com/clawperator/clawperator/pull/333)

## [0.11.3] - 2026-09-19

This release added coordinate swipes with explicit timing and Operator-owned toast messages across the CLI and execution APIs.

### 🤖 Node API & CLI

- **Added:** Exposed coordinate swipes through the CLI, raw execution/HTTP API, and MCP with required start and end coordinates and a duration of 1-10000 ms. Rejected identical endpoints and invalid timing without automatically replaying gestures.
- **Added:** Added `show_toast` and `cancel_toast` actions, `toast "message"` with short or long duration, and idempotent `toast --cancel` support.

- **Fixed:** Rejected duplicate `--limit` and `--visibility` flags in query commands with structured errors and nonzero exits.

### 📚 Documentation & Website

- **Added:** Documented swipe inputs, validation, and gesture-dispatch evidence limits across CLI and MCP usage.
- **Added:** Documented toast actions, duration defaults, cancellation, and submission-only acknowledgement across the execution APIs.

### 📱 Android Operator APK

- **Added:** Executed coordinate swipes with explicit duration and rejected off-display endpoints while preserving dispatch receipts without asserting an app outcome.
- **Added:** Managed one API-owned toast per Operator process, replacing or cancelling it without affecting incidental app messages. Results acknowledged main-thread submission rather than guaranteed visibility or dismissal.

Pull requests:
- [feat(gestures): expose coordinate swipes with required duration](https://github.com/clawperator/clawperator/pull/315)
- [feat(toast): show and cancel Operator-owned toast messages](https://github.com/clawperator/clawperator/pull/316)
- [fix(git): guard commit identities and unpublished history](https://github.com/clawperator/clawperator/pull/317)
- [fix(query): reject duplicate limit and visibility flags](https://github.com/clawperator/clawperator/pull/318)

## [0.11.2] - 2026-09-19

This release added live on-screen log templates that follow the foreground application and display app, device, and system-language metadata.

### 🤖 Node API & CLI

- **Added:** Added mutually exclusive text and template inputs for on-screen logs, including CLI `--template` support and validation of nine Android-resolved placeholders.

### 📚 Documentation & Website

- **Added:** Added release-notes redirects on both websites and links from the landing-page footer and README.
- **Added:** Documented live overlay templates, supported placeholders, validation errors, and HTTP and MCP usage.
- **Changed:** Updated published documentation and installer version markers for the preceding 0.11.1 release.

### 📱 Android Operator APK

- **Added:** Observed foreground application focus across split-screen panes, excluded the keyboard and Operator overlay, preserved verified app context under system panels, and cleared it when locked or unavailable.
- **Added:** Rendered live overlay templates with foreground app icons, package names and versions, device metadata, and system language while preserving literal text, touch-through behavior, and the original expiry time.

Pull requests:
- [feat(sites): add release notes redirects and links](https://github.com/clawperator/clawperator/pull/308)
- [chore(release): complete 0.11.1 follow-up](https://github.com/clawperator/clawperator/pull/310)
- [feat(android): observe foreground application window focus](https://github.com/clawperator/clawperator/pull/311)
- [feat(android): render live overlay templates with application metadata](https://github.com/clawperator/clawperator/pull/312)

## [0.11.1] - 2026-09-13

This release added bounded media observation to collect player reports over time, including while locked or screen-off, while keeping those reports distinct from proof of audible or rendered playback.

### 🤖 Node API & CLI

- **Added:** Added `media observe` across CLI, typed helpers, HTTP and generic MCP with a 1-30000 ms duration, pinned session selection, starting and ending status, callback counts, and up to 64 readable samples with explicit truncation.
- **Added:** Exposed report sequence and receipt time, buffered position, and local/remote playback type in media status while preserving decoding of older status payloads.

### 📚 Documentation & Website

- **Added:** Documented bounded observation, report evidence limits, timeout and session-expiry behavior, and an agent workflow for inspecting background playback reports.

### 📱 Android Operator APK

- **Added:** Collected playback-state callbacks over a bounded interval without waking locked or screen-off devices, preserving original player timestamps and failing on session expiry instead of following a replacement.

Pull requests:
- [chore(release): complete 0.11.0 follow-up](https://github.com/clawperator/clawperator/pull/306)
- [feat(media): observe playback reports over a bounded interval](https://github.com/clawperator/clawperator/pull/307)

## [0.11.0] - 2026-09-13

This release added background notification observation and media controls across the Node API, Android Operator, and public documentation, including safe read-only use while a device is locked or its screen is off.

### 🤖 Node API & CLI

- **Added:** Added notification listing plus media discovery, status, pause, and play through CLI, typed helpers, HTTP, and generic MCP, with locked/off read-only operation and background Doctor checks.
- **Added:** Added notification dismissal, revision-bound button invocation, and capability-checked media seeking with strict bounds, dispatch evidence, and explicit permission, connection, replacement, and timeout errors.
- **Added:** Allowed media pause, play, seek, and mixed notification/media reads to use the non-waking service path while locked or screen-off, while retaining interactive-readiness requirements for notification mutations and UI actions.

### 📚 Documentation & Website

- **Added:** Documented notification listing and media discovery/control contracts, locked/off read-only behavior, background readiness, setup, and the related HTTP and MCP usage.
- **Added:** Documented notification dismissal, action-button invocation, media seeking boundaries, confirmation behavior, and error contracts.
- **Added:** Documented locked-screen media pause, play, seek, and mixed-read behavior alongside the retained mutation and interactive-readiness boundaries.

### 📱 Android Operator APK

- **Added:** Added Android notification-listener and media-session support for background notification observation and media discovery, status, pause, and play without accessibility for read-only operations.
- **Added:** Added Android handling for notification dismissal, revision-bound action buttons, and bounded media seeking with effect confirmation and explicit failure outcomes.
- **Added:** Allowed Android media controls and mixed reads to run without waking a locked or screen-off device while preserving interactive gating and no-replay behavior for mutations.

Pull requests:
- [chore(release): complete 0.10.1 follow-up](https://github.com/clawperator/clawperator/pull/301)
- [feat(notifications): add background observation and media controls](https://github.com/clawperator/clawperator/pull/302)
- [feat(notifications): add dismissal, buttons, and media seeking](https://github.com/clawperator/clawperator/pull/303)
- [feat(media): allow playback controls while locked or screen off](https://github.com/clawperator/clawperator/pull/304)

## [0.10.1] - 2026-09-13

This release hardened evidence capture and bundled-skill discovery while adding a validated query consumer and live-verified guidance for scoped UI interaction.

### 🤖 Node API & CLI

- **Added:** Added a runnable `query` consumer that verifies canonical envelopes, result completeness, step identity, schema, counts, and truncation before accepting a capture.
- **Fixed:** Resolved aliased bundled-skill directories safely when Claude or Codex shares the generic agents directory, preserving user-managed skills and reporting the resolved discovery ownership.
- **Fixed:** Classified physical devices from a valid Android property inventory when emulator flags are absent, allowing valid still and video evidence bundles to complete while retaining unknown classification failures.
- **Fixed:** Allowed CLI and managed MCP evidence to use `CLAWPERATOR_EVIDENCE_DIR` when the default state location is unwritable, with structured storage errors and cross-root per-device video ownership.

### 📚 Documentation & Website

- **Added:** Documented safe shared-directory bundled-skill discovery, migration, and ownership reporting.
- **Added:** Documented the query-consumer example, all-node discovery, and capture-completeness limits.
- **Added:** Documented physical-device evidence classification when emulator flags are unavailable.
- **Added:** Added a live-verified walkthrough for scoped duplicate-target selection, destination assertions, and evidence interpretation.
- **Added:** Documented custom evidence roots, cross-root video ownership, and the corresponding storage-error behavior.

Pull requests:
- [chore(release): complete 0.10.0 follow-up and prepare 0.10.1](https://github.com/clawperator/clawperator/pull/292)
- [docs(tasks): plan v0.11 notification and media APIs](https://github.com/clawperator/clawperator/pull/293)
- [fix(skills): support aliased bundled-skill discovery directories](https://github.com/clawperator/clawperator/pull/294)
- [docs(tasks): plan v0.10.x physical-device reliability fixes](https://github.com/clawperator/clawperator/pull/295)
- [feat(query): add a validated query consumer example](https://github.com/clawperator/clawperator/pull/296)
- [fix(evidence): complete captures when physical devices omit emulator flags](https://github.com/clawperator/clawperator/pull/297)
- [docs(selectors): verify scoped selection and destination assertions](https://github.com/clawperator/clawperator/pull/298)
- [fix(evidence): support writable state with cross-root video ownership](https://github.com/clawperator/clawperator/pull/299)

## [0.10.0] - 2026-09-13

This release changes doctor exit status, explicit selector scoping, scroll result values, and host-failure SSE reporting; callers should apply the migration notes below. It adds structured UI queries, compact snapshots, verified still and video evidence, on-screen diagnostics, and richer action and transport evidence.

### 🤖 Node API & CLI

- **Added:** Added configurable emulator storage through CLI and Serve, with G/GB validation and a 12G default for newly provisioned Google Play AVDs.
- **Added:** Exposed validated on-screen log set/clear actions through raw execution, Serve, and MCP.
- **Added:** Added `on-screen-log set` and `on-screen-log clear` CLI commands with strict flags and no replay after uncertain dispatch.
- **Added:** Added structured `query` / `query_ui` inspection with counts, bounded node results, nullable platform state, observation-local paths, and ancestor/descendant matching.
- **Added:** Exposed Android-marked node sensitivity through queries and MCP, retaining unknown values where the platform cannot report it.
- **Added:** Added opt-in strict action selection and duplicate-match warnings, with bounded candidate summaries for ambiguous targets and containers.
- **Added:** Added opt-in compact CLI/MCP snapshots with node and text budgets, ancestry and visibility metadata, and exact raw XML artifacts.
- **Added:** Added still-evidence capture through CLI and MCP, producing correlated PNG/XML artifacts, hashes, device metadata, timings, and a manifest while retaining partial failures.
- **Added:** Added managed video start/status/stop through Node, CLI, and MCP, with detached sessions, duration caps, exclusive device ownership, and verified media before completion.
- **Added:** Added bounded, correlated result-reader lifecycle diagnostics to failures, host logs, and MCP without copying raw UI contents.
- **Breaking:** **Changed:** `doctor --check-only` now exits 1 when readiness is unverified. Diagnostic collectors must preserve JSON output even on nonzero exit; readiness requires the selected Operator and completed required checks.
- **Breaking:** **Changed:** Explicit action containers now restrict targets to descendants. Review existing container selectors; strict enforcement requires the matching 0.10 Operator.
- **Breaking:** **Changed:** Preserved completed and failed action steps, typed errors, correlation IDs, and dispatch receipts across failures and timeouts. Accept the new scroll outcomes `no_movement`, `unknown`, and `container_lost`, prefer `data.errorCode`, and parse JSON receipt fields; dispatch acceptance does not prove an application state change.
- **Breaking:** **Changed:** Serve host transport failures now appear only in `clawperator:execution`; SSE consumers must stop relying on synthetic `clawperator:result` envelopes for those failures.
- **Changed:** Unified Node test execution with automatic discovery so the package test command includes previously omitted suites.
- **Fixed:** Generated skill wrappers now preserve child exit codes and both output streams; signals, timeouts, and spawn failures exit 1. Regenerate or manually migrate existing wrappers.
- **Fixed:** Required full-stream video decoding before evidence completion, rejecting recordings with damaged later packets while retaining partial artifacts and recovery metadata.
- **Fixed:** Prevented dispatch after result-reader exit and bounded inherited-pipe draining while retaining buffered canonical results, integrity errors, and dispatch uncertainty without replay.
- **Fixed:** Corrected `stdoutObserved` diagnostics when output first arrived after fallback dispatch.

### 📚 Documentation & Website

- **Added:** Documented emulator storage configuration in the Serve API.
- **Added:** Added snapshot latency and performance guidance, including daemon/Serve usage and emulator comparisons.
- **Added:** Added on-screen log action contracts, overlay behavior, selector isolation, and capture limits.
- **Added:** Documented on-screen log CLI usage and verification limits.
- **Added:** Added guidance for concise agent instructions, preserving exact contracts, user-requested values, and observable completion evidence.
- **Added:** Documented structured queries, relational selectors, hierarchy failures, and observation-local node paths.
- **Added:** Documented sensitive hierarchy access and nullable sensitivity metadata.
- **Added:** Documented strict selection, duplicate warnings, explicit container scoping, and matching-Operator requirements.
- **Added:** Documented compact snapshot budgets, raw XML artifacts, formatting failures, and MCP behavior.
- **Added:** Documented still-evidence manifests, artifact verification, and partial-failure handling.
- **Added:** Documented managed video lifecycle, ownership, duration limits, verified completion, and recovery.
- **Added:** Documented correlated transport diagnostics and their limits: Android publication markers report logging writes, not host delivery acknowledgement.
- **Changed:** Tightened emulator setup copy in the machine-readable landing page.
- **Changed:** Refined the landing-page hero and setup wording and added an introductory video.
- **Changed:** Removed local Git blocked-term policy details from runtime skill-authoring documentation.
- **Changed:** Updated doctor readiness, exit-code, remediation, and logging guidance.
- **Changed:** Documented migration for existing generated skill wrappers that previously concealed child failures.
- **Changed:** Documented action dispatch receipts, retained failure evidence, typed errors, and observed scroll outcomes.
- **Changed:** Documented scroll-container eligibility transitions and the retained descendant scope.
- **Changed:** Documented transport failure codes and the SSE host-failure migration.
- **Changed:** Documented full-stream video verification and its resource limits.
- **Changed:** Clarified result-reader exit handling, bounded draining, and preserved transport uncertainty.
- **Changed:** Corrected transport diagnostics guidance and retained the limits of the historical failure investigation.

### 📱 Android Operator APK

- **Added:** Added opt-in snapshot timing diagnostics.
- **Added:** Added a service-owned, touch-through diagnostic overlay with explicit geometry, expiry, draw acknowledgement, and selector isolation.
- **Added:** Added shared structured UI inspection and relational matching, with correlated chunk transport for large results and explicit missing-hierarchy failures.
- **Added:** Declared both Operator variants as accessibility tools to expose Android-marked sensitive hierarchy content on Android 15+, with per-node sensitivity metadata.
- **Added:** Added strict scoped action selection with ambiguity rejection and duplicate-match warnings.
- **Added:** Added correlated publication-start, completed-write, and failed-write diagnostic markers.
- **Changed:** Upgraded Robolectric to 4.11.1 and added API 34 accessibility lifecycle test coverage.
- **Breaking:** **Changed:** Preserved action evidence through failure, cancellation, and timeout; added dispatch receipts and observed scroll outcomes without treating unchanged content as proof of an edge.
- **Fixed:** Guarded snapshot timing checks when Android logging was unavailable in tests.
- **Fixed:** Kept the original scroll container identifiable after it stopped being scrollable, and retained accessibility node handles for reliable identity and dispatch on older Android versions.
- **Fixed:** Paced result chunks off the main thread and protected terminal publication from cancellation.
- **Fixed:** Restricted the exported debug overlay proof activity to callers with `android.permission.DUMP`.

Pull requests:
- [feat(emulator): configure AVD storage size](https://github.com/clawperator/clawperator/pull/262)
- [feat(skill, docs): add I/O speed testing skill and performance guidance](https://github.com/clawperator/clawperator/pull/263)
- [feat(landing): tighten hero copy and add intro video](https://github.com/clawperator/clawperator/pull/264)
- [feat(landing): strengthen hero copy above the fold](https://github.com/clawperator/clawperator/pull/265)
- [feat(on-screen-logs): add diagnostic overlay actions](https://github.com/clawperator/clawperator/pull/266)
- [docs(tasks): prepare v0.10 runtime observability handoffs](https://github.com/clawperator/clawperator/pull/267)
- [docs: simplify agent skills and task guidance for Astra](https://github.com/clawperator/clawperator/pull/268)
- [docs(tasks): streamline v0.10 handoffs for capable agents](https://github.com/clawperator/clawperator/pull/269)
- [feat(on-screen-logs): add set and clear CLI commands](https://github.com/clawperator/clawperator/pull/270)
- [fix(doctor): require verified selected Operator readiness](https://github.com/clawperator/clawperator/pull/271)
- [fix(skills): preserve generated script failures and output](https://github.com/clawperator/clawperator/pull/272)
- [feat(selectors): add structured UI inspection and relational matching](https://github.com/clawperator/clawperator/pull/273)
- [build(android): upgrade Robolectric to 4.11.1](https://github.com/clawperator/clawperator/pull/274)
- [feat(android): restore sensitive hierarchy access](https://github.com/clawperator/clawperator/pull/275)
- [feat(selectors): add strict scoped selection and duplicate hints](https://github.com/clawperator/clawperator/pull/276)
- [test: unify repository test execution and automatic discovery](https://github.com/clawperator/clawperator/pull/277)
- [feat(runtime)!: preserve action evidence and report dispatch receipts](https://github.com/clawperator/clawperator/pull/278)
- [feat(snapshot): add bounded compact output and raw XML artifacts](https://github.com/clawperator/clawperator/pull/279)
- [fix(validation): verify Settings preparation before hierarchy capture](https://github.com/clawperator/clawperator/pull/280)
- [fix(android): preserve scroll scope across eligibility transitions](https://github.com/clawperator/clawperator/pull/281)
- [fix(runtime): harden result transport and terminal publication](https://github.com/clawperator/clawperator/pull/282)
- [feat(evidence): capture verified screenshot and hierarchy bundles](https://github.com/clawperator/clawperator/pull/283)
- [fix(validation): stabilize integrated hierarchy acceptance](https://github.com/clawperator/clawperator/pull/284)
- [feat(evidence): add managed video recording with verified media](https://github.com/clawperator/clawperator/pull/285)
- [fix(android): restrict debug overlay proof to privileged callers](https://github.com/clawperator/clawperator/pull/286)
- [fix(evidence): verify full video streams before completing evidence](https://github.com/clawperator/clawperator/pull/287)
- [fix(runtime): prevent dispatch and hangs after result-reader exit](https://github.com/clawperator/clawperator/pull/288)
- [fix(runtime): correct result-reader diagnostics and retain failure evidence](https://github.com/clawperator/clawperator/pull/289)
- [feat(runtime): add correlated result transport diagnostics](https://github.com/clawperator/clawperator/pull/290)

## [0.9.5] - 2026-05-01

This release improved skill-run log discoverability and added direct public Markdown setup entrypoints for Clawperator's agent onboarding surfaces.

### 🤖 Node API & CLI
- **Changed:** Added per-run skill logging metadata and tail-command details so `clawperator skills run` outputs point directly at the relevant daily log entries.

### 📚 Documentation & Website
- **Changed:** Added public `skill.md` and `agents.md` setup entrypoints, updated the related discovery and install surfaces, and refreshed the agent setup documentation.

Pull requests:
- [feat(skills): show log tail command for each skill run](https://github.com/clawperator/clawperator/pull/259)
- [docs(install): add public skill.md setup entrypoint](https://github.com/clawperator/clawperator/pull/261)

## [0.9.4] - 2026-05-01

This release broadened the canonical `snapshot` action across the Node, Android, and docs surfaces while also refining the generated docs and skill-facing output.

### 🤖 Node API & CLI
- **Changed:** Updated bundled skill headings to include the `Clawperator` prefix for clearer branding in packaged skill files.
- **Changed:** Reworked the canonical `snapshot` action path so Node treats `snapshot` as the primary action name in execution and readiness checks.
- **Changed:** Simplified the generated CLI reference and added curated command metadata so public command output is more focused and hides compatibility-only aliases.

### 📚 Documentation & Website
- **Changed:** Added stable anchors and ownership links across the CLI reference and related API docs.
- **Changed:** Added a canonical Skills CLI detail page and clarified docs ownership and navigation around the API surfaces.
- **Changed:** Added warning-only docs organization checks and tightened docs-author guidance for authored versus generated surfaces.
- **Fixed:** Refreshed the docs site layout with wider content, local scrollers for wide tables and code blocks, and a more compact mobile navigation.

### 📱 Android Operator APK
- **Changed:** Updated Android command parsing and tests to treat `snapshot` as the canonical action while keeping the compatibility alias in place.

Pull requests:
- [feat(skills): prefix SKILL headings with 'Clawperator'](https://github.com/clawperator/clawperator/pull/251)
- [fix(release): verify published version outputs](https://github.com/clawperator/clawperator/pull/252)
- [refactor(node): `snapshot` is the canonical action name](https://github.com/clawperator/clawperator/pull/253)
- [feat(docs): simplify generated CLI reference and add curated command metadata](https://github.com/clawperator/clawperator/pull/254)
- [feat(docs): stable anchors and ownership links for the CLI reference](https://github.com/clawperator/clawperator/pull/255)
- [docs: clarify canonical docs ownership and add Skills CLI detail page](https://github.com/clawperator/clawperator/pull/256)
- [feat(docs): add warning-only docs organization guardrails and tighten docs-author guidance](https://github.com/clawperator/clawperator/pull/257)
- [fix(docs): docs website layout and responsive CSS](https://github.com/clawperator/clawperator/pull/258)

## [0.9.3] - 2026-04-28

This release hardened snapshot reliability across mixed runtime versions, improved bundled skill discovery compatibility for OpenClaw hosts, and kept release Android diagnostics readable.

### 🤖 Node API & CLI
- **Changed:** Correlated snapshot hierarchy log blocks by `commandId` and preferred tagged markers while keeping compatibility with legacy marker streams.
- **Fixed:** Classified legacy untagged snapshot hierarchy markers as `VERSION_INCOMPATIBLE` when tagged snapshots could not be attached, so mixed-version failures surface as explicit compatibility issues.
- **Fixed:** Switched OpenClaw-facing bundled skill installation from symlinks to managed copied directories under `~/.agents/skills`, preserving user-managed entries while keeping packaged skill refresh deterministic.

### 📚 Documentation & Website
- **Changed:** Documented `open_app` foreground readiness boundaries and clarified the related skill-development flow.
- **Changed:** Added personalized skills guidance and clarified how runtime, bundled, personalized, and workspace skill surfaces differ.
- **Changed:** Updated docs to match bundled-skill discovery behavior and snapshot compatibility handling in mixed-version environments.

### 📱 Android Operator APK
- **Changed:** Tagged snapshot hierarchy logs with execution `commandId` so Node can correlate runtime snapshot output deterministically.
- **Changed:** Disabled release name obfuscation to keep release logcat class and tag names readable while preserving shrinking and optimization.

Pull requests:
- [fix(runtime): correlate snapshot UI logs by commandId](https://github.com/clawperator/clawperator/pull/246)
- [fix(node): make bundled skills discoverable to OpenClaw](https://github.com/clawperator/clawperator/pull/247)
- [docs(skills): add personalized skills guidance](https://github.com/clawperator/clawperator/pull/248)
- [fix(android): disable release name obfuscation](https://github.com/clawperator/clawperator/pull/249)
- [fix(node): classify legacy snapshot markers as version mismatches](https://github.com/clawperator/clawperator/pull/250)

## [0.9.2] - 2026-04-27

This release makes `open_app` wait for the launched app to reach the foreground by default, with an explicit opt-out and navigation timeout controls for flows that need it.

### 🤖 Node API & CLI
- **Changed:** Updated `open_app` to wait for the launched package to reach the foreground by default, with `skipNavigationWait` to opt out and navigation timeout controls.

### 📚 Documentation & Website
- **Changed:** Documented the default `open_app` foreground readiness behavior and the opt-out flag in the public actions reference.

### 📱 Android Operator APK
- **Changed:** Extended the operator task runner so launching an app can wait until the target package is in the foreground before continuing.

Pull requests:
- [feat(node, android): wait for open_app foreground by default](https://github.com/clawperator/clawperator/pull/245)

## [0.9.1] - 2026-04-27

This release makes the framed `SkillResult` contract stricter at parse time by requiring a `result` field whenever framed output is validated.

### 🤖 Node API & CLI
- **Breaking:** **Changed:** Tightened framed `SkillResult` validation so `result` is required in TypeScript and Zod (use `null` when there is no truthful domain value); payloads that omit `result` are now rejected at parse time.

Pull requests:
- [feat(node): require SkillResult.result on framed output](https://github.com/clawperator/clawperator/pull/244)

## [0.9.0] - 2026-04-27

This release introduced the canonical SkillResult answer contract and updated the Node CLI and serve API to surface framed skill results directly.

### 🤖 Node API & CLI
- **Added:** Added the canonical `skillResult.result` evidence field and supporting validation so framed skills can emit a direct domain answer alongside checkpoints and terminal verification.
- **Changed:** Updated `skills run` and `POST /skills/:skillId/run` to prefer the framed `skillResult` payload in JSON output when available, while preserving the legacy wrapper fields for unframed runs.

### 📚 Documentation & Website
- **Changed:** Updated the public skills and API docs, bundled skill guidance, and generated agent-ingestion output to describe the canonical SkillResult contract and the new answer surface.

Pull requests:
- [feat(node, skills): add canonical SkillResult result contract](https://github.com/clawperator/clawperator/pull/243)

## [0.8.0] - 2026-04-26

This release introduced the new daemon execution path, which vastly improves operations by routing core Node actions through a transparent daemon and tightening the supporting contracts and docs.

### 🤖 Node API & CLI
- **Added:** Introduced daemon lifecycle commands, Unix socket transport, daemon ownership metadata, version and build identity checks, structured daemon error contracts, and a readiness cache.
- **Changed:** Proxied exec, observe, and flat action commands through the daemon while preserving CLI JSON output, exit-code behavior, operator package selection, and post-dispatch safety boundaries.

### 📚 Documentation & Website
- **Changed:** Added public daemon documentation, generated docs output, and updated skill guidance to reflect the daemon-backed execution flow and its closeout cleanup.

Pull requests:
- [docs(tasks): author daemon implementation task pack](https://github.com/clawperator/clawperator/pull/239)
- [feat(node): add transparent daemon execution proxy](https://github.com/clawperator/clawperator/pull/240)
- [feat(skills): add task implementation prompt skill](https://github.com/clawperator/clawperator/pull/241)
- [fix(node): finalize daemon impl](https://github.com/clawperator/clawperator/pull/242)

## [0.7.8] - 2026-04-26

This release tightens the upgrade guidance around PATH resolution and npm reachability while improving snapshot I/O performance and polishing the landing page example code.

### 🤖 Node API & CLI
- **Changed:** Tightened the `clawperator-upgrade` bundled skill so it resolves PATH explicitly, recovers Homebrew installs by absolute path, and requires npm reachability before using the CLI-first upgrade path.
- **Changed:** Optimized snapshot and logcat handling to stream hierarchy XML from the live logcat result stream, reduce recovery overhead, and keep the `[Clawperator-Result]` envelope contract intact.

### 📚 Documentation & Website
- **Changed:** Synced the `clawperator-upgrade` guidance across CLI help, public docs, generated agent surfaces, and the installed host AGENTS guide.
- **Changed:** Tightened the landing-page example code.

Pull requests:
- [fix(skills): tighten clawperator-upgrade host PATH handling](https://github.com/clawperator/clawperator/pull/236)
- [site: improve demo code on landing page](https://github.com/clawperator/clawperator/pull/237)
- [perf(node): optimize snapshot logcat I/O](https://github.com/clawperator/clawperator/pull/238)

## [0.7.7] - 2026-04-25

This release advances the code version to 0.7.7 and tightens release publishing checks so future releases fail closed when the changelog entry is missing.

Pull requests:
- [fix(release): gate npm publish on changelog entry](https://github.com/clawperator/clawperator/pull/235)

## [0.7.6] - 2026-04-25

This release hardens snapshot extraction so interleaved Android logcat noise no longer contaminates captured hierarchy XML.

### 🤖 Node API & CLI
- **Fixed:** Preserved the parsed logcat tag while assembling snapshot blocks so `snapshot_ui` output no longer absorbs unrelated system lines like `Updating configuration...` into `data.text`.

Pull requests:
- [fix(node): prevent snapshot XML contamination](https://github.com/clawperator/clawperator/pull/234)

## [0.7.5] - 2026-04-24

This release formalizes the JSON-by-default CLI contract across command help, docs, bundled skills, and read workflows so agent integrations can rely on structured output without extra selectors.

### 🤖 Node API & CLI
- **Added:** Allowed `read --all` and `read-value --all` to use the default JSON output mode without requiring `--json`, `--output json`, or `--format json`, while continuing to reject pretty output for multi-result machine-read paths.
- **Changed:** Aligned the main repo with the JSON-by-default CLI/API contract, keeping explicit JSON selectors available while treating `--output json` as the preferred documented selector.
- **Changed:** Updated bundled skill guidance and scaffolding so packaged agent flows assume default structured output and handle multi-device doctor requirements accurately.

### 📚 Documentation & Website
- **Changed:** Refreshed public API, setup, host-agent, troubleshooting, quickstart, skills, and landing-site guidance so examples and command references no longer require optional JSON flags for default structured output.

Pull requests:
- [docs(install): note install status and upgrade multi-device verification](https://github.com/clawperator/clawperator/pull/230)
- [feat(skills): add API agent UX skill for Node API reviews](https://github.com/clawperator/clawperator/pull/231)
- [feat(node, docs): formalize JSON-default CLI output argument](https://github.com/clawperator/clawperator/pull/232)
- [feat(node): all-read commands to use default JSON output](https://github.com/clawperator/clawperator/pull/233)

## [0.7.4] - 2026-04-24

This release centralizes installer and operator download handling in the Node CLI while aligning the public install guidance with the CLI-first bootstrap flow.

### 🤖 Node API & CLI
- **Changed:** Moved host setup ownership into the Node CLI, added the canonical operator download flow, delegated remediation policy to the CLI, added a compact `clawperator install` post-bootstrap sequence, and compacted the shell installer around `clawperator install`.

### 📚 Documentation & Website
- **Changed:** Updated the installer and host docs to match the CLI-based bootstrap, delegation, and recovery flow.

Pull requests:
- [refactor(install): move host setup ownership into the CLI](https://github.com/clawperator/clawperator/pull/224)
- [feat(node): add canonical operator download CLI flow](https://github.com/clawperator/clawperator/pull/225)
- [refactor(install): delegate remediation policy to the CLI](https://github.com/clawperator/clawperator/pull/226)
- [docs(install): update for cli-based installer](https://github.com/clawperator/clawperator/pull/227)
- [feat(install): add compact post-bootstrap install flow](https://github.com/clawperator/clawperator/pull/228)
- [refactor(install): compact shell installer around clawperator install](https://github.com/clawperator/clawperator/pull/229)

## [0.7.3] - 2026-04-22

This release improves the installer handoff for multi-device setups and standardizes the public APK recovery guidance.

### 📚 Documentation & Website
- **Changed:** Improved `install.sh` so multi-device installs inspect each ready device, remediate stale APKs, and keep the final handoff honest when some devices still need attention.
- **Changed:** Standardized the public guidance on the canonical stable APK URL and made the manual setup prompts package-aware, shell-safe, and clearer for `DEVICE_SHELL_UNAVAILABLE` cases.

Pull requests:
- [fix(install): multi-device installer remediation and APK guidance](https://github.com/clawperator/clawperator/pull/223)

## [0.7.2] - 2026-04-22

This release moves the shipped first-party skills into the bundled Node skill tree and tightens the installer and docs guidance for multi-device setups.

### 🤖 Node API & CLI
- **Changed:** Renamed the packaged `agent-skills` surface to `bundled-skills`, moved the shipped first-party skills into `apps/node/bundled-skills/`, and prefixed the bundled skill ids with `clawperator-`.

### 📚 Documentation & Website
- **Changed:** Updated the installer and discovery guidance so `install.sh` now checks each connected device during the final doctor pass and the public docs match the new bundled-skill layout.

Pull requests:
- [feat: install.sh doctor runs on each connected device](https://github.com/clawperator/clawperator/pull/219)
- [refactor: bundled skills into `apps/node/bundled-skills` and prefix skill ids](https://github.com/clawperator/clawperator/pull/220)
- [refactor(node): rename agent-skills surface to bundled-skills](https://github.com/clawperator/clawperator/pull/221)
- [feat(node, docs): improve docs discovery guidance](https://github.com/clawperator/clawperator/pull/222)

## [0.7.1] - 2026-04-22

This release keeps the Node runtime focused on deterministic timeout handling for `runExecution`.

### 🤖 Node API & CLI
- **Fixed:** Stabilized `runExecution` timeout handling by adding test-friendly overrides for the result-envelope timeout and logcat broadcast delay.

Pull requests:
- [fix(node): stabilize runExecution timeout tests](https://github.com/clawperator/clawperator/pull/217)

## [0.7.0] - 2026-04-21

This release expands the packaged skill surfaces, adds interactive-device doctor and wake handling in the Node runtime, and brings Android `enter_text` behavior up to the current API 33 contract.

### 🤖 Node API & CLI
- **Changed:** Renamed the packaged `authoring-skills` surface to `agent-skills`, including the CLI help, installer wiring, and the related runtime docs.
- **Added:** Shipped first-party `clawperator-agent-orientation` and `clawperator-upgrade` skills in the Node-distributed skill set.
- **Added:** Added device interactivity checks, readiness preflights, and bounded wake handling so doctor, skill wrappers, and `serve` can fail closed on locked devices.
- **Changed:** Tightened doctor and direct-execution handling around interactive-state diagnostics and status reporting.

### 📚 Documentation & Website
- **Changed:** Updated the host-agent, doctor, skills, API, and release docs to match the new `agent-skills` surface and interactive readiness behavior.
- **Changed:** Refreshed generated docs artifacts and install guidance for the new packaged skills and release outputs.

### 📱 Android Operator APK
- **Fixed:** Separated screen-off from device-locked state in the operator truth model and updated the `enter_text.clear` contract.
- **Added:** Upgraded the Android `enter_text` runtime for API 33 with the accessibility IME fallback path.

Pull requests:
- [refactor: rename authoring-skills surface to agent-skills](https://github.com/clawperator/clawperator/pull/204)
- [feat: add first-party clawperator agent orientation skill](https://github.com/clawperator/clawperator/pull/205)
- [feat(skill): add packaged clawperator-upgrade agent-skill](https://github.com/clawperator/clawperator/pull/207)
- [fix(android): `enter_text` clear contract](https://github.com/clawperator/clawperator/pull/209)
- [feat(android): upgrade enter_text runtime for API 33](https://github.com/clawperator/clawperator/pull/211)
- [feat: add device interactivity foundation](https://github.com/clawperator/clawperator/pull/213)
- [feat(node): add doctor enhancements](https://github.com/clawperator/clawperator/pull/214)
- [feat(node): add device interactivity checks and bounded wake preflight](https://github.com/clawperator/clawperator/pull/215)

## [0.6.5] - 2026-04-20

This release sharpens authoring discoverability and the skill-authoring workflow, while tightening validation and eval coverage around the new discovery-first path.

### 🤖 Node API & CLI
- **Changed:** Improved authoring discoverability so the CLI now routes hosts toward `authoring-skills list`, clarifies the runtime-skill versus authoring-skill boundary, and makes `skills new` explicit as the low-level scaffold path.
- **Fixed:** Hardened skill authoring validation and scaffolds by requiring runtime-skill frontmatter, making scaffolded `run.js` files self-contained, preserving quoted Windows `CLAWPERATOR_BIN` paths, preferring the branch-local Node CLI, and keeping single-skill validation usable for fresh scaffolds while enforcing generated-index freshness in repo-wide validation.
- **Added:** Added `skill-author-by-agent-discovery` as the discovery front door, kept `skill-author-by-recording` as the proving handoff, and hardened Pack A eval coverage so route evidence is required.

### 📚 Documentation & Website
- **Changed:** Added `docs/host-agents.md` as the canonical post-install route and repointed setup, quickstart, skills, MCP, index, and design guidance around that flow.
- **Changed:** Updated the authoring docs, CLI next-step messaging, generated docs artifacts, and install validation coverage to match the shipped discovery-first workflow.

Pull requests:
- [feat(cli): improve authoring discoverability](https://github.com/clawperator/clawperator/pull/200)
- [tasks(skills): create authoring discoverability and skill authorship task packs](https://github.com/clawperator/clawperator/pull/201)
- [fix(skills): harden skill authoring validation and scaffolds](https://github.com/clawperator/clawperator/pull/202)
- [feat(skills): add discovery-first authoring skills and eval hardening](https://github.com/clawperator/clawperator/pull/203)

## [0.6.4] - 2026-04-18

This release sharpens the post-install host orientation flow and updates the surrounding CLI and docs guidance to point users at the right entry points.

### 🤖 Node API & CLI
- **Changed:** Reworked the post-install discovery flow so the CLI now steers hosts through `skills for-app` or `skills search` first, while keeping `mcp serve` as the stdio MCP transport entry point.

### 📚 Documentation & Website
- **Changed:** Added `docs/host-agents.md` as the canonical post-install route and repointed setup, quickstart, skills, MCP, index, and design guidance around that flow.
- **Changed:** Clarified registry-read remediation to favor the installed home registry path and concrete next steps without changing `CLAWPERATOR_SKILLS_REGISTRY` precedence.

Pull requests:
- [docs: update docs and cli for agent host orientation](https://github.com/clawperator/clawperator/pull/197)

## [0.6.3] - 2026-04-17

This release expands skills discovery and ranking, while refreshing the install and onboarding guidance to match the current runtime-skill flow.

### 🤖 Node API & CLI
- **Added:** Added `clawperator skills for-app <package_id>` as app-oriented discovery sugar, along with optional `keywords` metadata and deterministic keyword ranking in `skills search`.
- **Fixed:** Covered the Google Home HVAC discovery regressions, including the `ac` mis-ranking case.

### 📚 Documentation & Website
- **Changed:** Documented the app-oriented skills discovery and keyword-ranking behavior in the public skills and environment references.
- **Changed:** Updated the install and onboarding guidance, plus the public installer script, to describe runtime-skill discovery, installed-registry fallback, and when to use `clawperator skills` versus MCP.

Pull requests:
- [feat(skills): add app discovery and keyword ranking](https://github.com/clawperator/clawperator/pull/195)
- [feat(install): add host onboarding artifacts](https://github.com/clawperator/clawperator/pull/196)

## [0.6.2] - 2026-04-17

This release fixes the `install.sh` stdin execution path so streamed installs complete cleanly.

### 📚 Documentation & Website
- **Fixed:** Corrected the `install.sh` stdin execution path so `curl -fsSL https://clawperator.com/install.sh | bash` completes without tripping the entrypoint guard.

Pull requests:
- [feat(skills): add task-cleanup skill](https://github.com/clawperator/clawperator/pull/191)
- [fix(install): fix stdin execution for install.sh](https://github.com/clawperator/clawperator/pull/192)

## [0.6.1] - 2026-04-16

This release centers on packaged authoring-skills support and the matching public guidance refresh, with installer validation tightened along the way.

### 🤖 Node API & CLI
- **Added:** Added packaged authoring-skills installation support, kept agent discovery path compatibility in CLI output, and expanded doctor coverage for stale, malformed, and partially broken authoring-skills installs.

### 📚 Documentation & Website
- **Changed:** Updated public examples to use the release operator package by default, while keeping debug-package guidance for local debug workflows.
- **Changed:** Refreshed release-facing docs and installer validation coverage for the published `0.6.0` release, including the consolidated `validation/install` smoke paths.

Pull requests:
- [feat(install,node): add authoring skills](https://github.com/clawperator/clawperator/pull/188)
- [docs: use release operator package in public examples](https://github.com/clawperator/clawperator/pull/189)
- [test(install): harden install.sh validation coverage](https://github.com/clawperator/clawperator/pull/190)

## [0.6.0] - 2026-04-16

This release adds the new authoring-skills install workflow, expands the Node skills runtime with framed SkillResult parsing and orchestrated execution support, and refreshes public docs and Android build tooling alongside the release follow-up for the previous version.

### 🤖 Node API & CLI
- **Added:** Added framed SkillResult parsing, trusted skill-result provenance handling, and orchestrated runtime support so `skills run` and `serve` can surface structured skill execution results.
- **Added:** Added the `authoring-skills` CLI workflow for packaged skill installs, updates, and listings, including filesystem wiring for the canonical authoring-skill store.
- **Changed:** Improved `skills run` argument forwarding and skill contract input handling so trailing arguments and named inputs are treated consistently.

### 📚 Documentation & Website
- **Added:** Documented the skill-result contract, orchestrated runtime behavior, authoring-skills install flow, and MCP references across the public docs and site surfaces.
- **Changed:** Refreshed the landing page theme and updated release-facing docs and website artifacts for the previously published `0.5.5` release.

### 📱 Android Operator APK
- **Changed:** Upgraded the Android build stack to AGP 9.1.0 and Gradle 9, plus the corresponding module and wrapper configuration.
- **Fixed:** Stabilized Android JSON extension unit tests by removing the Robolectric dependency from the pure JSON helper coverage.

Pull requests:
- [chore(android): upgrade AGP to 9.1.0](https://github.com/clawperator/clawperator/pull/166)
- [feat(site): lighter landing theme](https://github.com/clawperator/clawperator/pull/165)
- [fix(android): stabilize json extension unit tests](https://github.com/clawperator/clawperator/pull/168)
- [chore: fix banned claw shorthand usage](https://github.com/clawperator/clawperator/pull/167)
- [feat(skills): improve skills run argument handling](https://github.com/clawperator/clawperator/pull/171)
- [tasks(recording): create task packs](https://github.com/clawperator/clawperator/pull/170)
- [feat(recording): complete skill-checkpoints workstream](https://github.com/clawperator/clawperator/pull/172)
- [feat(skills): add SkillResult contract parsing for skills](https://github.com/clawperator/clawperator/pull/173)
- [feat(landing): mention MCP + improve demo code](https://github.com/clawperator/clawperator/pull/175)
- [docs: add MCP references and refresh indexes](https://github.com/clawperator/clawperator/pull/176)
- [skills: add agent-driven orchestrated runtime support](https://github.com/clawperator/clawperator/pull/177)
- [feat(evals): add durable Solax cold-start live proving](https://github.com/clawperator/clawperator/pull/178)
- [feat(skills): add skill contract declarations](https://github.com/clawperator/clawperator/pull/179)
- [feat(recording): harden compare closeout and fail-closed behavior](https://github.com/clawperator/clawperator/pull/180)
- [docs(recording): retire completed recording task packs after graduation](https://github.com/clawperator/clawperator/pull/181)
- [fix(node): trust named skill contract inputs](https://github.com/clawperator/clawperator/pull/182)
- [feat(skills): add skill-author-by-recording workflow](https://github.com/clawperator/clawperator/pull/183)
- [docs(recording): harden P2 skill-author-by-recording workflow](https://github.com/clawperator/clawperator/pull/184)
- [docs(skills): graduate recording authoring guidance](https://github.com/clawperator/clawperator/pull/185)
- [tasks: authoring skills install and discovery task pack](https://github.com/clawperator/clawperator/pull/186)
- [feat(node): add authoring-skills CLI support for packaged skill installs](https://github.com/clawperator/clawperator/pull/187)

## [0.5.5] - 2026-04-10
This release expands the MCP surface with a first-party server, session defaults, and snapshot truncation ergonomics, while also adding recording export and agent-friendly CLI aliases. Documentation was refreshed alongside the new runtime behavior and the already-published 0.5.4 release.

### 🤖 Node API & CLI
- **Added:** Added recording export for pulled NDJSON recordings, shared recording validation, and `skills new --recording-context` support for scaffolded skills.
- **Added:** Added a first-party stdio MCP server and documented its tool surface.
- **Added:** Added agent-friendly CLI and payload aliases to make command interactions more intuitive without changing canonical precedence.
- **Changed:** Updated MCP session defaults and snapshot truncation behavior to make the server easier to use.
- **Fixed:** Hardened MCP stdio parsing and added coverage for handshake, wait timeout padding, and source-aware selector retries.

### 📚 Documentation & Website
- **Added:** Documented recording export, skill recording-context workflows, the first-party MCP server, and alias/navigation references.
- **Changed:** Updated release-facing docs to match the published 0.5.4 artifacts.
- **Changed:** Refreshed MCP documentation and internal design notes for the new server behavior and ergonomics.

Pull requests:
- [fix(evals): harden evals](https://github.com/clawperator/clawperator/pull/155)
- [chore: define canonical worktree location](https://github.com/clawperator/clawperator/pull/156)
- [tasks/api: plan recording export agent-context workflow](https://github.com/clawperator/clawperator/pull/157)
- [feat(node): add recording export and scaffolded recording context support](https://github.com/clawperator/clawperator/pull/159)
- [docs: add transport-first MCP task pack](https://github.com/clawperator/clawperator/pull/158)
- [feat(node): add agent-friendly CLI and payload aliases](https://github.com/clawperator/clawperator/pull/160)
- [feat(node): add first-party MCP server](https://github.com/clawperator/clawperator/pull/161)
- [docs(tasks): tighten MCP follow-up implementation handoff](https://github.com/clawperator/clawperator/pull/162)
- [fix(node): harden MCP stdio parsing and coverage](https://github.com/clawperator/clawperator/pull/163)

## [0.5.4] - 2026-04-07
This release pins the release and CI toolchain to Node 24, removes the flaky npm self-upgrade path, and aligns the public setup guidance with the new runtime floor.

### 🤖 Node API & CLI
- **Changed:** Pinned the release and PR workflows to Node 24.14.1 and removed the global npm bootstrap step from npm publishing to avoid the trusted-publishing failure path.
- **Changed:** Raised the declared Node requirement to 24 in package metadata, doctor checks, installer scripts, and runtime guidance.

### 📚 Documentation & Website
- **Changed:** Regenerated machine-facing docs and updated setup/release guidance to match the Node 24 floor.

Pull requests:
- [chore: pin workflows and tooling to Node 24](https://github.com/clawperator/clawperator/pull/154)

## [0.5.3] - 2026-04-07
This release adds new user guidance around starring the project and improves Java setup reliability for Android builds, while expanding setup and snapshot documentation.

### 🤖 Node API & CLI
- **Added:** Added a star-hint system in the CLI with suppression controls for flags, environment variables, and non-interactive sessions.
- **Added:** Added Java runtime provisioning support in install and doctor flows so Android build prerequisites can be prepared and validated more reliably.

### 📚 Documentation & Website
- **Added:** Added a new snapshot API guide and quickstart documentation, plus version badges and quick-reference version checks in core docs pages.
- **Changed:** Updated release-facing docs and install artifacts for the published `0.5.2` release and refreshed site guidance related to version visibility and star messaging.

Pull requests:
- [docs: add version badges and improve version discoverability](https://github.com/clawperator/clawperator/pull/141)
- [Add comprehensive task plans and work breakdowns](https://github.com/clawperator/clawperator/pull/142)
- [docs: add snapshot guide and quickstart](https://github.com/clawperator/clawperator/pull/143)
- [feat(evals): phase 1 eval harness and android-version spec](https://github.com/clawperator/clawperator/pull/144)
- [feat(evals): add multi-agent adapters and turn budget enforcement](https://github.com/clawperator/clawperator/pull/145)
- [feat(evals): add runtime contracts and knowledge mode](https://github.com/clawperator/clawperator/pull/146)
- [feat(evals): add skill generation replay eval](https://github.com/clawperator/clawperator/pull/147)
- [feat(evals): add replay framework and comprehensive test coverage](https://github.com/clawperator/clawperator/pull/148)
- [feat: add star hint system with triggers and suppression](https://github.com/clawperator/clawperator/pull/149)
- [chore: update AGP to 8.13.2](https://github.com/clawperator/clawperator/pull/150)
- [tasks: Java provisioning and Android migration plans](https://github.com/clawperator/clawperator/pull/151)
- [chore(android): migrate build toolchain from Java 11 to Java 17](https://github.com/clawperator/clawperator/pull/152)
- [feat(install): add Java provisioning to installer](https://github.com/clawperator/clawperator/pull/153)

## [0.5.2] - 2026-03-28
This release unifies Node logging and strengthens skill-run diagnostics: shared output assertions, full NDJSON capture of skill child output, a new `logs` command, and expanded documentation. Release automation now attaches the changelog to GitHub Releases.

### 🤖 Node API & CLI
- **Fixed:** Routed skill output assertions through `runSkill` so CLI and HTTP skill runs share the same validation path and structured failure responses.
- **Changed:** Replaced ad hoc logging with a unified typed logger that emits NDJSON events for CLI, skills, execution, doctor, and serve, including skill child-process stdout and stderr in log files.
- **Added:** Added the `logs` command for streaming and filtering Clawperator log output.

### 📚 Documentation & Website
- **Changed:** Updated the install script, compatibility guidance, and generated llms bundles for the published 0.5.1 artifacts.
- **Added:** Added logging API reference material and cross-links from setup, skills runtime, and troubleshooting guides.

Pull requests:
- [task: plan release notes task](https://github.com/clawperator/clawperator/pull/128)
- [Update release-notes-author guidance](https://github.com/clawperator/clawperator/pull/129)
- [docs(changelog): update for all historical releases](https://github.com/clawperator/clawperator/pull/130)
- [feat(release): include CHANGELOG in GitHub Release body](https://github.com/clawperator/clawperator/pull/131)
- [feat(release): changelog includes PRs](https://github.com/clawperator/clawperator/pull/132)
- [Fix skill output assertions in the shared runSkill path](https://github.com/clawperator/clawperator/pull/133)
- [Add repo-local task-author skill for executable task packs](https://github.com/clawperator/clawperator/pull/134)
- [task: create unified logging plan](https://github.com/clawperator/clawperator/pull/135)
- [fix(ci): enforce commit attribution policy in PR workflows](https://github.com/clawperator/clawperator/pull/137)
- [feat(node): unify CLI, skill, doctor, and serve logging](https://github.com/clawperator/clawperator/pull/139)
- [feat(logging): complete unified logging migration and finalize docs](https://github.com/clawperator/clawperator/pull/140)

## [0.5.1] - 2026-03-26
Documentation led this release, with the public site and release guidance refreshed around the published 0.5.0 artifacts. Node also picked up timeout and doctor recovery guidance so version mismatches are easier to diagnose.

### 🤖 Node API & CLI
- **Changed:** Added docsUrl-based recovery guidance to doctor checks and CLI output.
- **Changed:** Refreshed the Node package README to match the docs cleanup pass.
- **Changed:** Added version-compatibility guidance to timeout failures in runtime execution and doctor checks.

### 📚 Documentation & Website
- **Changed:** Updated the install guidance and release procedure docs to match the published 0.5.0 artifacts.
- **Changed:** Moved the old recording-based skill out of the docs tree as part of the refactor cleanup.
- **Changed:** Replaced the docs publishing path with a deterministic build pipeline and regenerated the staged docs outputs.
- **Changed:** Replaced the core placeholder docs with code-verified reference content for setup, API, doctor, and serve.
- **Changed:** Expanded the refactored API, skills, and troubleshooting docs with the new reference content.
- **Changed:** Cleaned up the remaining docs surface and refreshed the published install artifacts.
- **Changed:** Added timeout version guidance to the API, setup, and troubleshooting docs.

Pull requests:
- [task: create docs refactor plan/tasks](https://github.com/clawperator/clawperator/pull/119)
- [docs: complete phase-2 docs surfaces and doctor links](https://github.com/clawperator/clawperator/pull/121)
- [Refactor phase 3 agent docs for API, skills, and troubleshooting coverage](https://github.com/clawperator/clawperator/pull/122)
- [chore(docs-refactor): finalize PR-4 cleanup](https://github.com/clawperator/clawperator/pull/123)
- [docs(tasks): update docs-build regeneration reference in agent-ui-loop plan](https://github.com/clawperator/clawperator/pull/124)
- [node: Add timeout version guidance](https://github.com/clawperator/clawperator/pull/125)
- [Add zero-shot Android exploration skill](https://github.com/clawperator/clawperator/pull/126)
- [chore(task): cleanup](https://github.com/clawperator/clawperator/pull/127)

## [0.5.0] - 2026-03-24
Breaking CLI changes led this release, centered on a flat, registry-driven Node command surface and a much broader command set. The docs and site were rewritten alongside the refactor so the public reference now matches the shipped API and terminology.

### 🤖 Node API & CLI
- **Breaking:** **Changed:** Flattened the CLI into top-level commands and registry-driven dispatch, replacing the nested command tree.
- **Breaking:** **Changed:** Required `--json` for `read --all` while adding `scroll-until`, `close`, `sleep`, `wait-for-nav`, `read-value`, `wait --timeout`, and aligned `exec` payload handling.
- **Changed:** Added selector and container flags for device queries and scroll/read commands.
- **Changed:** Renamed receiver-package terminology to `operatorPackage` across the CLI, runtime, docs, and scripts while keeping the legacy flag accepted as an alias.
- **Added:** Added live skills-run progress output and persistent NDJSON lifecycle logging.
- **Breaking:** **Changed:** Renamed the Google Home aircon skill to `get-climate` and updated the generated skill fixtures and docs to the new name.

### 📚 Documentation & Website
- **Changed:** Updated the 0.4.0 release guidance and install script to match the published artifacts.
- **Changed:** Refreshed the skill migration notes and added Node API design guidance for the API refactor.
- **Changed:** Rewrote the API reference and site docs around the flat command surface, selector flags, extended commands, `exec` payload alignment, and `operatorPackage` terminology.
- **Changed:** Documented live skills-run output and persistent logging behavior across the agent guides and troubleshooting pages.
- **Breaking:** **Changed:** Renamed the Google Home aircon skill to `get-climate` across docs and generated site artifacts.

Pull requests:
- [Release/v.0.4.0](https://github.com/clawperator/clawperator/pull/99)
- [docs: mark PRD-3.5 done](https://github.com/clawperator/clawperator/pull/100)
- [skills: progress visibility during skills run](https://github.com/clawperator/clawperator/pull/101)
- [docs(tasks): add PRD-5.5 for skill progress logging](https://github.com/clawperator/clawperator/pull/102)
- [feat(node): Persistent logging for lifecycle events](https://github.com/clawperator/clawperator/pull/103)
- [Add skill progress logging and regression coverage](https://github.com/clawperator/clawperator/pull/104)
- [chore(skills): rename google home aircon skill to climate](https://github.com/clawperator/clawperator/pull/105)
- [Reorganize API refactor tasks and add design guiding principles](https://github.com/clawperator/clawperator/pull/106)
- [refactor(cli): implement registry-driven command dispatch](https://github.com/clawperator/clawperator/pull/107)
- [refactor: rename receiverPackage to operatorPackage throughout codebase](https://github.com/clawperator/clawperator/pull/108)
- [refactor(node, docs)!: use flat command surface](https://github.com/clawperator/clawperator/pull/109)
- [feat: Phase 3 selector flags and container flags implementation](https://github.com/clawperator/clawperator/pull/110)
- [feat: Phase 5A extended CLI commands (scroll-until, close, sleep, --long/--focus, wait --timeout, read --all)](https://github.com/clawperator/clawperator/pull/111)
- [feat: Phase 5C API refactor - container-scoped read_text](https://github.com/clawperator/clawperator/pull/112)
- [feat(api): Phase 5B extended commands - wait-for-nav, read-value, exec alignment](https://github.com/clawperator/clawperator/pull/114)
- [Update the Node API for the final refactor phase](https://github.com/clawperator/clawperator/pull/117)

## [0.4.0] - 2026-03-22
This release improved pre-flight validation and debugging visibility for executions and skills runs, and refreshed documentation around Operator APK readiness, doctor checks, and error handling.

### 🤖 Node API & CLI
- **Added:** Added `skills validate --dry-run` and made `skills run` use it as a default preflight gate, with `--skip-validate` as an explicit escape hatch.
- **Added:** Added semantic action context to execution validation failures and timeout errors, including offending action identifiers/types, invalid keys, migration hints, and timeout correlation details.
- **Changed:** Clarified Node developer ownership and contribution guidance by updating LICENSE attribution and adding a `CONTRIBUTING.md` entry.
- **Fixed:** Fixed Operator readiness and version-check behavior so missing Operator APKs fail fast during `execute`, doctor reports missing APKs as blocking failures while keeping variant mismatches as warnings, and versioned remediation URLs are surfaced during setup.

### 📚 Documentation & Website
- **Changed:** Updated the Android Operator APK setup, compatibility, and release-procedure documentation to match the published 0.3.2 artifacts.
- **Changed:** Updated doctor and compatibility documentation to reflect the new shared APK presence pre-flight, normalized CLI/APK version matching rules, and the revised doctor remediation step order.
- **Changed:** Refreshed the Node API error-handling docs to match the enriched validation and timeout error details.
- **Changed:** Updated the Node API agent guide and skills workflow docs to document `skills validate --dry-run` and the default `skills run` gating behavior.
- **Fixed:** Fixed docs website meta tag fallbacks.

Pull requests:
- [chore(build): set code version to 0.3.2](https://github.com/clawperator/clawperator/pull/92)
- [fix(site): docs meta tag fallbacks](https://github.com/clawperator/clawperator/pull/93)
- [chore: update ownership to Action Launcher Pty Ltd](https://github.com/clawperator/clawperator/pull/94)
- [docs(tasks): add comprehensive agent usage documentation](https://github.com/clawperator/clawperator/pull/95)
- [Fix readiness gating and exact version compatibility for Operator APKs](https://github.com/clawperator/clawperator/pull/96)
- [node: enrich execution error context](https://github.com/clawperator/clawperator/pull/97)
- [feat(skills): add dry-run preflight gate](https://github.com/clawperator/clawperator/pull/98)

## [0.3.2] - 2026-03-20
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.
- **Fixed:** Fixed Android runtime issues affecting gesture, action, or observation reliability.

Pull requests:
- [fix(site): refine landing page mobile nav and footer](https://github.com/clawperator/clawperator/pull/69)
- [Use favicon for sites](https://github.com/clawperator/clawperator/pull/71)
- [docs: comprehensive documentation and skills framework updates](https://github.com/clawperator/clawperator/pull/70)
- [fix(android): implement screen dimension detection in UiTreeInspectorAndroid](https://github.com/clawperator/clawperator/pull/72)
- [fix(operator): resolve scroll_until + clickAfter miss on EDGE_REACHED](https://github.com/clawperator/clawperator/pull/73)
- [feat(operator+node): PR-2 action primitives - wait_for_navigation, read_key_value_pair, extended validators](https://github.com/clawperator/clawperator/pull/74)
- [Add docs source of truth guardrails](https://github.com/clawperator/clawperator/pull/75)
- [fix(node): improve first-run diagnostics and DX](https://github.com/clawperator/clawperator/pull/76)
- [docs: add multi-device troubleshooting; detect installed APK](https://github.com/clawperator/clawperator/pull/77)
- [feat(node): payload authoring ergonomics (--dry-run, matcher normalisation)](https://github.com/clawperator/clawperator/pull/78)
- [feat(skills): skills new scaffolding with --summary, run.sh shim, and skills run envelope docs](https://github.com/clawperator/clawperator/pull/79)
- [chore: final run checks — regenerate cli-reference and close out agent-first-run tasks](https://github.com/clawperator/clawperator/pull/81)
- [docs(tasks): add record and replay PRD and strategy](https://github.com/clawperator/clawperator/pull/82)
- [feat(record): add android runtime recording](https://github.com/clawperator/clawperator/pull/83)
- [feat(node, docs): recording retrieval, parsing and validation](https://github.com/clawperator/clawperator/pull/84)
- [docs(record): complete phase 3 recording-to-skill workflow](https://github.com/clawperator/clawperator/pull/85)
- [fix(skills): standardize skill env vars and local bin resolution](https://github.com/clawperator/clawperator/pull/86)
- [Remove the legacy install.sh copy step](https://github.com/clawperator/clawperator/pull/87)
- [Fix multi-device installer readiness handling](https://github.com/clawperator/clawperator/pull/89)
- [Update branch CI to run Android and Node tests](https://github.com/clawperator/clawperator/pull/88)
- [Update landing hero image and tighten its panel layout](https://github.com/clawperator/clawperator/pull/90)
- [Add share image metadata to landing and docs sites](https://github.com/clawperator/clawperator/pull/91)

## [0.3.1] - 2026-03-17
This release delivered Node API and CLI reliability improvements and documentation and website refreshes. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.

Pull requests:
- [fix: install flow, doctor URL, skills search UX, and Cloudflare 404 redirects](https://github.com/clawperator/clawperator/pull/68)

## [0.3.0] - 2026-03-16
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.
- **Fixed:** Fixed Android runtime issues affecting gesture, action, or observation reliability.

Pull requests:
- [refactor(skills): replace bundle install with direct GitHub clone](https://github.com/clawperator/clawperator/pull/67)

## [0.2.5] - 2026-03-11
This release delivered Node API and CLI reliability improvements and documentation and website refreshes. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

Pull requests:
- [chore(version): set to 0.2.4](https://github.com/clawperator/clawperator/pull/49)
- [skills: Add release create/verify workflow](https://github.com/clawperator/clawperator/pull/50)
- [docs(task): Google Play skill exploration and findings](https://github.com/clawperator/clawperator/pull/51)
- [feat(release): split code and published version flows](https://github.com/clawperator/clawperator/pull/52)
- [fix(node): surface snapshot extraction failures as SNAPSHOT_EXTRACTION_FAILED](https://github.com/clawperator/clawperator/pull/53)
- [fix(tests): remove platform-specific SDK paths, fix runtimeConfig tests](https://github.com/clawperator/clawperator/pull/54)
- [docs(geo): improve agent-facing crawl surfaces](https://github.com/clawperator/clawperator/pull/48)
- [docs(node-api): fix all open docs-audit issues (ISSUE-02 through ISSUE-12)](https://github.com/clawperator/clawperator/pull/55)

## [0.2.4] - 2026-03-11
This release delivered Node API and CLI reliability improvements and documentation and website refreshes. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.

### 📚 Documentation & Website
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.

Pull requests:
None found

## [0.2.2] - 2026-03-11
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.
- **Fixed:** Fixed Android runtime issues affecting gesture, action, or observation reliability.

Pull requests:
- [fix(install): clarify post-install shell reload covers skills registry](https://github.com/clawperator/clawperator/pull/39)
- [docs: replace placeholder docs with current-state agent-facing docs](https://github.com/clawperator/clawperator/pull/40)
- [apps/node: add Android emulator provisioning support](https://github.com/clawperator/clawperator/pull/41)
- [Update docs for emulator](https://github.com/clawperator/clawperator/pull/42)
- [llms-full.txt generation](https://github.com/clawperator/clawperator/pull/43)
- [fix(node-api): canonicalize snapshot contract](https://github.com/clawperator/clawperator/pull/44)
- [feat(site): improve agent-facing crawl surfaces](https://github.com/clawperator/clawperator/pull/46)

## [0.2.1] - 2026-03-09
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.
- **Fixed:** Fixed Android runtime issues affecting gesture, action, or observation reliability.

Pull requests:
- [feat: serve skills as git bundle from clawperator.com](https://github.com/clawperator/clawperator/pull/33)
- [docs: remove GitHub skills refs, clean up interim docs, update bootstrap guide](https://github.com/clawperator/clawperator/pull/34)

## [0.2.0] - 2026-03-09
This release delivered Node API and CLI reliability improvements and documentation and website refreshes. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

Pull requests:
- [sites: update](https://github.com/clawperator/clawperator/pull/12)
- [feat(installer): improve install.sh and align docs with live APK flow](https://github.com/clawperator/clawperator/pull/13)
- [feat(landing): refresh copy and design and align install script builds](https://github.com/clawperator/clawperator/pull/15)
- [feat(skills): add skills API integration layer for discovery, search, run, and install](https://github.com/clawperator/clawperator/pull/16)
- [docs(site): regenerate public docs for skills API integration](https://github.com/clawperator/clawperator/pull/17)
- [feat(landing): add Skills and Workflows sections to landing page](https://github.com/clawperator/clawperator/pull/18)
- [docs: point blocked terms policy to user config](https://github.com/clawperator/clawperator/pull/19)
- [node: refresh doctor severity flow](https://github.com/clawperator/clawperator/pull/20)
- [docs: clean up stale planning/docs and align remaining readiness tasks](https://github.com/clawperator/clawperator/pull/21)
- [feat(site): add system light mode to landing and docs](https://github.com/clawperator/clawperator/pull/23)
- [docs: restore mkdocs-terminal and keep system light mode](https://github.com/clawperator/clawperator/pull/24)
- [fix(node): compatibility version regex and get cli version](https://github.com/clawperator/clawperator/pull/22)
- [fix(landing): clawperator skills registry and git terminal prompt](https://github.com/clawperator/clawperator/pull/25)
- [chore(landing): update documentation and adjust developer tooling](https://github.com/clawperator/clawperator/pull/26)
- [feat(docs): update docs](https://github.com/clawperator/clawperator/pull/28)
- [fix(docs): disable npm provenance for private repo publish](https://github.com/clawperator/clawperator/pull/29)
- [fix(docs): restore id-token: write for npm trusted publishing auth and disable npm](https://github.com/clawperator/clawperator/pull/30)

## [0.1.4] - 2026-03-06
This release focused on packaging and release metadata updates, with no user-facing source changes detected in the tagged range.

Pull requests:
None found

## [0.1.3] - 2026-03-06
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.

Pull requests:
- [release: add Android APK GitHub and Cloudflare release pipeline](https://github.com/clawperator/clawperator/pull/9)

## [0.1.2] - 2026-03-06
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.

Pull requests:
None found

## [0.1.1] - 2026-03-06
This release delivered Node API and CLI reliability improvements and documentation and website refreshes. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.

### 📚 Documentation & Website
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.

Pull requests:
None found

## [0.1.0] - 2026-03-06
### Added

- Initial public release.
- Node.js CLI with core commands for `doctor`, `devices`, `execute`, `observe`, `action`, `skills`, and `serve`.
- Android runtime with accessibility-based automation.
- Skills repository integration.

Pull requests:
None found

## [0.1.0-alpha.2] - 2026-03-06
This release delivered Node API and CLI reliability improvements, documentation and website refreshes, and Android runtime updates. Changes were synthesized from commit classifications in this tag range.

### 🤖 Node API & CLI
- **Added:** Added new runtime and command-surface capabilities in this release range.
- **Changed:** Updated existing Node API and CLI behavior for consistency, release readiness, and maintainability.
- **Fixed:** Fixed reliability issues in execution, diagnostics, and command handling paths.

### 📚 Documentation & Website
- **Added:** Added new documentation content and site guidance for supported workflows.
- **Changed:** Updated docs and website surfaces to match current runtime behavior and release workflows.
- **Fixed:** Fixed documentation and website issues that affected installation or discoverability.

### 📱 Android Operator APK
- **Added:** Added Android operator/runtime capabilities to support new automation flows.
- **Changed:** Updated Android runtime paths to align with the current Node and contract behavior.
- **Fixed:** Fixed Android runtime issues affecting gesture, action, or observation reliability.

Pull requests:
- [fix(test): Add missing DeveloperOptionsManager to UiActionEngineDefaultTest](https://github.com/clawperator/clawperator/pull/7)
