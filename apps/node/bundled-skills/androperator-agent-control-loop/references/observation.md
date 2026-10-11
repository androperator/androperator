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
unknown. See [selectors](https://docs.androperator.com/api/selectors/) for matching
and strict-selection contracts.

For label/value extraction, follow explicit parent relationships to the smallest
supported row. A title wrapper may sit beside the summary within that row;
adjacent unrelated text is not its value. Verify extracted values with a
successful independent read. Keep Android OS version and build number separate.

For offscreen or moved controls, duplicate labels, nested label/value extraction,
or consent-sensitive popups, read [worked targeting examples](targeting-examples.md)
before choosing a target or reporting a value. Use [delegation](delegation.md)
only when supplying a candidate menu to a helper or provider.

Request a screenshot for a stated unresolved question, such as whether a popup
covers the target or which visual heading identifies the destination. Preserve
image path, device, capture/receipt time and its relation to the tree; separately
acquired images and trees are not atomic. Label image-derived facts explicitly.
Map proposed actions back to supported current targets. Image interpretation does
not invent accessibility selectors. Overlay metadata, geometry and platform
visibility do not guarantee lack of occlusion. Verify the resulting screen.

Screenshots default to 25% per dimension. Open `step.data.path` from the screenshot
step with an image-reading tool; JSON success is not visual inspection. Request a
fresh `--scale 50` or `--scale 100` image when fine detail is unclear, without
replaying the prior action.
The file belongs to the capture host; remote clients need separate file access.

Step metadata uses strings. Convert image pixels to native coordinates with
`floor(imageX * nativeWidthPx / captureWidthPx)` and the corresponding height
ratio. Remove preview padding and map any preview resize to saved-image pixels
first. Verify current orientation, geometry and content before coordinate input;
prefer fresh semantic selectors. See the [screenshot contract](https://docs.androperator.com/api/actions/#action-take-screenshot)
for fields, fallback behavior and failure evidence.

Screenshots add acquisition and interpretation cost. Smaller model input and
selective screenshots do not establish a speedup or general OEM reliability.
