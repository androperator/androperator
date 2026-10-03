# Resolve ambiguous targets and verify the result

Use observed structure to select a target, then verify the destination separately
from the action receipt. This walkthrough applies to apps with duplicate labels
or overlapping panes, including lists with the same resource ID and bounds.
App navigation and the meaning of a successful test remain the caller's decisions.

## Check readiness and discover candidates

Select one device and the matching Operator explicitly. In a development checkout,
use the built CLI with `node apps/node/dist/cli/index.js` in place of `androperator`.
The examples use a generic fixture package; replace its IDs and labels with values
observed in your app. Replace `<device_serial>` before running the commands.

```bash
androperator doctor --device <device_serial> --operator-package com.androperator.operator.dev
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --text Open --visibility all --limit 100
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --visibility all --limit 200
```

Inspect the terminal envelope and each step's success before decoding the
JSON string in `data.query`. Check `totalMatches`, `returnedCount`, and `truncated`;
a truncated query cannot establish uniqueness. The unfiltered capture lets you
follow each candidate's `parentPath` through the `nodePath` values in that same
capture to find a distinguishing ancestor. A filtered query may omit ancestors.
Paths are observation-local, not reusable selectors. See the
[query contract](actions.md#action-query-ui) for state and decoding details.

Two `Open` candidates can both report `onScreen: true`, even when one is behind
another pane. `visibleToUser`, on-screen bounds, matching bounds, and preorder do
not establish visual non-occlusion or which pane is topmost. Inspect the hierarchy
and screenshot, and use the app's observed context to choose the intended pane.
If the observed structure offers no unique selector, stop rather than guessing.

## Require a unique target

A non-strict single read can expose the default selection warning without clicking:

```bash
androperator read --device <device_serial> --operator-package com.androperator.operator.dev --text Open
androperator read --device <device_serial> --operator-package com.androperator.operator.dev --text Open --strict
androperator read --device <device_serial> --operator-package com.androperator.operator.dev --strict --matcher-json '{"textEquals":"Open","ancestor":{"resourceId":"com.example.scopedselection:id/detail_pane"}}'
```

For duplicate labels, the first call retains first-match behavior and includes
`data.selection_warning`. Its counts are the largest observed across that action's
attempts. The second rejects ambiguity with `NODE_AMBIGUOUS`; inspect its candidate
evidence. The third requires one target under the observed detail ancestor.
Re-query when the app changes: a previously unique observation does not reserve a
node for the next action. See [strict selection](selectors.md#strict-action-selection).

Warnings can coexist with failed steps. Preserve them along with the failure code,
not just successful results. CLI JSON and pretty output preserve the full envelope.
MCP execution tools retain envelope diagnostics; successful MCP `read` returns the
value first and optional warning as a separate JSON text content item. Consume all
content items. Structured fields encoded inside step data remain JSON strings.

## Select the intended scroll container

First query the shared list ID and inspect both ancestor chains. Add the observed
ancestor to the container matcher, then confirm that the resulting query returns
exactly one node:

```bash
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --id com.example.scopedselection:id/list --visibility all
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --matcher-json '{"resourceId":"com.example.scopedselection:id/list","ancestor":{"resourceId":"com.example.scopedselection:id/detail_pane"}}'
androperator scroll-until down --device <device_serial> --operator-package com.androperator.operator.dev --text 'Target item' --strict --container-json '{"resourceId":"com.example.scopedselection:id/list","ancestor":{"resourceId":"com.example.scopedselection:id/detail_pane"}}'
```

Inspect `resolved_container`, `scrolls_executed`, `termination_reason`, and the
available JSON-encoded `progress` and selected `target` evidence in the step data.
`resolved_container` is an ID, so it cannot distinguish these same-ID lists by
itself. The action captures a fresh tree: do not join its target's `nodePath` or
`parentPath` to paths from an earlier discovery query. Use the observed ancestor
matcher to scope the action, then use fresh scoped queries and app-state assertions
to verify the result. Follow parent chains only within a single query capture.
`TARGET_FOUND` establishes that the search observed its target in the selected
scope. `NO_POSITION_CHANGE` can reflect tracking the wrong overlapping container;
it does not by itself prove
that the intended pane cannot scroll. Rediscover the scope before another attempt.
Strict selection rejects duplicate containers with `CONTAINER_AMBIGUOUS`.

The flat CLI supports direction, target, container, strict mode, and `--timeout`.
It has no `--max-scrolls` flag. Advanced bounded tuning uses raw `exec` action
parameters such as `maxScrolls` and `maxDurationMs`; see
[`scroll_until`](actions.md#action-scroll-until). Do not add blind sleep loops or
coordinate fallbacks to recover from an unexplained result.

## Wait, assert, then capture

Click the observed target within the same selected scope, then wait for a
unique destination-only marker:

```bash
androperator click --device <device_serial> --operator-package com.androperator.operator.dev --text 'Target item' --strict --container-json '{"resourceId":"com.example.scopedselection:id/list","ancestor":{"resourceId":"com.example.scopedselection:id/detail_pane"}}'
androperator wait --device <device_serial> --operator-package com.androperator.operator.dev --text 'Detail destination ready' --strict --timeout 5000
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --text 'Detail destination ready'
androperator evidence capture --device <device_serial> --operator-package com.androperator.operator.dev --output-dir /absolute/new/bundle --label 'Scoped destination' --context-json '{"originalVerdict":"passed"}'
```

Require a successful wait and assert the query's intended label, uniqueness, and
relevant state. Set `originalVerdict` from those assertions; the literal `passed`
above is appropriate only after they pass. Include the original command ID in the
context when retaining evidence for a particular action. Use a fresh absolute
bundle directory whose parent exists.

Keep these facts separate:

| Evidence | What it establishes |
| --- | --- |
| Accepted dispatch receipt | Android accepted the action, without proving its effect. |
| Destination wait | The requested readiness marker appeared within the bound. |
| App-state assertion | The observed state satisfies the caller's actual test. |
| Verified PNG/XML | The captured artifact is usable, without proving the test. |
| Manifest `complete` | All required bundle components succeeded. |
| Manifest `partial` | A usable capture exists but another component failed; exit is nonzero. |

A partial manifest with usable screenshot and hierarchy can result from missing
metadata. Retain those artifacts and the manifest errors while preserving the
original test verdict. A complete bundle can equally document a failed test.
See [evidence status](evidence.md#result-and-exit-status).

For example, an empty input may omit its clear button. Assert the input's observed
value before deciding that a missing clear control is a failure. A bookmark shown
in one folder does not prove it was saved to the intended folder: verify folder
context and the entry together. These are app-state assumptions for the agent to
resolve, not new runtime navigation rules.

## Bound unresponsive-app investigation

Doctor checks device/Operator readiness; a passing doctor does not prove that the
target app responds or that its current page is ready. After a bounded wait or
query failure, retain the exact terminal code and available evidence. Make one
bounded diagnostic capture when available. If it visibly shows an Android
application-not-responding dialog, classify that observation as an app ANR;
a timeout alone is not proof of one. If the capture also fails, record the state
as unconfirmed and stop the attempt. Do not automatically dismiss the dialog,
repeat an uncertain mutation, or infer an Androperator regression from an ANR.
See [doctor](doctor.md) and [timeouts](timeouts.md).
