# Operator Automation Playbook

This is a secondary background document for Androperator runtime conventions.

If you are starting cold, begin with the operational docs first:

- `docs/setup.md`
- `docs/api/overview.md`
- `docs/skills/overview.md`

Use this playbook after that, when you need deeper context for:
- running the app through `ACTION_AGENT_COMMAND`
- authoring agent instructions and optional helpers
- integrating those helpers with agent hosts
- understanding runtime components and naming

---

## 1) Runtime components (production)

These are runtime components (not debug-only):

- `com.androperator.operator.runtime.OperatorCommandService`
- `com.androperator.operator.runtime.OperatorCommandReceiver`

They own broadcast ingress for:
- **Action Namespace:** `com.androperator.operator.ACTION_AGENT_COMMAND` (stable)
- **Package Target:** Varies by build (e.g., `com.androperator.operator` or `com.androperator.operator.dev`)

---

## 2) Command ingress contract

### Observe before acting

Use the Node API/CLI for device actions. Capture current evidence and choose the
next bounded action in the agent. Reset the app with `close_app` then `open_app`
only when the task needs a fresh session. Prefer observable readiness checks to
fixed delays, and verify the effect after navigation or mutation.

### Required fields
- `commandId: string`
- `taskId: string`
- `source: string`
- **`expectedFormat: "android-ui-automator"`** (required execution format)
- `actions: []`

### Determinism Doctrine
1. **Validation First:** No side effects if the payload is malformed.
2. **Exactly One Envelope:** Every command must emit a `[Androperator-Result]`.
3. **Bounded Execution:** Actions may use their documented retry policies. App-specific recovery and replanning belong to the agent.
4. **Stable IDs:** Correlate `commandId` and `taskId` end-to-end.

---

### Supported action types (current)

