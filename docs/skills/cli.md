# Skills CLI

## Purpose

Define the canonical `androperator skills` command contract for runtime-skill
discovery, validation, artifact compilation, local scaffolding, install/sync,
and execution.

Conceptual skill model, registry shape, and orchestrated-skill runtime rules
live in [Skills Overview](overview.md). This page owns the command behavior,
output shapes, success conditions, and recovery rules for the Skills CLI.

## Sources

- CLI dispatch: `apps/node/src/cli/registry.ts`
- CLI command handlers: `apps/node/src/cli/commands/skills.ts`
- Registry contract: `apps/node/src/contracts/skills.ts`
- Registry loading and search: `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`, `apps/node/src/domain/skills/searchSkills.ts`
- Runtime wrapper: `apps/node/src/domain/skills/runSkill.ts`
- Skill validation: `apps/node/src/domain/skills/validateSkill.ts`
- Artifact compilation: `apps/node/src/domain/skills/compileArtifact.ts`

## Command Summary

```bash
androperator skills list
androperator skills get <skill_id>
androperator skills for-app <package_id>
androperator skills search --app <package_id> [--intent <intent>] [--keyword <text>]
androperator skills search <keyword>
androperator skills compile-artifact <skill_id> --artifact <name> [--vars <json>]
androperator skills new <skill_id> [--summary <text>] [--recording-context <file>]
androperator skills validate <skill_id> [--dry-run]
androperator skills validate --all [--dry-run]
androperator skills run <skill_id> [--device <id>] [--operator-package <pkg>] [--timeout <ms>] [--expect-contains <text>] [--skip-validate] [skill_args...]
androperator skills install
androperator skills update [--ref <git-ref>]
androperator skills sync --ref <git-ref>
```

