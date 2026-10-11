# Worked targeting examples

These examples illustrate adaptive UI decisions; labels and routes vary by app.

- Offscreen About row: identify the observed scrollable list, scroll within the
  budget, then refresh and match. Do not click an old offscreen position.
- Moved button: expire its previous candidate after navigation, scrolling or an
  interruption. Match again and verify its destination after clicking.
- Duplicate labels: inspect the containing rows and use a supported disambiguating
  selector, as illustrated below. Do not choose the first match or turn a node
  path into a selector.
- Nested label/value: in a row with a title wrapper containing `Android version`
  and a sibling summary containing `17`, the summary belongs to that row even
  though it is not a direct sibling of the title. A neighboring `Build number`
  row is a separate value. Use the relationship and independent-read checks in
  [observation guidance](observation.md).
- Popup: observe its meaning and controls before any dismissal. A known harmless
  navigation dismissal may be appropriate; arbitrary acceptance, login, payment
  or permission consent is not recovery authorization.

## Duplicate buttons within distinct rows

Suppose the current tree shows several `Open` buttons, each inside an item row.
You have observed the desired row's resource ID and a label that distinguishes
that row. Use the selected CLI invocation and replace every placeholder with
current evidence:

```bash
androperator click --text "Open" --container-json '{"resourceId":"<observed_row_id>","descendant":{"textEquals":"<observed_row_label>"}}' --strict --device <device_serial> --operator-package <operator_package>
```

The container must match exactly one row, and the button must be a strict
descendant of it. Without `--strict`, ordinary actions retain first-match
selection. Strict selection rejects duplicate targets with `NODE_AMBIGUOUS` and
missing or duplicate containers with `CONTAINER_NOT_FOUND` or
`CONTAINER_AMBIGUOUS`. Inspect the failure and refresh or refine the selector;
do not remove strictness merely to make an ambiguous action succeed. A unique
earlier query does not reserve the target for a later action. Verify the
destination after the click. See [strict selection](https://docs.androperator.com/api/selectors/#strict-action-selection)
for supported actions and matching CLI/Operator requirements.

`read-value` uses dedicated label flags and its own value resolver; it does not
support these general strict/container flags. When label selection or the value
association remains ambiguous, use a supported scoped `read` if current evidence
identifies the value node and its row, or report the unresolved association.
