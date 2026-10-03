# Context adapter

The linked helper is a historical Clawperator reference, not an Androperator installation dependency. Bundled examples will be added separately.

The companion skills repository provides a provider-neutral adapter in
[`skills/utils/observation_context.js`](https://github.com/clawperator/clawperator-skills/blob/main/skills/utils/observation_context.js).
It selects evidence for model context without changing Androperator's execution
contract. It contains no model calls, app navigation policy, or retry loop.
The two Settings version-details examples use it through their shared Settings
helper; Codex still controls the task and optional Jev proposals remain bounded.

## Input contract

`normalizeCompact(snapshot, context)` accepts the existing **compact schemaVersion
1 snapshot response**, with its successful `envelope`, successful snapshot step,
and top-level `compact`. It does not accept XML strings, query results, screenshots,
or arbitrary node arrays. Capture and task IDs must agree between envelope and
compact. Counts must agree with the nodes. Node paths must be unique and parent
links must be explicit and acyclic. Invalid inputs throw a bounded diagnostic;
the caller must retain the original response before normalization.

Compact preserves XML bounds as `[left,top][right,bottom]` strings. The adapter
validates their numeric geometry for targeting. It uses explicit `parentPath`
links, never path-prefix or dot-count heuristics. Anonymous parents remain nodes.

Optional `context` records caller-known `device`, `operatorPackage`, `receivedAt`,
`sourceReference` and `viewport`. A viewport has numeric `bounds` with `left`,
`top`, `right`, `bottom`, plus `reference` and `observedAt`. These are caller-supplied
facts, not a viewport-discovery API. The Settings helper uses PNG dimensions from
a separate screenshot taken before the tree and records `sourceKind:
'image-dimensions'` and `atomicWithTree: false`. Receipt time is host observation
time, not a fabricated Android capture timestamp. Missing provenance remains
`null`; the capture command ID, task ID, foreground package and raw artifact
reference are retained when available.

Normalization copies supported text, identity, geometry, truncation and state
fields. Boolean `false` stays false, `true` stays true, `null` means unknown, and
an omitted property stays omitted. It cannot recover distinctions already lost
by the source: compact converts absent or unrecognized XML boolean attributes
to null. Original XML is the recovery evidence for such questions.

## Projection contract

`projectObservation(observation, options)` receives the normalized observation
and explicit task-selected `selectPaths`, plus optional `candidateSpecs`,
`maxNodes` (default 64) and `maxBytes` (default 24,000 UTF-8 JSON bytes).
Each candidate specification contains a unique `id`, observed `nodePath`, and
`kind: 'click'` or `kind: 'scroll'`. Goal selection belongs in the caller.

The result contains:

| Field | Meaning |
| --- | --- |
| `provenance` | Capture identity, receipt time, source kind, local evidence references and caller-supplied correlation |
| `coverage.source` | Completeness of the supplied accessibility tree, counts, source truncation, text truncation and missing parents |
| `coverage.projection` | Selected/retained nodes, deliberate omissions, budget omissions and projection truncation |
| `nodes` | Selected nodes plus every available ancestor, with supported source facts preserved |
| `candidates` | Capture-local mappings to observed nodes, supported selectors and clickable context |
| `discoveryHints` | Requested candidates that failed eligibility, with explicit reasons |
| `needsRicherEvidence` | Source incompleteness or a refused projection budget |
| `recovery` | Route to retained source or a fresh, task-appropriate capture |

A complete source means the compact response retained its reported accessibility
tree. It does not mean all app screens, all windows or all visible pixels were
captured. Missing parents, source/text truncation or omitted source nodes make
it incomplete and suppress actionable candidates. An invalid response throws
instead of masquerading as an empty complete tree. Deliberate task filtering is
recorded separately from source incompleteness.

Projection retains the selected semantic group and its ancestry together. If
node or byte limits are exceeded, it returns no nodes/candidates/hints, marks
budget omissions and requests richer evidence. It never clips a value to fit.
If even coverage and provenance cannot fit, it throws a budget error. These bounds
apply to the adapter result, not the caller's entire prompt or provider request.
Inspect local evidence, narrow the task selection or explicitly increase the
budget. Missing text in a partial view is never proof of absence.

## Targets and lifecycle

Click candidates require a nonblank text selector unique across **all** source
nodes, including hidden nodes and content-description fallback labels, and a
visible enabled clickable node or ancestor.
Scroll candidates require a unique resource ID and a scrollable node. Disabled
or hidden ancestry and known sensitive context block eligibility. The adapter
checks valid bounds, positive intersection with the supplied viewport and known
ancestor bounds. Without viewport evidence, candidates remain discovery hints.
It emits only `textEquals` for clicks and `resourceId` for scrolls; this is an
intentionally small subset of the supported [selector contract](../api/selectors.md).

These tests do not establish lack of occlusion. Platform visibility, geometry,
enabled state and selector uniqueness each contribute evidence, not certainty.
Candidate IDs and paths are capture-local references, not persistent native
handles. The caller translates the supported selector to an Androperator action,
serializes device access, expires candidates after transitions and verifies the
destination after acting. The Settings helper invalidates its menu before
dispatch and before every refresh, even if the action or refresh fails, rejects
captures older than 45 seconds, and observes after each action. Unexpected UI
changes require another observation before acting.

No visual text or accessibility selector is inferred from PNG dimensions. If an
agent separately interprets an image, label the resulting facts as image-derived
and retain the image reference and time. Separately acquired trees and images
are not atomic. Image descriptions cannot create accessibility selectors.

## Small example

```javascript
const { normalizeCompact, projectObservation } = require('./skills/utils/observation_context');

// Save the original response and XML locally before using this projection.
const observation = normalizeCompact(snapshotResponse, {
  device: selectedDevice,
  operatorPackage: selectedOperator,
  receivedAt: snapshotReceivedAt,
  sourceReference: 'command-4.json',
  viewport: {
    bounds: { left: 0, top: 0, right: imageWidth, bottom: imageHeight },
    reference: 'viewport.png', observedAt: imageReceivedAt,
    sourceKind: 'image-dimensions', atomicWithTree: false,
  },
});
const label = observation.nodes.find(node => node.text === 'About phone');
const context = projectObservation(observation, {
  selectPaths: label ? [label.nodePath] : [],
  candidateSpecs: label ? [{ id: 'about', kind: 'click', nodePath: label.nodePath }] : [],
});
// Ask the controlling agent to choose from context.candidates, or acquire richer
// evidence. This example does not execute a candidate or prove label absence.
```

## Settings and provider boundaries

`settings_version_model.js` selects Settings labels, associates exact values
with their nearest supported row (including a Samsung title wrapper), and
prefers the deepest eligible list by explicit ancestry. `settings_version_runtime.js`
retains XML, compact responses, screenshot dimensions, projections, timing and
command references. Exact values still require independent successful
`read-value` results from the current run. Isolation, bounded Jev delegation,
Codex fallback and final evidence verification remain in the existing helpers.

Codex receives the Settings projection. `settings_version_jev.js` formats a
narrower provider request with navigation descriptions, ancestry/state evidence,
coverage and capture correlation. It explicitly omits node text, resource IDs,
local device/source references, bounds and extracted values from that evidence
view. The local capture retains them for inspection and mapping; these omissions
are disclosure choices in provider formatting, not changes to normalized truth.
Task filtering is not a general privacy guarantee. Raw evidence and provider
logs may contain private data and must remain local and ignored.

Prefer existing targeted observation when it can answer the task directly.
`read-value --label` associates a label and value. Query `--text` maps to
`textEquals`, which compares the native `label`: nonblank node text, otherwise
nonblank content description, otherwise an empty string. Compact `text` is the
XML text attribute, not that combined label. Selector uniqueness must therefore
include description-only nodes that can match the same native label. Query results use numeric bounds and are
serialized in `step.data.query`, whereas compact lives at top level and uses
XML bounds strings. This adapter does not silently unify them. See
[Observation](../api/snapshot.md) for the existing APIs.

Measure projection bytes and provider input usage separately from acquisition
and full-run time. Smaller payloads can help context budgets, but do not prove
better decisions or faster Android capture. The Settings helper records
projection time, source/projection bytes, snapshot command time and separate
viewport screenshot time; provider latency and full-run summaries remain separate.


## Failed refresh and stale evidence

Orchestrators must invalidate executable candidates after dispatched actions,
failed observation refresh, or uncertain dispatch. Clear both the public menu and
nested adapter evidence menu. Retain capture identity and collected values as
historical evidence, and preserve pending overlay review metadata without making
stale candidates actionable. A provider failure before action does not by itself
make a still-current capture stale; age and transition rules still apply.

Inspect the original failed step, earlier effects and requested/probe dispatch
evidence before deciding whether a bounded fresh read-only observation is eligible.
Never repeat a preceding mutation implicitly. A fresh capture restores observation
validity only: check the destination and independently verify final task evidence.
Use [snapshot diagnostics and recovery](../api/snapshot.md#extraction-diagnostics-and-recovery)
for core fields, safe diagnostic bounds, logger availability and the Settings
examples' explicit one-recovery policy. The adapter and core do not decide retries.
