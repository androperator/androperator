# Environment Variables

## Purpose

Define every environment variable the Node CLI reads, its exact default, where it takes effect, and how to verify it is working. Use environment variables for workspace-wide defaults in headless, CI, or agent environments where repeating CLI flags on every command is impractical.

## Sources

- Global flag parsing (reads `--log-level`, `--operator-package`, `--device`, `--timeout`): `apps/node/src/cli/index.ts`
- Logger construction (reads `ANDROPERATOR_LOG_DIR`, `ANDROPERATOR_LOG_LEVEL`): `apps/node/src/adapters/logger.ts`
- Android SDK tool resolution (reads `ANDROID_HOME`, `ANDROID_SDK_ROOT`): `apps/node/src/adapters/android-bridge/runtimeConfig.ts`
- Per-command operator package and adb path: `apps/node/src/cli/registry.ts` plus device-targeting handlers in `apps/node/src/cli/commands/`
- Execution runtime (reads `ANDROPERATOR_OPERATOR_PACKAGE`, `ADB_PATH`): `apps/node/src/domain/executions/runExecution.ts`

## Precedence Rule

When both a CLI flag and an environment variable control the same setting, the CLI flag wins. The CLI parses global flags before dispatching to any command, so flags like `--operator-package` and `--log-level` can appear anywhere on the command line.

Resolution order for a typical setting:

1. Explicit CLI flag (highest priority)
2. Environment variable
3. Hardcoded default (lowest priority)

There is no configuration file layer between the environment variable and the default.

## Complete Reference

| Variable | Default if unset | CLI flag override |
| --- | --- | --- |
| `ANDROPERATOR_OPERATOR_PACKAGE` | `com.androperator.operator` | `--operator-package` |
| `ANDROPERATOR_LOG_DIR` | `~/.androperator/logs` | none |
| `ANDROPERATOR_LOG_LEVEL` | `info` | `--log-level` |
| `ADB_PATH` | `adb` (from `PATH`) | none |
| `ANDROID_HOME` | unset | none |
| `ANDROID_SDK_ROOT` | unset (fallback for `ANDROID_HOME`) | none |

## `ANDROPERATOR_OPERATOR_PACKAGE`

Controls which Operator APK package name the runtime targets when `--operator-package` is not passed.

Blank or whitespace-only values are normalized to unset before the runtime resolves the package, so the default package is used instead of treating an empty string as a real package id.

Read by every device-targeting CLI command (`snapshot`, `click`, `read`, `wait`, `scroll`, `doctor`, `record start`, `record stop`, `record pull`, `operator setup`, `grant-device-permissions`, `version --check-compat`, `exec`, `serve`), plus `runExecution()`.

Default: `com.androperator.operator`

Common values:

| Value | When to use |
| --- | --- |
| `com.androperator.operator` | Release APK. Default. |
| `com.androperator.operator.dev` | Local debug APK built from source. |

Example:

```bash
export ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev
androperator snapshot --device emulator-5554
```

That snapshot runs against the debug Operator package. No `--operator-package` flag needed.

Verification - confirm the env var took effect:

```bash
androperator doctor --device emulator-5554
```

Check `report.operatorPackage` in the JSON output:

```json
{
  "ok": true,
  "criticalOk": true,
  "deviceId": "emulator-5554",
  "operatorPackage": "com.androperator.operator.dev",
  "checks": []
}
```

If `operatorPackage` shows the value you set, the env var is active.

Error case:

- if the env var names a package that is not installed, device-targeting commands fail with `OPERATOR_NOT_INSTALLED`
- if only the alternate known Operator variant is installed, `androperator doctor` reports `OPERATOR_VARIANT_MISMATCH` as a readiness warning

Note: the CLI also accepts `--receiver-package` as a legacy alias for `--operator-package`. Both override the same env var. Do not use `--receiver-package` in new code.

## `ANDROPERATOR_LOG_DIR`

Controls where the CLI writes structured log files.

Default: `~/.androperator/logs`

Log files are named `androperator-YYYY-MM-DD.log` and contain NDJSON `LogEvent` objects.

Guaranteed fields:

- `ts`
- `level`
- `event`
- `message`

Optional fields, present only when the emitter supplied them:

- `commandId`
- `taskId`
- `deviceId`

There is no CLI flag to override this. To change the log directory, set the env var.

Example:

```bash
export ANDROPERATOR_LOG_DIR=/tmp/androperator-logs
androperator snapshot
# logs written to /tmp/androperator-logs/androperator-2026-03-25.log
```

This variable affects logging only. It does not change device behavior, result envelopes, or execution outcomes.

## `ANDROPERATOR_LOG_LEVEL`

Controls the logger threshold when `--log-level` is not passed.

Default: `info`

Valid values: `debug`, `info`, `warn`, `error`

If set to an unrecognized value (e.g., `trace`, `verbose`, or an empty string), the logger silently falls back to `info`. This is not an error - it is how `normalizeLogLevel()` in `logger.ts` works.

`--log-level` is a global flag. It can appear anywhere on the command line and takes priority over this env var:

```bash
# env var sets warn, but flag overrides to debug
export ANDROPERATOR_LOG_LEVEL=warn
androperator snapshot --log-level debug
# logger threshold is debug for this command
```

## `ADB_PATH`

Overrides the adb binary used by the entire runtime. Affects device listing, doctor checks, execution dispatch, recording, operator setup, permission grants, emulator management, package listing, and the serve server.

Default: `adb` (resolved from the process `PATH`).

There is no CLI flag that overrides `ADB_PATH`. This env var is the only way to specify a non-default adb binary.

Read at two levels:

- CLI command handlers pass `adbPath: process.env.ADB_PATH` into domain functions
- `runExecution()` falls back to `process.env.ADB_PATH` when `options.adbPath` is not provided

Example:

```bash
export ADB_PATH=/opt/android/platform-tools/adb
androperator devices
```

Error case: if the path does not point to a working adb binary, `androperator doctor` reports `ADB_NOT_FOUND` for the `host.adb.presence` check.

Verification:

```bash
androperator doctor
```

If `host.adb.presence` passes, the configured adb binary is usable.

## `ANDROID_HOME` and `ANDROID_SDK_ROOT`

These are standard Android SDK environment variables, not Androperator-specific. The runtime reads them when resolving paths to `emulator`, `sdkmanager`, and `avdmanager`.

Resolution in `runtimeConfig.ts`:

1. Check `ANDROID_HOME`
2. If unset, check `ANDROID_SDK_ROOT`
3. If neither is set, fall back to bare command names (`emulator`, `sdkmanager`, `avdmanager`) resolved from `PATH`

These variables matter for emulator provisioning flows (`androperator emulator create`, `emulator start`, and the `/android/emulators` serve endpoints). They do not affect normal device execution against an already-connected adb target.

Tool paths resolved from the SDK root:

| Tool | Resolved path |
| --- | --- |
| `emulator` | `<sdk_root>/emulator/emulator` |
| `sdkmanager` | `<sdk_root>/cmdline-tools/latest/bin/sdkmanager` |
| `avdmanager` | `<sdk_root>/cmdline-tools/latest/bin/avdmanager` |

If the resolved path does not exist, the runtime falls back to the bare command name.

## Related Pages

- [Host Agent Orientation](../host-agents.md)
- [Setup](../setup.md)
- [Devices](devices.md)
- [Doctor](doctor.md)
- [Serve API](serve.md)
- [Skills Overview](../skills/overview.md)
