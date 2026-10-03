# Environment Variables

## Purpose

Define every environment variable the Node CLI reads, its exact default, where it takes effect, and how to verify it is working. Use environment variables for workspace-wide defaults in headless, CI, or agent environments where repeating CLI flags on every command is impractical.

## Sources

- Global flag parsing (reads `--log-level`, `--operator-package`, `--device`, `--timeout`): `apps/node/src/cli/index.ts`
- Logger construction (reads `ANDROPERATOR_LOG_DIR`, `ANDROPERATOR_LOG_LEVEL`): `apps/node/src/adapters/logger.ts`
- Android SDK tool resolution (reads `ANDROID_HOME`, `ANDROID_SDK_ROOT`): `apps/node/src/adapters/android-bridge/runtimeConfig.ts`
- Skill binary and package resolution (reads `ANDROPERATOR_BIN`, `ANDROPERATOR_OPERATOR_PACKAGE`): `apps/node/src/domain/skills/skillsConfig.ts`
- Skills registry path (reads `ANDROPERATOR_SKILLS_REGISTRY`): `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`
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
| `ANDROPERATOR_SKILLS_REGISTRY` | `<cwd>/skills/skills-registry.json` | none |
| `ANDROPERATOR_BIN` | local sibling build if present, otherwise `androperator` | none |
| `ADB_PATH` | `adb` (from `PATH`) | none |
| `ANDROID_HOME` | unset | none |
| `ANDROID_SDK_ROOT` | unset (fallback for `ANDROID_HOME`) | none |

## `ANDROPERATOR_OPERATOR_PACKAGE`

Controls which Operator APK package name the runtime targets when `--operator-package` is not passed.

Blank or whitespace-only values are normalized to unset before the runtime resolves the package, so the default package is used instead of treating an empty string as a real package id.

Read by every device-targeting CLI command (`snapshot`, `click`, `read`, `wait`, `scroll`, `doctor`, `record start`, `record stop`, `record pull`, `operator setup`, `grant-device-permissions`, `version --check-compat`, `exec`, `serve`), plus `runExecution()` and `resolveOperatorPackage()` in the skills runtime.

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

## `ANDROPERATOR_SKILLS_REGISTRY`

Defines the path to the active `skills-registry.json` used by all skill commands when they do not pass an explicit registry-path argument into `loadRegistry()`.

Read by: `skills list`, `skills get`, `skills search`, `skills run`, `skills validate`, `skills compile-artifact`, `skills new`, and the `/skills` serve endpoints.

Default when unset: `<cwd>/skills/skills-registry.json` where `<cwd>` is `process.cwd()`.

Current `loadRegistry()` precedence is:

1. explicit `registryPath` argument, when a caller supplied one
2. `ANDROPERATOR_SKILLS_REGISTRY`, when it is set and non-blank
3. default path `<cwd>/skills/skills-registry.json`

Fallback behavior after that initial choice:

1. If an explicit `registryPath` argument was passed and that read fails, `loadRegistry()` throws immediately
2. If `ANDROPERATOR_SKILLS_REGISTRY` is set but blank, `loadRegistry()` throws immediately
3. If `ANDROPERATOR_SKILLS_REGISTRY` is set to a non-blank path and that read fails, `loadRegistry()` throws a configured-path error immediately
4. If the default-path read fails with no env var and no explicit `registryPath`, `loadRegistry()` next tries:
   - `<cwd>/../../skills/skills-registry.json` when the current working directory is `apps/node`
   - `~/.androperator/skills/skills/skills-registry.json`

After `androperator skills install` or `androperator skills sync`, the registry lives at `~/.androperator/skills/skills/skills-registry.json`. That path is automatically discovered as a fallback when `ANDROPERATOR_SKILLS_REGISTRY` is not set, so no env var change is needed after a normal install:

```bash
androperator skills list
```

Set `ANDROPERATOR_SKILLS_REGISTRY` only when pointing at a non-standard registry path, such as a development checkout outside the installed home. For the normal post-install flow, start with [Host Agent Orientation](../host-agents.md).

Error case: if the path does not exist, skill commands fail with `REGISTRY_READ_FAILED`. The error message includes the path that was tried.

Current recovery rules:

- missing default path with no env var: run `androperator skills install` to restore the registry at `~/.androperator/skills/skills/skills-registry.json`
- blank `ANDROPERATOR_SKILLS_REGISTRY`: unset it or point it at a valid registry path
- wrong `ANDROPERATOR_SKILLS_REGISTRY` path: fix the env var, or unset it to fall back to the installed home path
- explicit caller-supplied registry path: fix the explicit path because `loadRegistry()` does not fall back from it

## `ANDROPERATOR_BIN`

Controls which Androperator CLI binary is used when skill scripts call back into Androperator. This is for skill subprocesses, not for the main CLI bootstrap.

When `androperator skills run` executes a skill script, it resolves a command string and injects it into the child process environment as `ANDROPERATOR_BIN`.

Resolution order in `resolveSkillBin()`:

1. Explicit `ANDROPERATOR_BIN` env var (if non-empty)
2. Local sibling build at `apps/node/dist/cli/index.js` relative to the running module (if the file exists)
3. Global `androperator` command

