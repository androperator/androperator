# Quickstart

## Before You Start

This page assumes a working Androperator installation: CLI installed, device
connected, Operator APK installed, and interactive doctor exiting zero with
`criticalOk: true` and `readiness.device.interactive.status: "pass"`. For
background-only work, choose the [capability-specific gate](host-agents.md#choose-readiness).

If you have not reached that state yet, complete [Setup](setup.md) first.

If you are choosing between runtime-skill discovery, MCP, and direct CLI
automation after install, read [Host Agent Orientation](host-agents.md) first.
This page starts after that choice and focuses on direct observe / decide / act
execution.

---

## The Automation Loop

Androperator is a deterministic actuator. The agent reasons and decides; Androperator
executes and returns structured data. Every automation follows the same three-step
loop:

```
Observe  ->  Decide  ->  Act
```

1. **Observe** - take a UI snapshot to read the current device state
2. **Decide** - parse the XML hierarchy to find the right node to target
3. **Act** - use a flat CLI command for one action, or `exec` for an explicit batch; inspect the result and observe the effect

Repeat until the requested outcome is verified, or report a bounded partial/blocked outcome with retained evidence. After uncertain dispatch, inspect state before repeating any mutation.

**Targeting rule:** do not guess selectors. If the next action needs a target,
take a fresh `snapshot`, derive the selector from the current hierarchy, and
then act. A guessed label failing is not an Androperator bug - it means the
target was not proven from the current screen state.

---

## Choose the smallest useful call

For a ready interactive target, use flat commands for single actions:

```bash
androperator open com.android.settings --device <device_serial>
androperator snapshot --device <device_serial>
# Only after observing a unique current target:
androperator click --text "About phone" --strict --device <device_serial>
androperator snapshot --device <device_serial>
```

Labels and layout vary by device. Substitute selectors from current evidence.
`open` already waits for its package to be foreground; it does not prove content
readiness. After a same-package click, observe the destination; if content is
still loading, use `wait --text <observed_destination_label> --timeout 5000` and
observe again. A label already present before the action proves no transition.
Do not add a package-only `wait-for-nav` after a completed launch or in-app click.
See [navigation semantics](api/navigation.md#wait-for-navigation).

| Need | Observation | Limit |
| --- | --- | --- |
| Discover the screen | `snapshot` | Raw XML can be large |
| Bound returned context | `snapshot --compact --max-nodes 100` | A preorder prefix; inspect truncation, never infer absence from omitted nodes |
| Inspect matches/state | `query --text <label>` | One capture; paths are not persistent action handles |
| Read exact text | `read --text <label>` or `read-value --label <label>` | Verify selection and label/value association |
| Inspect pixels | `screenshot --path <new_file>` | Open the 25%-per-dimension image; use `--scale 100` for fine detail. Capture success alone proves no application outcome |

Use [Snapshot](api/snapshot.md) for compact/raw artifacts and
[Actions](api/actions.md) for query/read output serialization. Keep the raw
hierarchy when needed for recovery. The examples below retain raw XML and a
batch payload for callers that need them.

## Step 1: Observe

The canonical observation action is `snapshot`. Run it with the built-in
`snapshot` command:

```bash
androperator snapshot --device <device_serial>
```

On success, the result envelope contains the XML hierarchy in
`envelope.stepResults[0].data.text`.

Success conditions to check before proceeding:

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ]
  }
}
```

**Branch rule:** only proceed when `envelope.status == "success"` and
`stepResults[0].success == true`. If `data.text` is missing, Node converts the
step to `SNAPSHOT_EXTRACTION_FAILED`. See [Snapshot Format](api/snapshot.md)
for recovery.

---

## Step 2: Decide

Parse the XML to find the node you want to act on. The key attributes for
targeting are:

| Attribute | Use for |
| --- | --- |
| `text` | Matching visible label text |
| `resource-id` | Stable structural identifiers like `android:id/title` |
| `content-desc` | Accessibility labels when text is empty |
| `clickable` | Native action capability; click can resolve an enabled clickable ancestor or fall back to a gesture at node bounds. Verify the effect. |
| `scrollable` | Identifies containers to target for scroll actions |
| `bounds` | Screen coordinates in `[x1,y1][x2,y2]` form |

For example, in a Settings hierarchy the "Connections" row appears as:

```xml
<!-- The row container: clickable="true", no resource-id -->
<node
  text=""
  resource-id=""
  class="android.widget.LinearLayout"
  clickable="true"
  enabled="true"
  bounds="[30,1290][1050,1499]">

  <!-- Title: clickable="false", resource-id="android:id/title" -->
  <node
    text="Connections"
    resource-id="android:id/title"
    class="android.widget.TextView"
    clickable="false"
    bounds="[216,1332][507,1402]" />

  <!-- Summary: shows current sub-settings -->
  <node
    text="Wi-Fi  •  Bluetooth  •  SIM manager"
    resource-id="android:id/summary"
    class="android.widget.TextView"
    clickable="false"
    bounds="[216,1402][816,1457]" />
