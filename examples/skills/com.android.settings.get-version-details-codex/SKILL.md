---
name: com.android.settings.get-version-details-codex
description: Read Android OS release version and build number from live Settings UI with Codex.
androperator-skill-type: orchestrated
version: 1.3.1
---

# Android version details

Follow [Host Agent Orientation](https://docs.androperator.com/host-agents/) to select
a compatible CLI/device/Operator pair before running this skill. Set
`ANDROPERATOR_BIN` to the intended CLI. Select this local collection with
`ANDROPERATOR_SKILLS_DIR=/absolute/path/to/examples/skills`. Configure `VERSION_CODEX_MODEL` explicitly for the selected, authenticated
Codex executable; `VERSION_CODEX_EFFORT` defaults to `high`. No separate OpenAI API
key is required when using Codex account authentication.

`VERSION_RUN_DIR`, if supplied, must be a fresh absolute evidence directory. Runs
reserve their device against other copies of these examples; also ensure no other
controller is using it. Raw evidence can contain private device data and stays
local. Use a new directory for every attempt, including after failure.

Invoke through the selected CLI (use `node <absolute_index.js>` for a branch-local
JavaScript entry point):

```bash
androperator skills run com.android.settings.get-version-details-codex --device <device_serial> --operator-package <operator_package> --timeout 300000 --output json
```

The wrapper resolves `codex` from `PATH`; select a compatible, authenticated
executable there before running. Check its version/help and model availability
separately from Android readiness. Inspect the outer CLI outcome and nested
`skillResult`: success requires both verified UI fields, while a failed result
retains its reason and may have no success receipt. Keep the run directory's
raw command responses, `events.json`, `metadata.json`, and agent transcript for
diagnosis. `run-summary.json` measures harness time, not outer CLI startup.

## Task and evidence

Read the Android OS release version and Build number from live Settings UI. Preserve both exact strings. API level, security patch, kernel and manufacturer skin are different fields. Never use shell properties, historical answers, or direct About-screen intents. Do not change settings or tap Build number.

The helper offers fresh, visible, executable candidates with capture IDs. It preserves full compact hierarchy locally and verifies exact sibling label/value association against live `read-value` envelopes. It never chooses a route for Codex. Unknown structure, duplicate labels, truncation or read disagreement must return control to Codex or fail truthfully.

## Supported route boundary

The supported root-start route finds About phone/tablet/emulated device in the
Settings list, then Software information where present. System is retained as
screen context but is not offered as a version-details navigation candidate:
its submenu has no supported return candidate in this example. A run resumed
inside System must stop honestly if no supported path is available; this example
does not claim general back-navigation recovery. Do not reset a failed run or
start on About and describe that as root-start proof. Provider choice remains
optional in the host control-loop guidance.

## Observed path and adaptation

On the proven emulator, Settings opens at its root after a close/Home reset. Scroll the visible list until About emulated device is visible; open it, then scroll the inner list until both requested fields have been collected. Android version can appear before Build number. On the previously observed Samsung route, scroll to About phone, then reveal and open Software information. Its titles have an extra title_frame wrapper; the shared parser verifies the nearest row rather than assuming direct siblings. Observe these labels on other OEM devices before acting. Route labels, hierarchy and current state take precedence over this hint. Opening Settings can resume a previous page.

Use `open` first. Inspect its current observation and collected fields. Use `act <candidate_id> <capture_id>` to execute one offered action; it automatically observes the resulting screen. `observe` refreshes stale evidence. Prefer a visible About or Software information row; otherwise scroll down when the needed fields are missing. Do not alternate scroll directions without evidence of overshooting. At most 18 actions per run. If the screen changes unexpectedly, inspect the retained observation and reacquire. Unsupported or unsafe screens require a truthful failed result. On command failure, inspect its retained JSON and distinguish readiness, dispatch, result-wait, and post-processing evidence. Observe current state before retrying an uncertain action; a not-dispatched command may still have earlier preflight effects.

If a capture returns `overlay_review_required`, use Codex's image viewing tool to inspect its screenshotPath. Only if Settings is clearly usable and the overlay is harmless (for example Samsung's thin edge-panel handle), invoke `approve-overlay <captureId>`. This grants a run-local allowance for that observed overlay package and reacquires evidence. A changed foreground or another overlay package requires a fresh review. Never approve an unknown dialog, obscured target, or confirmation. Do not approve from metadata alone. The known Samsung case reports its launcher as an overlay even though Settings is usable.

