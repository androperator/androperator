# Live Installer Test Findings

## Scope

- Live release under test: `0.7.4`
- Starting global CLI: `/opt/homebrew/bin/androperator`, version `0.7.3`
- Existing state preserved: `~/.androperator`
- Connected devices at start:
  - `<physical_device>` - `device`
  - `emulator-5554` - `device`

## Phase 1 - Global Bundled `androperator-upgrade` Skill

Status: completed.

Plan from bundled skill:

- Check `androperator --version`.
- Check installer-owned prerequisites with `node -v` and `java -version`.
- Because the CLI is reachable and prerequisites are expected to be viable, use the CLI-first path:
  - `npm install -g androperator@latest`
  - `androperator install`
  - `androperator doctor --json`

Progress:

- `androperator --version` succeeded and returned `0.7.3`.
- `node -v` succeeded and returned `v24.14.1`.
- `java -version` succeeded and returned OpenJDK `17.0.18`.
- Decision: use the CLI-first upgrade path from the bundled skill.
- `npm install -g androperator@latest` succeeded.
- Global CLI after npm upgrade: `/opt/homebrew/bin/androperator`, version `0.7.4`.
- `androperator install` succeeded with `status: "warn"`.
- Warning reason: two connected devices are ready, so future commands must use `--device`.
- `androperator install` remediated both connected release-package devices from installed APK `0.7.3` to `0.7.4`.
- Runtime skills synced to `~/.androperator/skills`.
- Bundled skills installed under `~/.androperator/bundled-skills`; installed skill list included `androperator-upgrade`.
- Host setup completed and updated `~/.androperator/install-state.json` and `~/.androperator/mcp-config-snippet.json`.
- `androperator doctor --json` exited `0` and returned `criticalOk: true`; because multiple devices were connected, it reported `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` as a warning.
- `androperator doctor --json --device <physical_device>` exited `0` and returned `criticalOk: true`.
- `androperator doctor --json --device emulator-5554` exited `0` and returned `criticalOk: true`.

Finding:

- The global bundled `androperator-upgrade` workflow successfully upgraded this host from CLI `0.7.3` to CLI `0.7.4`, remediated both connected release-package Operator APKs to `0.7.4`, refreshed bundled skills to `0.7.4`, and left both devices doctor-ready.

## Phase 2 - Public `install.sh` After Global Uninstall

Status: completed.

Plan:

- Uninstall only the global `androperator` npm package.
- Do not remove or reset `~/.androperator`.
- Run `curl -fsSL https://androperator.com/install.sh | bash`.
- Verify completion and run post-install checks.

Progress:

- `npm uninstall -g androperator` succeeded.
- After uninstall, `androperator --version` failed with `command not found`.
- `~/.androperator` was not removed or reset.
- `curl -fsSL https://androperator.com/install.sh | bash` exited `0`.
- Public `install.sh` installed `androperator@latest`, then delegated to `androperator install`.
- `androperator install` completed with `status: "warn"` because both connected devices are ready and future commands must use `--device`.
- Installer output reported:
  - Operator remediation: all connected devices are ready.
  - Skills install: synced to `~/.androperator/skills`.
  - Bundled-skills install: installed.
  - Host setup: complete.
- After public install, global CLI was `/opt/homebrew/bin/androperator`, version `0.7.4`.
- `androperator doctor --json` exited `0` and returned `criticalOk: true`; because multiple devices were connected, it reported `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` as a warning.
- `androperator doctor --json --device <physical_device>` exited `0` and returned `criticalOk: true`.
- `androperator doctor --json --device emulator-5554` exited `0` and returned `criticalOk: true`.

Finding:

- The live public `install.sh` successfully installed the live `0.7.4` CLI, delegated post-bootstrap setup to the CLI-owned install flow, preserved the existing `~/.androperator` state, and left both connected release-package devices doctor-ready.

## Overall Result

- Phase 1 passed: the global bundled `androperator-upgrade` workflow upgraded this machine from `0.7.3` to `0.7.4` and got both devices doctor-ready.
- Phase 2 passed: after global npm uninstall, the public installer restored `androperator` to `0.7.4` and got both devices doctor-ready.
- Expected warning observed in both phases: with two ready devices connected, future device commands must pass `--device`.
