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

- `androperator.operator.runtime.OperatorCommandService`
- `androperator.operator.runtime.OperatorCommandReceiver`

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

### Execution and result contracts

Use [execution inputs and result envelopes](../../api/overview.md),
[action parameters](../../api/actions.md) and [selectors](../../api/selectors.md)
as the current contract. The Node boundary validates before dispatch. Correlate
command/task IDs, preserve failed steps and transport uncertainty, and distinguish
host preflight effects from requested actions. Android aims to emit one terminal
envelope; transport loss is not proof that no action executed.

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
