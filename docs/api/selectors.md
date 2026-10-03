# Selectors

For a complete discovery, strict selection, scroll, assertion, and capture workflow,
see [scoped selection walkthrough](scoped-selection.md).

## Purpose

Define the `NodeMatcher` contract used across execution payloads, explain how CLI selector flags map into that contract, and document the mutual-exclusion rules that prevent ambiguous selector input.

## Sources

- Contract shape: `apps/node/src/contracts/selectors.ts`
- Shared matcher limits: `apps/node/src/contracts/limits.ts`
- Execution validation: `apps/node/src/domain/executions/validateExecution.ts`
- CLI selector parsing: `apps/node/src/cli/selectorFlags.ts`
- `read-value` label selector handling: `apps/node/src/cli/registry.ts`

## `NodeMatcher` Contract

The raw selector object shared by `matcher`, `container`, `expectedNode`, and `labelMatcher` is:

```json
{
  "resourceId": "optional string",
  "role": "optional string",
  "textEquals": "optional string",
  "textContains": "optional string",
  "contentDescEquals": "optional string",
  "contentDescContains": "optional string",
  "ancestor": { "resourceId": "optional structural ancestor ID" },
  "descendant": { "textEquals": "optional descendant label" }
}
```

Meaning of each field:

Stable field anchors:

- <a id="selector-field-resource-id"></a>`resourceId`
- <a id="selector-field-role"></a>`role`
- <a id="selector-field-text-equals"></a>`textEquals`
- <a id="selector-field-text-contains"></a>`textContains`
- <a id="selector-field-content-desc-equals"></a>`contentDescEquals`
- <a id="selector-field-content-desc-contains"></a>`contentDescContains`

| Field | Match behavior |
| --- | --- |
| `resourceId` | exact Android resource ID match |
| `role` | case-insensitive exact semantic role match |
| `textEquals` | exact visible-text match |
| `textContains` | case-insensitive substring label match |
| `contentDescEquals` | exact content-description match |
| `contentDescContains` | case-insensitive substring content-description match |

Rules enforced by Node:

