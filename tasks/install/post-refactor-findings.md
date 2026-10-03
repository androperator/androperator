# Install Compaction Final Review Findings

Review date: 2026-04-24

Reviewed range: `0c3ce93b9cac5d48635677f77f50b431d4231eca^..1f1943b75dda84273be4707f2b65d7ba2a6b7a98`.

## Scope Reviewed

This review focused on whether the install compaction work actually moved
post-bootstrap install ownership out of
`sites/androperator-public/install.sh` and into the Node CLI, while keeping
installer reliability and validation coverage intact.

Surfaces inspected:

- `sites/androperator-public/install.sh`
- `validation/install/`
- `apps/node/src/cli/commands/install.ts`
- `apps/node/src/cli/commands/operatorRemediate.ts`
- `apps/node/src/domain/host/hostSetup.ts`
- `apps/node/src/cli/registry.ts`
- `apps/node/src/test/unit/*install*`
- `apps/node/bundled-skills/androperator-upgrade/`
- authored docs changed under `docs/`
- task pack files under `tasks/install/compact/`

Validation run during review:

```bash
./validation/install/test_install.sh
```

Result: passed. This included the Node build, full Node test suite, and the
reduced install shell harnesses.

Live validation after release:

```bash
npm install -g androperator@latest
androperator install
androperator doctor --json
androperator doctor --json --device <physical_device>
androperator doctor --json --device emulator-5554
npm uninstall -g androperator
curl -fsSL https://androperator.com/install.sh | bash
androperator doctor --json
androperator doctor --json --device <physical_device>
androperator doctor --json --device emulator-5554
```

Result: passed. The global bundled `androperator-upgrade` route upgraded a
`0.7.3` host to `0.7.4`, remediated both connected release-package Operator
APKs to `0.7.4`, refreshed bundled skills, and left both devices doctor-ready.
After global uninstall, the live public `install.sh` installed `0.7.4`,
delegated to `androperator install`, preserved existing `~/.androperator` state,
and left both devices doctor-ready. Both phases produced the expected
multi-device warning that future device commands must pass `--device`.

## Work Done Well

The main ownership migration succeeded. `install.sh` no longer parses
post-bootstrap JSON, tracks parallel device arrays, or owns the final install
summary tree. Its post-bootstrap role is now a narrow delegation to:

```bash
androperator install --output pretty --operator-package "$DEFAULT_OPERATOR_PACKAGE"
```

The installer is materially slimmer. The current shell script is 526 lines,
which is below the task pack target of 700 lines and far below the previous
shell middleware shape. The remaining shell is mostly bootstrap work that the
task explicitly kept in scope for the wrapper: OS detection, Java, Node, curl,
adb, git, npm global CLI install, and shell activation hints.

The Node CLI now has a real top-level `androperator install` command. It owns the
post-bootstrap sequence across operator remediation, runtime skills install,
bundled-skills install, and host setup. It also owns installer-facing status,
summary, warning, and follow-up messaging. That is the right boundary for this
project: shell bootstraps the CLI, then the CLI owns Androperator behavior.

The old dead shell path for direct operator APK download was removed from the
installer flow and from shell validation. Detailed behavior now has Node-owned
tests in `operatorDownload.test.ts`, `operatorRemediate.test.ts`,
`hostSetup.test.ts`, and `installCommand.test.ts`.

The shared-agent-bridge warning policy is now Node-owned. `hostSetup.ts`
classifies shared bridge write failures as a warning when all core host
artifacts succeed, and `cmdInstall` preserves that as a non-fatal install
warning. This removes a duplicated bash policy branch and keeps the CLI as the
source of truth.

The reduced shell validation is pointed at the right shell-owned behavior:
fresh npm binary resolution, wrapper delegation to `androperator install`,
operator package env normalization, bootstrap gate behavior, delegated failure
propagation, and stdin entrypoint safety. The validation shrink was not just
line deletion.

Docs and host-agent guidance are broadly aligned with the new route. `docs/setup.md`,
`docs/host-agents.md`, `docs/skills/authoring.md`, CLI help text, generated
LLM surfaces, and `androperator-upgrade` now consistently describe
`androperator install` as the canonical post-bootstrap path and keep
`install.sh` as bootstrap or recovery.

The `androperator-upgrade` bundled skill now explicitly handles multi-device
verification. When `androperator install` reports `deviceSelectionRequired` or
top-level doctor reports `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`, the skill tells
agents to run per-device doctor checks before claiming the host is ready.

## Gaps And Residual Risks

No blocking defect was found in the final review, the install validation suite
passed, and the follow-up live validation passed. The remaining gaps are not
release blockers, but they are still useful tightening work.

### 1. `apkVersion` remains unthreaded through the canonical install path

The compact task recommendations already called out that the old dead
`download_operator_apk_via_cli` path was the only place shell ever learned an
operator version. The current Node-owned `androperator install` path still calls
`setupHost` without an `apkVersion`, so `install-state.json` keeps
`apkVersion: null` after normal install.

Docs accurately avoid over-promising this field, so this is not a correctness
blocker. It is still a useful follow-up because install-state diagnostics would
be stronger if `operator remediate` exposed the downloaded or verified operator
version and `cmdInstall` passed it into host setup.

### 2. The install validation runner is broad and may become expensive

`validation/install/test_install.sh` builds `apps/node` and runs the full Node
test suite before the install shell harnesses. This is safe and currently
passes, but it is broader than install-specific validation. If the Node test
suite grows substantially, consider adding a stable install-focused npm test
slice while keeping full `npm --prefix apps/node run test` in CI or pre-release
validation.

## Recommendations

1. Keep the current ownership split. Do not move Java, Node, adb, git, curl, or
   npm bootstrap into the Node CLI unless the project later ships a
   self-contained launcher that can run before Node is installed.

2. Add a follow-up task to thread operator version into install state. The
   likely shape is to extend `operator remediate` with the effective downloaded
   or verified APK version, then pass that through `cmdInstall` to `setupHost`.

3. Keep an install-focused Node test slice in mind if the full Node suite
   becomes too expensive for installer-only validation. The current full-suite
   runner is acceptable while it remains fast enough.

## Bottom Line

The install compaction work achieved the intended architecture. The shell is
now a bootstrap wrapper, `androperator install` is the canonical post-bootstrap
surface, and the detailed behavior moved to Node with meaningful tests. The
released `0.7.4` public install and upgrade paths both passed live validation.

The remaining work is not another large refactor. It is a short follow-up pass:
improve install-state version metadata and consider a stable install-focused
Node test slice if the full Node suite becomes too expensive for installer-only
validation.