</node>
```

To tap this row, target the child title text. Androperator will resolve the
nearest `clickable` ancestor if the matched node is not itself clickable.

Selector to use:

```json
{
  "textEquals": "Connections",
  "resourceId": "android:id/title"
}
```

See [Selectors](api/selectors.md) for the full `NodeMatcher` contract.

---

## Step 3: Act

Send an execution payload via `androperator exec`. The payload lists one
or more actions in sequence. Androperator dispatches them in order and returns a
single result envelope.

Example - click the "Connections" row, then observe the destination:

```json
{
  "commandId": "nav-to-connections",
  "taskId": "nav-to-connections",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 15000,
  "actions": [
    {
      "id": "click-1",
      "type": "click",
      "params": {
        "matcher": {
          "textEquals": "Connections",
          "resourceId": "android:id/title"
        }
      }
    },
    {
      "id": "snap-2",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

Save this as `payload.json` and run:

```bash
androperator exec --device <device_serial> payload.json
```

Success conditions:

- `envelope.status == "success"`
- `envelope.stepResults` has two entries, all with `success: true`
- `envelope.stepResults[1].data.text` contains the Connections screen hierarchy

**Branch rule:** if any step fails, the envelope still returns but the failed
step has `success: false`. Check `envelope.stepResults[i].success` individually,
not just the top-level status. See [Errors](api/errors.md) for recovery by code.

---

## Putting It Together

An example route for reading the Android version. Confirm the current labels and
container IDs before using these payloads; Settings layouts vary. If the final
row is not yet visible, observe/scroll the current container instead of assuming
this route completed the task:

### 1. Pre-flight

```bash
androperator doctor --device <device_serial>
# Require exit 0, criticalOk: true, and readiness.device.interactive.status: "pass"
```

### 2. Open Settings and observe

```json
{
  "commandId": "open-settings",
  "taskId": "open-settings",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 20000,
  "actions": [
    {
      "id": "open-1",
      "type": "open_app",
      "params": {
        "applicationId": "com.android.settings"
      }
    },
    {
      "id": "snap-1",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

### 3. Read snapshot, find "About phone"

Parse `stepResults[1].data.text`. Search for a node with
`resource-id="android:id/title"` and `text="About phone"`. If it is not
visible, scroll down the `recycler_view` and take another snapshot.

Scroll payload (use when the target row is below the visible area):

```json
{
  "commandId": "scroll-settings",
  "taskId": "scroll-settings",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 10000,
  "actions": [
    {
      "id": "scroll-1",
      "type": "scroll",
      "params": {
        "direction": "down",
        "container": {
          "resourceId": "com.android.settings:id/recycler_view"
        }
      }
    },
    {
      "id": "snap-2",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

### 4. Navigate and read the value

Once "About phone" is visible, click it and snapshot the next screen to find
the "Android version" row:

```json
{
  "commandId": "read-android-version",
  "taskId": "read-android-version",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 20000,
  "actions": [
    {
      "id": "click-about",
      "type": "click",
      "params": {
        "matcher": {
          "textEquals": "About phone",
          "resourceId": "android:id/title"
        }
      }
    },
    {
      "id": "snap-3",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

Parse `stepResults[1].data.text` for the "Android version" row. The value
appears as the `text` attribute of the summary node adjacent to an `android:id/title`
node with `text="Android version"`.

---

## What to Read Next

| Topic | Page |
| --- | --- |
| All action types and parameters | [Actions](api/actions.md) |
| Selector syntax for node matching | [Selectors](api/selectors.md) |
| Snapshot XML format and annotated example | [Snapshot Format](api/snapshot.md) |
| Full result envelope contract | [API Overview](api/overview.md) |
| Error codes and recovery steps | [Errors](api/errors.md) |
| Scrolling and multi-step navigation patterns | [Navigation Patterns](api/navigation.md) |
| Environment variable controls | [Environment Variables](api/environment.md) |
