# Observation and targeting

Use the selected CLI invocation in these examples, replacing all placeholders:

```bash
androperator snapshot --device <device_serial> --operator-package <operator_package> --compact --max-nodes 200 --max-text-chars 1024 --raw-path <new_xml_path>
androperator read-value --label "<observed_label>" --device <device_serial> --operator-package <operator_package>
androperator screenshot --path <image_path> --device <device_serial> --operator-package <operator_package>
```

The raw-path parent must exist and the file must not exist. Retain the response
as well as XML. Inspect envelope and individual step success, compact counts,
`truncated`, field truncation and parent links. Missing text in an incomplete
source or filtered projection is not absence. Inspect retained raw evidence,
narrow the selection or acquire a bounded richer observation. A complete tree
still does not cover every screen, window or visible pixel.

Keep capture/task IDs, selected device/Operator, receipt time and source path.
Node paths and candidate IDs belong to one capture; neither is a native selector.
Use supported current selectors, checking uniqueness against all source nodes,
including hidden and description-only matches. Check enabled/visible state,
clickable ancestry, bounds and known viewport intersection. Unknown facts remain
unknown. See [selectors](https://docs.androperator.com/api/selectors/) and the
[context adapter](https://docs.androperator.com/skills/context-adapter/).

- Offscreen About row: identify the observed scrollable list, scroll within the
  budget, then refresh and match. Do not click an old offscreen position.
- Moved button: expire its previous candidate after navigation, scrolling or an
  interruption. Match again and verify its destination after clicking.
- Duplicate labels: inspect the containing rows and use a supported disambiguating
  selector. Do not choose the first match or turn a node path into a selector.
- Nested label/value: follow explicit parent relationships to the smallest
  supported row. A title wrapper may sit beside the summary within that row;
  adjacent unrelated text is not its value. Verify extracted values with a
  successful independent read. Keep Android OS version and build number separate.
- Popup: observe its meaning and controls before any dismissal. A known harmless
  navigation dismissal may be appropriate; arbitrary acceptance, login, payment
  or permission consent is not recovery authorization.

Request a screenshot for a stated unresolved question, such as whether a popup
covers the target or which visual heading identifies the destination. Preserve
image path, device, capture/receipt time and its relation to the tree; separately
acquired images and trees are not atomic. Label image-derived facts explicitly.
Map proposed actions back to supported current targets. Image interpretation does
not invent accessibility selectors. Overlay metadata, geometry and platform
visibility do not guarantee lack of occlusion. Verify the resulting screen.

Screenshots add acquisition and interpretation cost. Smaller model input and
selective screenshots do not establish a speedup or general OEM reliability.