Default: the sibling build when running from a local checkout, otherwise `androperator`.

The sibling build is preferred over the global binary because it is always in sync with the local Android Operator APK. The global binary may lag behind due to npm publish delays.

Example:

```bash
export ANDROPERATOR_BIN=/usr/local/bin/androperator-nightly
androperator skills run com.test.echo --device emulator-5554
# the skill script receives ANDROPERATOR_BIN=/usr/local/bin/androperator-nightly
```

## Orchestrated Skill Runtime Env Vars

`runSkill()` injects these env vars when a skill declares `skill.json.agent`
and runs through `scripts/run.js`. The harness reads them directly. This is
the runtime contract for agent-driven orchestrated skills.

| Variable | Default if unset | Where it takes effect |
| --- | --- | --- |
| `ANDROPERATOR_SKILL_AGENT_CLI` | `skill.json.agent.cli` | injected into the orchestrated harness so it knows the configured CLI name |
| `ANDROPERATOR_SKILL_AGENT_CLI_PATH` | none | injected into the orchestrated harness after `runSkill()` resolves the executable path |
| `ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS` | caller `--timeout`, otherwise `skill.json.agent.timeoutMs`, otherwise `120000` | injected into the orchestrated harness as the effective timeout in milliseconds |
| `ANDROPERATOR_SKILL_PROGRAM` | none | absolute path to the skill's `SKILL.md` runtime program |
| `ANDROPERATOR_SKILL_INPUTS` | JSON serialization of the forwarded skill args array | injected into the orchestrated harness for agent input parity checks |
| `ANDROPERATOR_SKILL_ID` | none | injected into the orchestrated harness as the invoked skill id |
| `ANDROPERATOR_DEVICE_ID` | none | selected device serial that the wrapper or CLI passed into the skill run |

Behavior details:

- `ANDROPERATOR_SKILL_AGENT_CLI` comes from `skill.json.agent.cli` unless the
  caller overrides it with the same env var before `runSkill()` resolves the
  effective agent config
- `ANDROPERATOR_SKILL_AGENT_CLI_PATH` is present only after
  `resolveAgentCliExecutable()` succeeds
- `ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS` always reflects the effective timeout
  that `runSkill()` will enforce around the harness
- `ANDROPERATOR_SKILL_PROGRAM`, `ANDROPERATOR_SKILL_INPUTS`, and
  `ANDROPERATOR_SKILL_ID` are only present for agent-driven orchestrated runs
- `ANDROPERATOR_DEVICE_ID` is skill-scoped consumption: the CLI wrapper sets it
  when `skills run --device <serial>` is used, and `runSkill()` forwards it to
  the child process environment

Verification:

```bash
ANDROPERATOR_SKILLS_REGISTRY=/abs/path/to/skills/skills-registry.json \
androperator skills run com.test.agent-skill-result \
  --device emulator-5554 \
  -- valid
```

Check the parsed `skillResult.source` and the successful JSON envelope. The
fixture harness under `apps/node/src/test/fixtures/skills/com.test.agent-skill-result/`
only succeeds when `ANDROPERATOR_SKILL_AGENT_CLI_PATH`,
`ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS`, `ANDROPERATOR_SKILL_INPUTS`,
`ANDROPERATOR_SKILL_ID`, and `ANDROPERATOR_DEVICE_ID` are all populated as the
runtime expects.

Failure cases:

- if `ANDROPERATOR_SKILL_AGENT_CLI` resolves to an unavailable executable,
  `skills run` fails with `SKILL_AGENT_CLI_UNAVAILABLE`
- if `ANDROPERATOR_SKILL_AGENT_CLI_PATH` or `ANDROPERATOR_SKILL_PROGRAM` are
  missing inside the harness, the harness exits non-zero and `runSkill()`
  returns `SKILL_EXECUTION_FAILED`
- if `ANDROPERATOR_SKILL_INPUTS` is malformed JSON, behavior depends on the
  harness that parses it; this runtime only defines the environment variable
  contract, so malformed input should be treated as a harness-specific failure
  rather than a guaranteed fallback to empty args

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

## Agent Configuration Pattern

For deterministic agent environments, set these variables and forget about per-command flags:

```bash
export ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev
export ADB_PATH=/usr/local/bin/adb
```

Then every command uses consistent defaults:

```bash
androperator doctor --device emulator-5554
androperator snapshot --device emulator-5554
androperator skills run com.test.echo --device emulator-5554
```

The only flag you still need per-command is `--device` when multiple targets are connected. There is no environment variable equivalent for `--device` - device selection must always be explicit.

After `androperator skills install`, the registry at `~/.androperator/skills/skills/skills-registry.json` is discovered automatically. Setting `ANDROPERATOR_SKILLS_REGISTRY` is only needed when overriding to a non-standard path. For the post-install orientation flow, read [Host Agent Orientation](../host-agents.md).

## Related Pages

- [Host Agent Orientation](../host-agents.md)
- [Setup](../setup.md)
- [Devices](devices.md)
- [Doctor](doctor.md)
- [Serve API](serve.md)
- [Skills Overview](../skills/overview.md)
