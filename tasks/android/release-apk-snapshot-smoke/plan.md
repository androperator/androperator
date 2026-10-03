# Release APK Snapshot Smoke Task

Created: 2026-04-28
Status: deferred follow-up

## Purpose

Add release-APK validation that proves `snapshot_ui` works under the minified
release Operator package, not only under the debug `.dev` package.

This task was split out from `tasks/android/release-obfuscation` after the Node
runtime fix made legacy untagged snapshot logs fail clearly as
`VERSION_INCOMPATIBLE`.

## Background

The original failure was a release-only snapshot extraction bug:

- the Android release Operator emitted hierarchy logs under an obfuscated log tag
- the debug Operator emitted the same logs under `TaskScopeDefault`
- old Node code depended on the class/log tag instead of a stable message marker

The current runtime direction is correct:

- Android emits `[TaskScope] UI Hierarchy [commandId=<command_id>]:`
- Node extracts only command-id-tagged snapshot blocks
- legacy untagged markers are diagnostic evidence for `VERSION_INCOMPATIBLE`,
  not a compatibility path

## Scope

Implement a validation path that installs or targets the release Operator
package and runs a real `snapshot_ui` smoke.

Acceptance criteria:

- The smoke targets `com.androperator.operator`, not only
  `com.androperator.operator.dev`.
- The smoke verifies `envelope.status == "success"`.
- The smoke verifies the snapshot step has `success == true`.
- The smoke verifies `stepResults[0].data.text` is present.
- The validation fails if release minification or log tag changes prevent Node
  from extracting snapshot XML.

## Candidate Implementation

Start with the existing smoke or validation scripts and add a release-variant
path rather than hand-writing a one-off script.

Likely files to inspect:

- `scripts/androperator_smoke_core.sh`
- `scripts/androperator_integration_canonical.sh`
- `scripts/androperator_validate_operator_ingress.sh`
- `apps/node/src/domain/doctor/checks/readinessChecks.ts`
- `apps/android/app/app.gradle.kts`

## Validation

At minimum:

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
```

If the change touches docs:

```bash
./scripts/docs_build.sh
```

If the release APK smoke is wired into local validation, run it against a
physical device or emulator with the release Operator package installed.