| Action type | Key params | Notes |
| :--- | :--- | :--- |
| `open_app` | `applicationId: string` | Launches app by package ID |
| `close_app` | `applicationId: string` | Node runs `adb shell am force-stop` pre-flight, normalizes the step result only when that close succeeds, and otherwise returns a structured execution failure |
| `enter_text` | `matcher: NodeMatcher`, `text: string`, `submit?: boolean`, `clear?: boolean` | CLI: `type` (synonym: `fill`). Android keeps the public action stable and chooses the text-entry route internally. It prefers `ACTION_SET_TEXT` when available, falls back to the API 33 accessibility input-connection path for custom editors when needed, preserves replace-style behavior on both routes, and treats `submit` as best-effort rather than a new hard-failure condition. |
| `click` | `matcher: NodeMatcher`, `clickType?: "default"\|"long_click"\|"focus"` | CLI: `click` (synonym: `tap`) |
| `swipe` | `start: {x, y}`, `end: {x, y}`, `durationMs: integer 1..10000` (all required) | CLI: `swipe --start <x> <y> --end <x> <y> --duration-ms <ms>`. Straight-line movement and release; no hold or automatic retry. Completion does not verify the app effect |
| `drag` | `start: {x, y}`, `end: {x, y}`, `holdDurationMs` and `moveDurationMs`: integers 1..10000 (all required) | CLI: `drag --start <x> <y> --end <x> <y> --hold-duration-ms <ms> --move-duration-ms <ms>`. API 26+. Start inside the source item; verify the resulting placement with a fresh snapshot. See [drag contract](../../api/actions.md#action-drag) |
| `read_text` | `matcher: NodeMatcher`, `validator?: "temperature"`, `retry?: object` | CLI: `read`. Result in `data.text`. Other validator values are rejected by the runtime |
| `wait_for_node` | `matcher: NodeMatcher`, `retry?: object` | CLI: `wait`. Waits with internal retry |
| `snapshot` | `retry?: object` | CLI: `snapshot`. Snapshot content in `data.text` as `hierarchy_xml`, plus best-effort `foreground_package` / `has_overlay` metadata |
| `take_screenshot` | `path?: string`, `retry?: object` | Node captures screenshot via ADB and returns local file path |
| `scroll_and_click` | `target: NodeMatcher`, `container?: NodeMatcher`, `direction?`, `maxSwipes?`, `distanceRatio?`, `settleDelayMs?`, `findFirstScrollableChild?`, `clickAfter?: boolean`, `scrollRetry?: object`, `clickRetry?: object` | Scrolls until target is visible, then clicks by default. Set `clickAfter: false` to reveal the target without tapping it. `scrollRetry` defaults to UiScroll; `clickRetry` defaults to UiReadiness |
| `scroll` | `container?: NodeMatcher`, `direction?`, `distanceRatio?`, `settleDelayMs?`, `findFirstScrollableChild?`, `retry?: object` | Performs exactly one scroll gesture and reports `scroll_outcome` as `moved`, `no_movement`, `unknown`, `container_lost`, or `gesture_failed` |
| `scroll_until` | `target?: NodeMatcher`, `container?: NodeMatcher`, `clickType?: "default"\|"long_click"\|"focus"`, `clickAfter?: boolean`, `direction?`, `distanceRatio?`, `settleDelayMs?`, `maxScrolls?`, `maxDurationMs?`, `noPositionChangeThreshold?`, `findFirstScrollableChild?` | Bounded scroll loop that returns `termination_reason`. With `target`, the runtime emits `TARGET_FOUND` when the matcher becomes visible in the on-screen filtered tree. Set `clickAfter: true` to click immediately once visible. Missing or unchanged progress counts toward `NO_POSITION_CHANGE`; disappearing containers report `CONTAINER_LOST`. Without `target`, use it for feed pagination with explicit caps |
| `sleep` | `durationMs: number` | Pause between steps. Must fit within the execution `timeoutMs` budget |

**`enter_text` vs CLI `type`:** The CLI command is `type` (synonym: `fill`) but the action type field in execution payloads is `enter_text`. These map to the same runtime action. When building execution payloads directly, always use `enter_text`.

**Android `enter_text` runtime notes:**

- Strategy order is fixed: legacy `ACTION_SET_TEXT` first, API 33
  input-connection fallback second.
- On the legacy route, `submit=true` prefers `ACTION_IME_ENTER` when the node
  exposes it and falls back to a click only as best effort.
- On the API 33 route, submit uses the editor-action path through the input
  connection when one is available.
- API 33 replace behavior is not append-at-cursor behavior. The runtime moves
  the cursor to the end, uses `deleteSurroundingText(Int.MAX_VALUE, 0)`, then
  `commitText(...)` to replace the field contents.
- Debug-build runtime diagnostics for live validation now include
  `enter_text strategy=<strategy_name> submit_method=<submit_method>` on
  success and `enter_text strategy=api33_input_connection unavailable
  reason=<reason>` when the API 33 path cannot run.
- If the API 33 delete-then-commit replace fallback clears the field but
  `commitText(...)` fails, the runtime emits a warning-level
  `enter_text strategy=api33_input_connection partial_failure reason=commit_failed_after_delete`
  diagnostic so the destructive edge is visible in logcat without logging the
  field contents.

**NodeMatcher fields:** `resourceId`, `contentDescEquals`, `textEquals`, `textContains`, `contentDescContains`, `role`. All fields are AND-combined. Prefer `resourceId` when available. Full reference in `docs/api/selectors.md`.

**Scroll targeting rule:** If a screen contains nested or multiple scrollable containers, do not rely on auto-detect. Capture `snapshot`, identify the intended list's `resource-id`, and pass it as `params.container`.

### Visual verification with ADB screenshots (recommended)
Use screenshots alongside UI-tree logs when building/debugging skills.

```bash
adb exec-out screencap -p > ./tmp/ui-check.png
```

---

## 3) Agent instructions and optional helpers

Skills are instructions followed by the current agent. The host owns their
discovery and invocation; Androperator has no runtime skill registry, package
schema, compiler, or runner. Bundled examples live in `examples/skills/`.

Optional executable helpers may invoke the CLI or Node API for bounded work.
They use ordinary process inputs, outputs, and exit status. Keep app-specific
strategy in the instructions and verify current screen evidence; a recorded
sequence is not a reliable plan for every future run.

Authoring checklist:

1. Capture a snapshot and screenshot from the target app.
2. Identify stable selectors and document expected outcomes and recovery cues.
3. Write host-native instructions with placeholders for private values.
4. Add a helper only when it makes a concrete repeated operation simpler.
5. Validate the intended result on a device, not just the process exit code.

Recording is optional demonstration evidence. It does not require every user to
record a flow or produce a replay package. See [skill authoring](../../skills/authoring.md)
and [skill design](skill-design.md) for the current conventions.
