# Raw CLI Discoverability Follow-up Findings

## Purpose

Track the follow-up API and CLI discoverability work that remains after the
`tasks/docs/discovery-immediate-opportunities/` pack shipped.

Durable user-facing guidance from that pack was intentionally moved into the
real product surfaces:

- `docs/quickstart.md`
- `docs/api/navigation.md`
- `docs/api/selectors.md`
- `apps/node/src/cli/registry.ts`

This file keeps only the deferred follow-up work that still needs future
product decisions or code.

## Sources

- `~/.androperator/findings/openclaw-usage-2026-04-22/findings-and-recommendations.md`
- `docs/quickstart.md`
- `docs/api/navigation.md`
- `docs/api/selectors.md`
- `apps/node/src/cli/registry.ts`

## What Shipped

The immediate-opportunity pass shipped these changes:

- `docs/quickstart.md` now explicitly tells raw-route users not to guess
  selectors and to derive them from the current snapshot
- `docs/api/navigation.md` now documents launcher and home-screen navigation as
  a special-case surface
- `docs/api/selectors.md` now includes practical selector stability guidance
- `androperator exec --help` and `androperator snapshot --help` now point
  unfamiliar hosts toward `androperator bundled-skills list` and
  `androperator-agent-orientation`

Those shipped changes should be treated as complete unless future validation
finds a concrete problem in the current behavior or wording.

## Deferred Findings

### 1. Improve `wait_for_navigation` diagnostics

Problem:

- the raw discovery run hit a case where `wait_for_navigation` returned
  `NAVIGATION_TIMEOUT`
- the result already included `last_package` showing the target app
- a follow-up `snapshot_ui` confirmed the target app was foregrounded

This leaves too much interpretation work to the caller and makes it harder for
blind agents to choose the next correct action.

Suggested scope:

- enrich the result so callers can tell:
  - final foreground package at timeout
  - whether the target package was seen during the wait window
  - whether the expected node was ever matched
  - whether an overlay, chooser, or transient window likely interfered
  - whether the failure was package mismatch, node mismatch, or readiness
    timeout

Why deferred:

- this is a runtime or contract improvement, not a docs or help-text tweak
- it needs product-shape and test decisions, not just wording cleanup

### 2. Add a canonical current-device-status surface

Problem:

- raw-CLI agents still have no single compact command that answers:
  - is the device awake
  - is it locked
  - which app is foregrounded
  - what the current screen state looks like

That makes the first safe action harder to choose, especially when the device
may be on the lock screen, home screen, or in the wrong app.

Suggested scope:

- add `androperator status --json` or an equivalent MCP tool
- return a compact structured state summary
- allow current snapshot data to be included directly or via an explicit option
- if a bundled skill is added later, keep it as a thin wrapper around the
  canonical command rather than the primary implementation

Why deferred:

- this is a new product surface, not a small docs or CLI-help refinement
- it needs command design, response-shape decisions, and regression coverage

## Notes

- If either deferred item becomes committed product behavior, migrate the
  resulting knowledge into the permanent docs or code-owned comments and then
  remove or narrow the corresponding section here.