When complete, review the exact collected values and their evidence, call `finish`, then return its compact JSON receipt. `finish` reacquires a snapshot, retains a final screenshot and verifies both fields against this run's raw evidence. The launcher verifies the receipt hash and emits exactly one full SkillResult frame with the retained execution envelopes. Do not paraphrase or manually generate the result.

## Codex decisions

Choose every navigation action yourself from the current observation. Do not invoke the Jev operation. The read/evidence helper is shared with the Jev arm and contains no route selection loop.

## Evidence context

The shared `skills/utils/observation_context.js` adapter accepts compact-v1
snapshots. It preserves explicit parent edges and boolean/null/omitted state,
records source coverage separately from projection omissions, and maps offered
candidates to observed nodes and unique supported selectors. The Settings helper
selects relevant rows and navigation; provider request formatting stays separate.
See [Context adapter](https://docs.androperator.com/skills/context-adapter/).

Successful observations retain original XML, compact response, projection and
metrics. Failed attempts retain the returned command response and diagnostics.
The helper also captures screenshot dimensions before the tree for viewport
intersection checks. These are separate captures, not an atomic observation or
proof against occlusion. No accessibility selector is derived from pixels.
The projection keeps at most 64 nodes including ancestors and 24,000 UTF-8 JSON
bytes; it refuses an oversized semantic group instead of clipping values or
ancestry. Missing text is not evidence of absence. Inspect the local source or
reacquire richer evidence if the helper reports incomplete or insufficient input.

Candidates expire before dispatch and on every observation attempt, including
failed refreshes. After unexpected UI changes, refresh before choosing again.
Every dispatched candidate is followed by a fresh observation; check the resulting
screen against your intended destination. A candidate ID or query path is not a
persistent native action handle. Filtering for this task is not a general privacy
guarantee. Jev receives an explicit narrower view: navigation descriptions,
structural/state evidence, coverage and capture correlation, with local device
identifiers, source paths, exact extracted values and unrelated text omitted.

## Observation failures and recovery

Inspect `failure.code`, `scope`, `failedStep`, `extractionReason`, `phase` and
`dispatchState` before choosing a response. Command and readiness-probe correlation
remain separate. `references` points to retained local command JSON/stdout/stderr;
original envelopes, including failed attempts, are never replaced. Optional
numeric parser/extraction facts are allowlisted; unknown facts remain unavailable.
A malformed source does not establish its underlying cause.

`freshness.status` is `current` only for an unexpired successful observation.
Actions invalidate candidates before dispatch; failed refreshes leave them stale.
Both the top-level and nested evidence candidate menus are empty while stale.
Capture IDs, headings and collected verified values then describe history, not
current actionable UI. A provider rejection alone does not invalidate a still
current capture. Refresh after any external UI transition.

For a retained `SNAPSHOT_EXTRACTION_FAILED` with `malformed_xml`,
`post_processing` and known `dispatched` state on a standalone snapshot,
Codex may explicitly call `recover-observation`. The Jev controller invokes the
same orchestrator policy on eligible failures. It allows one fresh observation
per run, at most 10 seconds and within the remaining run/delegation deadline,
with at least one second remaining before starting. `recoveries.json` retains
the original failure, attempt and resulting capture or failure. Never repeat the
preceding action or a mixed payload as recovery. Repeated failure, unknown
dispatch, incompatible versions, forbidden source, source limits, logging/setup
failure or exhausted budget requires diagnosis or a truthful stop. Do not restart
delegation to reset limits. Runtime commands themselves never retry.

Successful recovery restores observation validity only. Check the destination,
review overlays and collect missing fields before calling `finish`; recovery is
not terminal verification. Existing exact row/read-value proof still applies.

Child commands use `<run-directory>/logs`, overriding inherited shared paths.
The helper checks create/write access inside the child sandbox before device
operations and records `logging.json`; launcher metadata begins as pending.
`LOGGING_SETUP_FAILED` stops before dispatch. Later logging write failures are
recorded alongside the primary command result without changing that result.
Only existing files from a logger that has not disabled itself are advertised as
available diagnostic artifacts. Keep all raw UI and provider logs local.
