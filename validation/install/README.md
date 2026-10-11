# Install Validation

This directory contains the install-specific validation harnesses for the
shell bootstrap wrapper in `sites/androperator-public/install.sh`.

## Entry Point

Run the full installer regression suite from the repo root with:

```bash
./validation/install/test_install.sh
```

This is the expected validation command for changes to `install.sh`.

Prerequisite for local runs:

```bash
npm --prefix apps/node ci
```

The suite builds and tests `apps/node`, but it does not install Node
dependencies for you.

## Harnesses

- `test_install.sh`
  - suite runner for the install-specific tests
  - builds the Node package, runs the install-related Node tests, then runs the
    shell harnesses in this directory plus `validation/test_doctor.sh`
- `test_java.sh`
  - covers `check_java()` detection and provisioning branches
- `test_cli_bootstrap.sh`
  - covers shell-owned `install_cli()` npm-prefix resolution and freshly
    installed CLI binary selection
- `test_main_delegation.sh`
  - covers hermetic `main()` smoke paths for bootstrap gating, delegation to
    `androperator install`, and top-level exit-code/message propagation

## Maintenance Rule

When a change adds or changes behavior in `sites/androperator-public/install.sh`,
update or add the matching coverage here in the same change. Do not rely on the
existing harnesses as generic coverage for new install branches.

Common examples:

- new bootstrap prerequisite branch
  - extend `test_java.sh` or `test_main_delegation.sh`
- new install delegation behavior or passthrough messaging
  - extend `test_main_delegation.sh`
- changes to bootstrap-time CLI resolution
  - extend `test_cli_bootstrap.sh`
- new `main()` branch or shell-owned summary outcome
  - extend `test_main_delegation.sh`
- installer RC or environment cleanup
  - add a shell harness case that proves the old shell-side mutation is gone

Keep install-specific validation in `validation/install/` and wire any new
harness into `test_install.sh` so the suite remains the single obvious
entrypoint.

## Fresh Operator service readiness

`operator setup` verifies a live, non-waking `doctor_ping` after package and
permission checks. Package presence or successful settings writes alone are not
readiness evidence. Android can remove a newly written accessibility grant
while processing a fresh install. Setup retries only an unavailable-service
response, up to two times, by re-reading and restoring the selected service's
grant. Transport and malformed-response failures stop verification; other
services are preserved. The existing Android doctor ping may dismiss an open
notification shade on Android 12+; setup does not promise to preserve that overlay. Failed probes remain in
`verification.readiness.attempts`.

The focused regression cases are in `apps/node/src/test/unit/operatorSetup.test.ts`.
They cover lost grants, bounded failure, transport failure, failed repair,
selected package routing, and a locked phone whose service still responds.
Interactive readiness remains a separate doctor check.

Live validation on 2026-10-11 used a minified release APK built from `9d175ded`,
package `com.androperator.operator`, with the branch-local CLI. Two fresh installs
on a physical API 37 Pixel and three on an API 35 phone emulator each passed
setup, immediate doctor, compact snapshot and default screenshot. Each emulator
trial recorded an unavailable service followed by successful automatic repair;
no manual re-grant or app launch was needed. Actual PNGs were inspected.
An additional physical install was blocked by a Play Protect security-check
prompt and returned `OPERATOR_INSTALL_FAILED` at the existing install timeout,
before permission verification. That failed attempt is not counted as a pass.
This is finite evidence for these builds, not a universal install guarantee.
Automotive capture failures and release preparation are separate work.