- a matcher may contain one field or several fields
- multiple fields combine into one object, so the runtime receives all of them together
- empty matcher objects are invalid; for all-node discovery, use `query` without
  `--matcher-json` / `--selector` (see the [safe query consumer](actions.md#runnable-node-consumer))
- each matcher string value must be at most `512` characters (`LIMITS.MAX_MATCHER_VALUE_LENGTH`)
- simple CLI selector flags reject blank values; raw predicates require at least one nonblank field
- selector objects are strict in execution validation, so unknown keys are rejected
- common input aliases are normalized before that strict validation runs, including `id`/`resource_id`, `text`, `text_contains`, `content_desc`, `description`, and `accessibility_label`
- when the shared CLI parser sees no selector flags at all, it returns an empty matcher object and the command decides whether selectors are required for that command

Accepted raw JSON matcher-field aliases:

| Alias | Canonical field |
| --- | --- |
| `id`, `resource_id` | `resourceId` |
| `text` | `textEquals` |
| `text_contains` | `textContains` |
| `content_desc`, `description`, `accessibility_label` | `contentDescEquals` |
| `content_desc_equals` | `contentDescEquals` |
| `content_desc_contains`, `description_contains`, `accessibility_label_contains` | `contentDescContains` |

Concrete payload example:

```json
{
  "matcher": {
    "role": "button",
    "textContains": "Settings"
  }
}
```

Success condition for that selector object:

- the object uses only the six scalar matcher keys and optional `ancestor` / `descendant` predicates
- at least one value is non-empty

## Relational Matching

`NodePredicate` contains the six scalar fields above. A `NodeMatcher` may also
contain `ancestor` and `descendant`, each a non-empty `NodePredicate`. All supplied
fields and relationships combine with AND. Relationship predicates cannot contain
nested relationships or unknown fields, and require at least one nonblank field.
Other supplied scalar strings retain their exact matching semantics, including
`{"role":"switch","textEquals":""}` for empty labels. A relationship alone is a
valid matcher. Exact text and description comparisons remain case-sensitive;
roles and substring comparisons ignore case. Labels use text when available,
otherwise content description, otherwise an empty string.

`ancestor` means any strict ancestor in the original captured structural tree.
`descendant` means any strict descendant eligible under the request visibility.
Self never satisfies either relationship. Actions use `on_screen` eligibility;
queries choose `on_screen` or `all`. Hidden stale descendant labels therefore
cannot select an otherwise visible container during an action. Structural
ancestors remain available when resolving within a selected container.

```bash
androperator query --matcher-json '{"resourceId":"row","ancestor":{"role":"list"},"descendant":{"textEquals":"Display"}}'
```

Queries report every match and its state, including empty-label controls. Existing
actions retain their first-match behavior and retry defaults unless `strict=true`. Querying a unique
node does not reserve it or authorize a later action against that observation.
See [query_ui](actions.md#action-query-ui) for counts, state, per-node
`accessibilityDataSensitive`, and path semantics. Sensitivity is observation
metadata, not a selector predicate.

## Duplicate-selection hints

When a non-strict action finds multiple candidates and selects the first,
its step data includes `selection_warning`. The warning identifies duplicate
target or container selection and teaches `--strict` (`params.strict=true`) as
an option for rejecting ambiguity. The action keeps its existing result and
first-match behavior; the warning alone is not a failure.

For example, a successful click can include:

```json
{
  "selection_warning": "Multiple candidates matched; first-match selection was used. Largest candidate counts observed: target: 7. Use --strict (params.strict=true) to reject ambiguous matches."
}
```

Counts are the largest observed for each kind of selection during that action,
including retries and scroll searches. They are not a receipt for the final
dispatch. Repeated observations produce one bounded warning per action. Unique
selection and queries omit the warning. `read_text` with `all=true` intentionally
allows multiple targets and does not warn about them; a duplicate explicit
container still produces the hint. The same step data is available through CLI,
raw execution, and MCP. MCP `read` preserves its scalar/list value as the first
content item and adds the warning as a separate JSON text item when present.

## Strict action selection

Set `params.strict: true` in raw execution, `--strict` in the CLI, or `strict: true`
in a named MCP tool. This applies to `click`, `enter_text`, `read_text`,
`wait_for_node`, `scroll`, `scroll_until`, and `scroll_and_click`. Omission or
`false` retains first-match selection. Strict must be a JSON boolean; strings,
numbers, and null are invalid. Coordinate clicks cannot use strict mode or a
container.

All seven actions accept an optional `container` matcher. The CLI exposes
`--container-json` and the `--container-*` shorthand flags on their corresponding
commands. JSON and shorthand container flags are mutually exclusive. Targets
must be strict descendants of the selected container; the container itself does
not match. Relationships still use the enclosing structural tree. Without strict
mode, an explicit container selects the first match.

| Selection under strict mode | Result |
| --- | --- |
| Immediate click, text entry, or single read: zero targets after existing retries | `NODE_NOT_FOUND`; no target dispatch |
| Single target selection: more than one candidate | `NODE_AMBIGUOUS`; no target dispatch or ambiguity retry |
| Explicit container: zero or multiple matches | `CONTAINER_NOT_FOUND` or `CONTAINER_AMBIGUOUS`, before child selection |
| Wait: target absent | Keep polling within the existing retry/timeout bounds |
| Scroll search: target absent | Keep searching within the selected scroll container and existing bounds |
| Read with `all=true`: zero or multiple targets | Existing empty/list text result; explicit container must still be unique |
| Scroll without an explicit container | Require exactly one eligible scrollable candidate |

When `findFirstScrollableChild=true` selects descendants of a non-scrollable
wrapper, strict mode also requires a unique eligible scrollable descendant.
Scroll target checks and the final click stay within the selected scrollable
subtree. Each observation and dispatch resolves fresh candidates; a preceding
query or successful search never reserves a node. A layout change that introduces
ambiguity fails before the next dispatch. Gestures already completed earlier in
a search are not undone.

Ambiguity data includes `candidate_count` as a decimal string and `candidates` as
serialized query-result JSON with at most 10 `NodeSummary` objects. Candidate
strings are capped at 512 characters; total count remains exact. Paths and state
have the same observation-only meaning as `query_ui`. Strict failures retain
preceding results and the failed step and stop subsequent actions in the execution.

```bash
androperator click --text "Open" --strict --container-json '{"resourceId":"row","descendant":{"textEquals":"Example"}}'
androperator read --role switch --all --strict --container-id "panel"
```

Use matching Node and Operator builds from v0.10 or later before adopting these
options. Older Operators may ignore unknown fields and therefore cannot enforce
strict selection. Existing skills can keep first-match defaults; opt in after
inspecting candidate counts and adding observable postconditions. Successful
selection and dispatch do not verify the application's intended result. Never
replay a mutation after an uncertain post-dispatch result.

## Where Selectors Appear

`NodeMatcher` is reused in several action parameters:

| Action parameter | Meaning |
| --- | --- |
| `params.matcher` | primary target node for actions such as `click`, `read_text`, `enter_text`, `wait_for_node`, `scroll_until`, and `scroll_and_click` |
| `params.container` | optional ancestor or scrollable container constraint |
| `params.expectedNode` | navigation target for `wait_for_navigation` |
| `params.labelMatcher` | label node for `read_key_value_pair` |

Example execution fragment:

```json
{
  "id": "read-1",
  "type": "read_text",
  "params": {
    "matcher": { "textEquals": "Battery" },
    "container": { "resourceId": "android:id/list" }
  }
}
```

## CLI Selector Forms

For most commands, the CLI offers two equivalent ways to build a `NodeMatcher`:

1. Shorthand flags such as `--text`, `--text-contains`, `--id`, `--desc`, `--desc-contains`, and `--role`
2. Raw JSON via `--matcher-json '<json>'` (alias of `--selector`)

Agent-friendly CLI aliases accepted for shorthand selectors:

- `--matcher-json` -> `--selector`
- `--resource-id` -> `--id`
- `--content-desc` -> `--desc`
- `--content-desc-contains` -> `--desc-contains`
- `--container-json` -> `--container-selector`
- `--container-resource-id` -> `--container-id`
- `--container-content-desc` -> `--container-desc`
- `--container-content-desc-contains` -> `--container-desc-contains`

Container selectors follow the same pattern:

1. Shorthand flags such as `--container-text`, `--container-id`, and `--container-role`
2. Raw JSON via `--container-json '<json>'` (alias of `--container-selector`)

The parser resolves shorthand flags into the same `NodeMatcher` object used by raw JSON. For example:

```bash
androperator wait --text "Done" --role button
```

becomes the matcher:

```json
{
  "textEquals": "Done",
  "role": "button"
}
```

## Choosing A Stable Selector

Treat selector choice as practical guidance, not as a guaranteed ranking that
applies to every app.

When more than one selector is available, prefer this order:

1. `resourceId` with a stable Android framework value (e.g., `android:id/title`)
2. `contentDescEquals`
3. `textEquals` or `textContains`
4. `resourceId` with an app-generated or opaque value (last resort)

Why this order is usually safer:

- Android framework `resourceId` values tend to be stable across app versions;
  app-generated IDs are often tied to a specific build and can change
- content descriptions work well for icon buttons and other controls where
  visible text is empty
- visible text is often the most obvious signal but can be brittle when labels
  are dynamic or localized
- app-generated `resourceId` values can work, but they are usually the most
  version-fragile option

Compose-heavy trees may expose fewer stable IDs and more internal resource
names. In those cases, `contentDescEquals` and visible text may be the most
practical stable selectors available.

## Selector Flags

Stable CLI flag anchors:

- <a id="selector-flag-matcher-json"></a>`--matcher-json`
- <a id="selector-flag-selector"></a>`--selector`
- <a id="selector-flag-text"></a>`--text`
- <a id="selector-flag-text-contains"></a>`--text-contains`
- <a id="selector-flag-id"></a>`--id`
- <a id="selector-flag-desc"></a>`--desc`
- <a id="selector-flag-desc-contains"></a>`--desc-contains`
- <a id="selector-flag-role"></a>`--role`
- <a id="selector-flag-container-selector"></a>`--container-selector`
- <a id="selector-flag-container-text"></a>`--container-text`
- <a id="selector-flag-container-text-contains"></a>`--container-text-contains`
- <a id="selector-flag-container-id"></a>`--container-id`
- <a id="selector-flag-container-desc"></a>`--container-desc`
- <a id="selector-flag-container-desc-contains"></a>`--container-desc-contains`
- <a id="selector-flag-container-role"></a>`--container-role`

<!-- CODE-DERIVED: selector-flags -->

## Mutual Exclusion And Validation Rules

Element selector rules:

- `--selector` is mutually exclusive with all shorthand element selector flags
- duplicate value flags such as repeating `--text` or `--id` are rejected
- `--selector` must be valid JSON
- `--selector` must parse to a JSON object, not an array or scalar
- blank values such as `--text ""` or `--selector ""` are rejected
- `click --coordinate <x> <y>` is mutually exclusive with every element selector flag
- `click --coordinate ... --focus` is invalid because coordinate clicks do not support `clickType = "focus"`

Container selector rules:

- `--container-selector` is mutually exclusive with all `--container-*` shorthand flags
- duplicate container flags such as repeating `--container-id` are rejected
- `--container-selector` must be valid JSON
- `--container-selector` must parse to a JSON object
- blank values such as `--container-text ""` are rejected
- if no container flags are present, Node omits `params.container`

Validation examples:

Valid:

```bash
androperator read --text "Price" --container-id "android:id/list"
```

Invalid:

```bash
androperator read --text "Price" --selector '{"textEquals":"Price"}'
```

Why invalid:

- the CLI parser rejects mixing `--selector` with shorthand element flags

Structured validation example:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "use --selector OR the simple flags, not both"
}
```

## Command-Specific Notes

### Most commands

`click`, `read`, `wait`, `scroll-until`, `scroll-and-click`, and `wait-for-nav` all use the shared selector parser from `selectorFlags.ts`. That means they share the same shorthand-to-JSON mapping and the same mutual-exclusion rules.

Required-vs-optional behavior is decided by the command after parsing:

- `click`, `read`, and `wait` require an element selector unless `click` is using `--coordinate`
- `wait-for-nav` accepts either `--app` or a selector, but still requires at least one of them
- `scroll` has no target selector and uses only optional container selector flags
- `scroll-until` and `scroll-and-click` require a target selector

### `type`

`type` is slightly different because `--text` means “text to enter”, not “textEquals selector”. For element targeting, `type` uses:

- `--id`
- `--desc`
- `--desc-contains`
- `--role`
- `--text-contains`
- `--selector`

Example:

```bash
androperator type "hello world" --role textfield
```

### `read-value`

`read-value` does not use the general selector parser. It builds `labelMatcher` from three dedicated flags:

| CLI flag | `labelMatcher` field |
| --- | --- |
| `--label` | `textEquals` |
| `--label-id` | `resourceId` |
| `--label-desc` | `contentDescEquals` |

Accepted CLI aliases for those `read-value` label flags:

- `--text` and `--label-text` -> `--label`
- `--id` and `--resource-id` -> `--label-id`
- `--desc` and `--content-desc` -> `--label-desc`

At least one of those flags is required.

Blank label values are rejected, and if you provide none of the three label flags the command returns a usage error before execution is built.

Raw JSON aliases for `read_key_value_pair.params.labelMatcher` follow the same `NodeMatcher` alias table shown above. Raw payload aliases `label_matcher` and `label_selector` are normalized to `labelMatcher` before validation.

Concrete execution fragment:

```json
{
  "id": "read-value-1",
  "type": "read_key_value_pair",
  "params": {
    "labelMatcher": {
      "textEquals": "Battery"
    }
  }
}
```

## Container Matching Semantics

Container selectors narrow an action to a matched ancestor or scrollable region instead of searching the full screen.

Current uses:

- `read` attaches the matcher as `params.container`
- `scroll` attaches the matcher as `params.container`
- `scroll_until` attaches the matcher as `params.container`
- `scroll_and_click` attaches the matcher as `params.container`

If no container selector is provided:

- `read_text` searches without container scoping
- scroll actions let Android choose the relevant on-screen scrollable container

Example:

```bash
androperator scroll-until --text "About phone" --container-id "android:id/list"
```

becomes:

```json
{
  "type": "scroll_until",
  "params": {
    "matcher": { "textEquals": "About phone" },
    "container": { "resourceId": "android:id/list" }
  }
}
```

## JSON Examples

Exact text:

```json
{ "textEquals": "Wi-Fi" }
```

Partial text plus role:

```json
{ "textContains": "Sign", "role": "button" }
```

Raw container selector:

```json
{ "resourceId": "android:id/list" }
```

Navigation target:

```json
{
  "expectedPackage": "com.android.settings",
  "expectedNode": { "textEquals": "Settings" }
}
```

## CLI Examples

```bash
androperator click --text "Wi-Fi"
```

```bash
androperator read --selector '{"resourceId":"android:id/title"}'
```

```bash
androperator wait --text-contains "Done" --timeout 10000
```

```bash
androperator scroll-until --text "About phone" --container-id "android:id/list"
```

```bash
androperator read-value --label "Battery"
```

## Related Pages

- [Actions](actions.md)
- [Errors](errors.md)
- [API Overview](overview.md)
