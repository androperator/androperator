# Runtime skills removal validation

Date: 4 October 2026. Implementation commit: `f8953719` on
`audit/skills-architecture`. Scope follows the
[authoritative plan](skills-runtime-removal-plan.md).

## Result

Removed the complete runtime skills CLI namespace, three skills HTTP routes,
registry and package contracts, scaffolding, compilation, validation, runner,
child-agent orchestration and result machinery. Installation no longer creates
an empty runtime registry; doctor no longer requires a runtime registry or
child-agent CLI. Runtime-only evals, smoke checks, fixtures and documentation
were removed or updated. Unknown commands and routes use ordinary errors.

Retained Android execution, strict action validation, readiness checks,
snapshots, screenshots, MCP, unrelated HTTP operations and the
`[Androperator-Result]` envelope with command/task correlation. Bundled host
instructions installation retains its existing safe handling of installed
content. Shared helper run identifiers and logging remain because ordinary
example helpers use them. No replacement manifest, runner, migration tooling,
compatibility adapter or deprecation lifecycle was introduced.

Current guidance describes instructions followed by the current agent, optional
ordinary helpers and optional human demonstration as evidence. Recording start,
stop, pull, parse and evidence export remain. `recording compare` was removed:
its concrete consumers were retired runtime-wrapper and Solax replay checks.
There was no retained consumer justifying a new comparison contract.

## Host validation

All checks passed after repairing removal-related regressions:

- Node build followed by the complete Node suite: 1,427 tests passed.
- Retained eval harness suite: 63 tests passed, using a writable temporary UV cache.
- Ordinary example/helper suite: 18 tests passed.
- Docs generator suite: 18 tests passed.
- Installer validation passed. Its duplicate Node run was skipped because the
  complete Node suite ran separately.
- Canonical docs build passed: 38 navigation pages, 396 generated-doc links and
  24 machine-facing routes checked.
- Both landing site builds passed; the new landing suite passed all seven tests.
  The preserved landing build now refreshes its full-text docs from canonical
  generated docs.
- Final diff whitespace check passed. Repository commit hooks remained enabled.

## Live retained behavior

The branch-local CLI targeted explicit emulators with the development Operator
package. Existing matching APKs passed readiness/handshake checks; no Android
source changed. The current agent followed the retained Settings instructions
and ordinary helper on a phone emulator. Current UI and independent read
commands verified Android version `15` and build `AE3A.240806.036`, and the helper
saved the successful evidence receipt.

The same workflow on an Android TV emulator truthfully returned `ACTION_FAILED`
because `com.android.settings` was unavailable. The envelope retained the
requested command/task identifiers. A stale helper capture was rejected before
acting; the agent refreshed evidence and continued. These failures were not
normalized into success.

The direct canonical integration check verified snapshot execution and
command/task correlation. Recording start, a navigation action, stop, pull,
parse and export succeeded on the phone emulator. The resulting recording had
one window-change event and included XML snapshot evidence. Local recordings,
receipts, screenshots and logs were preserved outside Git. The phone emulator
started for validation was returned to its prior stopped state.

## Limits

These runs establish the observed emulator workflows, not broad live reliability.
No physical device, OEM Settings variant, optional Jev/provider workflow or
model-driven live eval was validated. The recording check does not establish
human-input event diversity or coverage beyond the observed window-change event.
Host tests do not substitute for those missing live checks. No historical
repository or installed local skill content was modified. No push, publication
or pull request was performed.

## Review follow-up

A fresh read-only review inspected the full `627e128f..00e5f944` branch diff.
It found two remaining removal gaps: the public `artifact_compiled` mode and
active internal guidance prescribing the retired catalog, package structure,
and runner logging contracts. Both were corrected in the review follow-up.
Execution accepts an omitted mode or `direct`; unsupported modes return
`EXECUTION_VALIDATION_FAILED`. No compatibility adapter or migration is needed
because the project has no users or compatibility obligations.

Independent validation first passed all 1,427 existing Node tests. After the
fixes, the Node build and all 1,428 tests passed, including the new mode-contract
regression test. The canonical docs pipeline and preserved landing build passed:
38 navigation pages, 396 generated-doc links and 24 machine-facing routes were
checked. Generated full-text documentation was refreshed. Documentation
organization checks emitted no warnings; dependency tooling emitted only pip
cache and future MkDocs compatibility notices.

This follow-up changed host validation and guidance, not Android behavior, so
live-device validation was not repeated. The original live-validation limits
above still apply. The fixes were validated by the implementing reviewer but
have not received another independent review pass.