Public command lookup remains in the generated [CLI Reference](../api/cli.md#command-skills).

## Discovery Commands

Use discovery before running a skill unless you already have the exact registry
id.

| Command | Purpose | Success shape |
| --- | --- | --- |
| `skills list` | Return every registry entry. | `{ "skills": [...], "count": <number> }` |
| `skills for-app <package_id>` | Search by exact `applicationId`. | Same as `skills search --app`. |
| `skills search --app <package_id>` | Search by exact `applicationId`. | `{ "skills": [...], "count": <number> }` |
| `skills search --intent <intent>` | Search by exact intent. | `{ "skills": [...], "count": <number> }` |
| `skills search --keyword <text>` | Search by ranked keyword match. | `{ "skills": [...], "count": <number> }` |
| `skills search <keyword>` | Shorthand for keyword search. | `{ "skills": [...], "count": <number> }` |
| `skills get <skill_id>` | Return one registry entry. | `{ "skill": { ... } }` |

Registry entry shape:

```json
{
  "id": "com.android.settings.capture-overview",
  "applicationId": "com.android.settings",
  "intent": "capture-overview",
  "summary": "Capture a Settings overview snapshot",
  "path": "skills/com.android.settings.capture-overview",
  "skillFile": "skills/com.android.settings.capture-overview/SKILL.md",
  "scripts": [
    "skills/com.android.settings.capture-overview/scripts/run.js"
  ],
  "artifacts": []
}
```

Search ranking for `--keyword` is deterministic:

1. exact `keywords[]` entry match
2. tokenized `keywords[]` match
3. exact `id` or `applicationId` match
4. tokenized `id` or `applicationId` match
5. substring in `keywords[]`
6. substring in `id` or `applicationId`
7. substring in `summary`

Equal-ranked results keep registry order.

## Registry Failures

All discovery commands read the registry through the same loader. When the
registry cannot be read, they return:

```json
{
  "code": "REGISTRY_READ_FAILED",
  "message": "Registry not found at configured path: /tmp/missing-registry.json. Update ANDROPERATOR_SKILLS_REGISTRY or run androperator skills install."
}
```

Recovery depends on how the path was chosen:

- if `ANDROPERATOR_SKILLS_REGISTRY` points at a missing or invalid file, fix or
  unset that env var
- if no env var is set, verify
  `~/.androperator/skills/skills/skills-registry.json`
- run `androperator skills install` when the installed skills repo is absent
- run `androperator skills list` again and require a parsed `skills` array

If the registry loads but a requested id is absent, `skills get`, `skills
validate`, and `skills run` can return `SKILL_NOT_FOUND`.

## Install, Update, And Sync

| Command | Behavior |
| --- | --- |
| `skills install` | Initializes or validates an empty local registry under `~/.androperator/skills/`; preserves existing skills and downloads nothing. |
| `skills update [--ref <git-ref>]` | Validates the local workspace; only `main` is accepted. |
| `skills sync --ref <git-ref>` | Requires `--ref main`; other refs return `SKILLS_SYNC_FAILED`. |

Successful `skills install` responses include the registry path:

```json
{
  "synced": true,
  "message": "Local skill workspace ready.",
  "registryPath": "/Users/<local_user>/.androperator/skills/skills/skills-registry.json"
}
```

Successful `skills update` and `skills sync` responses include `synced` and
`message`; they do not repeat the registry path.

`skills sync` without `--ref` returns a usage object:

```json
{
  "code": "USAGE",
  "message": "skills sync --ref <git-ref>"
}
```

## Validate

Validate one skill:

```bash
androperator skills validate <skill_id> [--dry-run]
```

Validate every registry entry:

```bash
androperator skills validate --all [--dry-run]
```

Successful single-skill validation includes the registry entry, registry path,
and concrete file paths checked by the validator:

```json
{
  "valid": true,
  "skill": {
    "id": "com.android.settings.capture-overview"
  },
  "registryPath": "/Users/<local_user>/.androperator/skills/skills/skills-registry.json",
  "checks": {
    "skillJsonPath": "/Users/<local_user>/.androperator/skills/skills/com.android.settings.capture-overview/skill.json",
    "skillFilePath": "/Users/<local_user>/.androperator/skills/skills/com.android.settings.capture-overview/SKILL.md",
    "scriptPaths": [
      "/Users/<local_user>/.androperator/skills/skills/com.android.settings.capture-overview/scripts/run.js"
    ],
    "artifactPaths": []
  }
}
```

`--dry-run` extends validation to compiled artifact payloads. Script-only skills
skip payload validation during dry run because their payload is generated at
runtime by the skill script:

```json
{
  "valid": true,
  "dryRun": {
    "payloadValidation": "skipped",
    "reason": "skill has no pre-compiled artifacts; payload is generated at runtime by the skill script"
  }
}
```

Validation failures return `SKILL_VALIDATION_FAILED` with `details` describing
missing files, registry parity mismatches, or invalid compiled payloads.

## Compile Artifact

```bash
androperator skills compile-artifact <skill_id> --artifact <name> [--vars <json>]
androperator skills compile-artifact --skill-id <id> --artifact <name> [--vars <json>]
```

Rules:

- `skill_id` may be positional or supplied with `--skill-id`
- `--artifact` accepts the bare artifact name or the full `.recipe.json` file name
- `--vars` defaults to `{}`
- `--vars` must be a JSON object string
- the compiled payload is validated before success is returned

Success shape:

```json
{
  "execution": {
    "commandId": "cmd-<stable_hash>",
    "taskId": "task-<stable_hash>",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "<action_id>",
        "type": "<action_type>"
      }
    ],
    "mode": "artifact_compiled"
  }
}
```

The command and task ids are generated deterministically from the skill id,
artifact name, and sorted compile vars unless the artifact template supplies
`COMMAND_ID` or `TASK_ID`.

Run `androperator exec --validate-only --payload <file-or-json>` when you want a
second contract-only check before live execution.

## New Skill Scaffold

```bash
androperator skills new <skill_id> [--summary <text>] [--recording-context <file>]
```

Behavior:

- creates a new local skill folder in the configured skills registry repo
- derives `applicationId` and `intent` by splitting `<skill_id>` on the final dot
- creates `SKILL.md`, `skill.json`, `scripts/run.js`, and `scripts/run.sh`
- copies `--recording-context` into the skill folder when provided
- updates the configured registry JSON

Success shape:

```json
{
  "created": true,
  "skillId": "com.example.app.intent",
  "registryPath": "/path/to/skills-registry.json",
  "skillPath": "/path/to/skills/com.example.app.intent",
  "files": ["SKILL.md", "skill.json", "scripts/run.js", "scripts/run.sh"]
}
```

Use the bundled host-agent authoring skills when discovery returned no relevant
skill and you need guided app exploration or recording-based authoring. The
low-level `skills new` command only scaffolds files.

## Run

```bash
androperator skills run <skill_id> [--device <id>] [--operator-package <pkg>] [--timeout <ms>] [--expect-contains <text>] [--skip-validate] [skill_args...]
```

Wrapper sequence:

1. resolve `ANDROPERATOR_BIN` for the child process
2. resolve `ANDROPERATOR_OPERATOR_PACKAGE`
3. validate the skill with `validateSkill(skillId, undefined, { dryRun: true })` unless `--skip-validate` is passed
4. resolve the target device and verify interactive readiness
5. load the registry entry
6. choose a script, preferring `.js`, then `.sh`, then the first listed script
7. spawn the script
8. capture stdout and stderr
9. enforce the timeout

Argument and env rules:

- if `--device` was provided, the wrapper injects it through
  `ANDROPERATOR_DEVICE_ID`
- for script-driven skills, that explicit device id is also prepended as the
  first child argument, so Node scripts receive `argv[2] = <device_serial>`
  before forwarded args
- if `--device` was omitted, preflight may resolve one target, but inherited
  ambient `ANDROPERATOR_DEVICE_ID` is cleared for the child process and no
  synthetic device argument is added
- unknown trailing tokens are forwarded to the skill script unchanged
- use `--` before literal passthrough args that would otherwise look like
  wrapper flags
- `ANDROPERATOR_BIN` and `ANDROPERATOR_OPERATOR_PACKAGE` are injected into the
  script environment
- `--timeout` overrides the wrapper timeout for this run only; `--timeout-ms`
  is accepted as an alias

Default runtime values:

| Field | Default |
| --- | --- |
| wrapper timeout | `120000` milliseconds |
| operator package | `com.androperator.operator` |
| JSON output | default output mode |

### Wrapper status and exit behavior

Every `cmdSkillsRun` outcome includes `status`: `success`, `failed`, or
`indeterminate`, including validation and readiness failures. Strict parsers must
accept the added `status` on framed success. Nested `skillResult.status` remains
the child-authored domain conclusion and is not interchangeable with wrapper status.

The CLI exits 0 for wrapper success and 1 for failed or indeterminate outcomes.
A zero-exit legacy script without a frame remains process success with
`skillResult: null`, unless declared verification is unproved (indeterminate).
An agent-driven script that exits 0 without its required terminal frame fails
with `SKILL_RESULT_PARSE_FAILED`. A malformed frame fails with the same code; launch failure is
`SKILL_EXECUTION_FAILED`. A valid domain failure remains visible in `skillResult`;
a declared-verification run reporting domain failure also fails the wrapper.

### Successful Framed Result

Default JSON success with a parsed `SkillResult` omits duplicate top-level
`skillId`, `exitCode`, and `output`, and always includes wrapper `status`. Read `skillResult.result` for
the domain answer.

```json
{
  "status": "success",
  "skillResult": {
    "result": { "kind": "text", "text": "ok" },
    "status": "success",
    "contractVersion": "1.0.0",
    "skillId": "com.android.settings.capture-overview",
    "checkpoints": [],
    "source": { "kind": "script" }
  },
  "durationMs": 15842,
  "timeoutMs": 3210
}
```

`timeoutMs` appears only when the caller passed `--timeout` or `--timeout-ms`.
`expectedSubstring` appears only when the caller passed `--expect-contains`.

### Successful Unframed Result

When a skill exits successfully but does not emit a parsed `SkillResult`, the
wrapper returns process-oriented fields:

```json
{
  "status": "success",
  "skillId": "com.example.echo",
  "output": "TEST_OUTPUT:hello\n",
  "exitCode": 0,
  "durationMs": 18,
  "skillResult": null
}
```

### Indeterminate Result

When a declared verification contract is not proved, the wrapper returns
`status: "indeterminate"` and preserves the emitted `skillResult`:

```json
{
  "status": "indeterminate",
  "code": "SKILL_VERIFICATION_INDETERMINATE",
  "message": "Declared verification was not proved.",
  "skillResult": {
    "result": { "kind": "json", "value": { "note": "example" } },
    "status": "success",
    "contractVersion": "1.0.0",
    "skillId": "com.android.settings.capture-overview",
    "checkpoints": [],
    "source": { "kind": "script" }
  },
  "durationMs": 15842
}
```

### Run Failures

Common wrapper failures:

| Code | When it appears | Recovery |
| --- | --- | --- |
| `REGISTRY_READ_FAILED` | registry cannot be loaded | repair `ANDROPERATOR_SKILLS_REGISTRY` or reinstall/sync skills |
| `SKILL_NOT_FOUND` | requested id is absent | confirm the id with `skills list`, `skills search`, or `skills get` |
| `SKILL_VALIDATION_FAILED` | pre-run validation found missing files or invalid artifacts | repair the skill before rerunning |
| `SKILL_SCRIPT_NOT_FOUND` | chosen script path is missing | restore the script or fix the registry entry |
| `SKILL_EXECUTION_FAILED` | child process exited non-zero or failed to spawn | inspect `stdout`, `stderr`, and the script exit code |
| <code>SKILL_EXECUTION_&#x54;IMEOUT</code> | wrapper timeout elapsed | inspect partial `stdout`; raise `--timeout` only if the skill is still making progress |
| `SKILL_AGENT_CLI_UNAVAILABLE` | orchestrated skill declares an unavailable agent CLI | install or configure the declared agent CLI |
| `SKILL_OUTPUT_ASSERTION_FAILED` | `--expect-contains` text was absent | verify the expected substring against `output` |
| `SKILL_RESULT_PARSE_FAILED` | terminal `SkillResult` frame was malformed or untrusted | fix the frame JSON or trusted provenance metadata |

Output assertion failure:

```json
{
  "code": "SKILL_OUTPUT_ASSERTION_FAILED",
  "message": "Skill com.example.echo output did not include expected text",
  "skillId": "com.example.echo",
  "output": "TEST_OUTPUT:api\n",
  "skillResult": null,
  "expectedSubstring": "TEST_OUTPUT:hello"
}
```

Non-zero child exit:

```json
{
  "status": "failed",
  "code": "SKILL_EXECUTION_FAILED",
  "message": "Skill com.example.echo exited with code 2",
  "skillId": "com.example.echo",
  "exitCode": 2,
  "stdout": "partial output\n",
  "stderr": "fatal error\n",
  "skillResult": null
}
```

## Serve Skills Routes

The local Serve API exposes related skills routes:

- `GET /skills`
- `GET /skills/:skillId`
- `POST /skills/:skillId/run`

Those routes use the same registry and `runSkill()` runtime, with HTTP request
validation layered on top. See [Serve API](../api/serve.md#endpoint-get-skills)
for route-local request and response details.

## Verification

Discovery verification:

```bash
androperator skills list
androperator skills for-app com.android.settings
androperator skills search --keyword settings
androperator skills get com.android.settings.capture-overview
```

Run verification:

```bash
androperator skills validate com.android.settings.capture-overview --dry-run
androperator skills run com.android.settings.capture-overview --timeout 3210
```

Machine-checkable success:

- discovery responses parse as JSON and expose either `skills[]` plus `count`,
  or one `skill`
- validation success has `valid == true`
- framed run success has `skillResult.status == "success"` and a domain answer
  at `skillResult.result`
- unframed run success has `status == "success"` and `exitCode == 0`

## Related Pages

- [Skills Overview](overview.md)
- [Authoring](authoring.md)
- [Development Workflow](development.md)
- [Device Prep and Runtime](runtime.md)
- [Serve API](../api/serve.md)
- [CLI Reference](../api/cli.md#command-skills)
