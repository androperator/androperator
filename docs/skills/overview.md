# Skills Overview

## Purpose

Explain what Clawperator skills are, how the registry model works, and how
runtime skills relate to authored skill packages and host-agent helpers.

For the post-install decision of when to start with `clawperator skills`
instead of MCP or direct CLI automation, read
[Host Agent Orientation](../host-agents.md) first. Use [Skills CLI](cli.md) for
the exact `clawperator skills` command contract.

## Sources

- Registry contract: `apps/node/src/contracts/skills.ts`
- Registry loading: `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`
- Runtime wrapper: `apps/node/src/domain/skills/runSkill.ts`
- Listing and search: `apps/node/src/domain/skills/listSkills.ts`, `apps/node/src/domain/skills/searchSkills.ts`
- CLI surface: `apps/node/src/cli/commands/skills.ts`, `apps/node/src/cli/registry.ts`
- Installer outputs: [`install.sh`](https://github.com/clawperator/clawperator/blob/main/sites/landing-clawperator/public/install.sh)
- Serve API wrapper: `apps/node/src/cli/commands/serve.ts`

## What Skills Are

Skills are deterministic wrappers around repeatable workflows.

Current role split:

- Clawperator is the execution substrate
- a skill defines a reusable wrapper or artifact
- the agent decides when to invoke the skill and how to interpret the result

Skills are registry-driven. They are not discovered by folder scanning alone. `clawperator skills list`, `clawperator skills for-app`, `clawperator skills search`, `clawperator skills get`, `clawperator skills validate`, and `clawperator skills run` all read the registry through `loadRegistry()` in `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`.

`clawperator skills` and `skills-registry.json` cover runtime skills only.
Authoring skills are a separate category of AI agent programs that live in
`.agents/skills/` in source form and install separately into
`~/.clawperator/bundled-skills/` plus host-agent discovery directories. Claude
Code and Codex receive symlinks into the canonical store. Generic agents
receive managed real directory copies under `~/.agents/skills/`. When discovery
directories resolve to the same physical location as the generic agents directory,
all consumers share its managed copies.

Installer-facing discovery is deliberately split:

- `~/.clawperator/AGENTS.md` is the installer-written local guide for runtime skills
- if `~/.agents/AGENTS.md` already exists, the installer appends one bounded Clawperator bridge there that points back to `~/.clawperator/AGENTS.md` and the `clawperator skills` discovery commands
- the installer does not mirror runtime skills into shared agent skill directories such as `~/.agents/skills/`, `~/.claude/skills/`, or `~/.codex/skills/`

## Skill Categories

Current authoring practice recognizes two categories of skills:

- `-replay` skills:
  - recording-derived or replay-oriented wrappers
  - optimized for deterministic path execution on a known UI flow
  - may rely on tighter device or layout assumptions
- `-orchestrated` skills:
  - agent-controlled skills intended to better match the Clawperator brain/hand model
  - may declare an `agent` block in `skill.json`
  - run through their `scripts/run.js` harness, which spawns the configured agent CLI
  - can emit structured `SkillResult` frames with checkpoints and terminal verification that `runSkill` parses and returns

Important current caveats:

- the `-replay` / `-orchestrated` suffix split is still primarily a naming and authoring convention, not a dedicated registry enum
- runtime behavior for orchestrated skills is currently driven by the presence of `skill.json.agent`, not by suffix inspection alone
- the currently supported orchestrated runtime path uses `codex` as the agent CLI
- some orchestrated harnesses currently run codex with `danger-full-access` so the runtime agent can reach live adb targets, but that is a harness-specific choice rather than a Node runtime guarantee
- suffixes identify the intended runtime shape when present
- an unsuffixed id should not be read as proof that a skill is orchestrated

## Skill Structure

The registry contract for one skill is:

```json
{
  "id": "com.android.settings.capture-overview",
  "applicationId": "com.android.settings",
  "intent": "capture-overview",
  "summary": "Capture a Settings overview snapshot",
  "path": "skills/com.android.settings.capture-overview",
  "skillFile": "skills/com.android.settings.capture-overview/SKILL.md",
  "scripts": [
    "skills/com.android.settings.capture-overview/scripts/run.js",
    "skills/com.android.settings.capture-overview/scripts/run.sh"
  ],
  "artifacts": [
    "skills/com.android.settings.capture-overview/artifacts/overview.recipe.json"
  ]
}
```

Meaning of the fields:

| Field | Meaning |
| --- | --- |
| `id` | canonical registry id |
| `applicationId` | app package the skill is primarily associated with |
| `intent` | short intent name derived from the id |
| `summary` | one-line description |
| `path` | skill directory relative to the skills repo root |
| `skillFile` | `SKILL.md` path |
| `scripts` | runnable script paths |
| `artifacts` | deterministic recipe payload files |

Orchestrated skills may also include an `agent` block in `skill.json`:

```json
{
  "agent": {
    "cli": "codex",
    "timeoutMs": 300000
  }
}
```

Current behavior:

- `runSkill()` detects agent-driven orchestrated skills from `skill.json.agent`
- `runSkill()` validates agent CLI availability before spawn and returns `SKILL_AGENT_CLI_UNAVAILABLE` when it is missing
- `runSkill()` executes the skill's `scripts/run.js` harness
- the harness is responsible for spawning the configured agent CLI on `SKILL.md`
- framed `SkillResult` output must omit `source`; `runSkill()` injects trusted source metadata from `skill.json.agent`

## Orchestrated Runtime Contract

An orchestrated skill is an agent-driven runtime shape with these durable rules:

- `skill.json.agent` is the trusted runtime metadata. It names the agent CLI and timeout policy that `runSkill()` enforces.
- registry parity validation does not police `skill.json.agent`. The registry covers distributable skill identity and file layout, while `skill.json.agent` remains the trusted runtime execution config that `runSkill()` reads directly.
- `SKILL.md` is the skill authority. It contains the app-specific runtime program, navigation policy, checkpoints, and terminal verification expectations.
- `scripts/run.js` is a thin harness. It reads the injected Clawperator env vars, spawns the configured agent CLI on `SKILL.md`, and forwards stdout and stderr.
- the harness must not absorb the real skill logic. If app-specific decision policy, navigation authority, or terminal verification rules move into the harness, the skill has left this contract.
- `runSkill()` remains the Clawperator-owned boundary. It validates the skill, injects runtime env vars, executes the harness, parses the framed result, and injects trusted `source` metadata.
- orchestrated output is contract-bound. The runtime agent must emit exactly one terminal `[Clawperator-Skill-Result]` frame with a valid `SkillResult` object.
- replay skills remain first-class. Orchestrated skills are an additional runtime shape, not a replacement for replay-driven skills.

For the practical authoring rules that keep orchestrated skills debuggable and
truthful in real device runs, see
[Authoring](authoring.md#authoring-agent-driven-orchestrated-skills).

Current implementation notes:

- the currently supported orchestrated runtime path uses `codex` as the agent CLI
- some orchestrated harnesses currently run codex with `danger-full-access` so the runtime agent can reach live adb targets, but that is a harness-specific choice rather than a Node runtime guarantee

## Registry

The registry file is a JSON object with:

```json
{
  "schemaVersion": "optional string",
  "generatedAt": "optional string",
  "skills": [
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
  ]
}
```

Registry resolution precedence is:

1. explicit `registryPath` argument, when a caller supplied one
2. `CLAWPERATOR_SKILLS_REGISTRY`, when it is set and non-blank
3. default path `skills/skills-registry.json` relative to the current working directory

Current failure and fallback rules:

- if an explicit `registryPath` argument is passed and that path cannot be read, `loadRegistry()` fails immediately and does not fall back
- if `CLAWPERATOR_SKILLS_REGISTRY` is set but blank, `loadRegistry()` fails immediately and does not fall back
- if `CLAWPERATOR_SKILLS_REGISTRY` is set to a non-blank path and that read fails, `loadRegistry()` fails immediately and does not fall back
- if neither an explicit path nor env var is active and the default-path read fails, `loadRegistry()` next tries:
  - `../../skills/skills-registry.json` relative to the current working directory when running from `apps/node`
  - `~/.clawperator/skills/skills/skills-registry.json`

The install and sync flow writes the canonical long-lived registry under:

- `~/.clawperator/skills/skills/skills-registry.json`

That path is assembled from these literals in `apps/node/src/domain/skills/skillsConfig.ts`:

- `DEFAULT_SKILLS_DIR = ~/.clawperator/skills`
- `DEFAULT_SKILLS_REGISTRY_SUBPATH = skills/skills-registry.json`
- `SKILLS_REPO_URL = https://github.com/clawperator/clawperator-skills`

## Registry Verification

Use `skills list` to confirm that the registry path in your current shell is readable:

- after `install.sh`, this works in a fresh non-login shell because `loadRegistry()` falls back to `~/.clawperator/skills/skills/skills-registry.json` when no explicit registry path or env var is active

```bash
clawperator skills list
```

Success means the registry was loaded and the `skills` array was parsed:

```json
{
  "skills": [
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
  ],
  "count": 1
}
```

If the registry cannot be read, every discovery command fails with `REGISTRY_READ_FAILED`:

```json
{
  "code": "REGISTRY_READ_FAILED",
  "message": "Registry not found at configured path: /tmp/missing-registry.json. Update CLAWPERATOR_SKILLS_REGISTRY or run clawperator skills install."
}
```

Recovery depends on how the path was chosen:

- when `CLAWPERATOR_SKILLS_REGISTRY` points at a missing file, update the env var or run `clawperator skills install`
- when no env var is set and neither the current working directory nor `~/.clawperator/skills/skills/skills-registry.json` contains the registry, verify `~/.clawperator/skills/skills/skills-registry.json`, run `clawperator skills list`, then run `clawperator skills install` or set `CLAWPERATOR_SKILLS_REGISTRY`
- when the registry file exists but does not contain a `skills` array, fix the JSON because `loadRegistry()` rejects that shape with `Invalid registry: skills array required`

Wrapper failure fields like `stdout` and `stderr` are optional. `runSkill.ts` includes them only when the child process actually emitted non-empty data on those streams.

## Runtime-Skill Workflow

The conceptual workflow is:

1. discover candidate runtime skills from the registry
2. inspect the selected skill metadata
3. validate the skill before live use
4. run the skill through the wrapper
5. parse the structured result or feature-specific error

Use [Skills CLI](cli.md) for exact command syntax, output shapes, success
conditions, and recovery for `skills list`, `skills search`, `skills get`,
`skills validate`, `skills compile-artifact`, `skills new`, `skills run`,
`skills install`, `skills update`, and `skills sync`.

## Serve API Context

The local HTTP server exposes skills routes that use the same registry and
`runSkill()` runtime:

- `GET /skills`
- `GET /skills/:skillId`
- `POST /skills/:skillId/run`

Serve adds route-local request validation and HTTP status codes. Use
[Serve API](../api/serve.md#endpoint-get-skills) for the HTTP contract, and use
[Skills CLI](cli.md) for the underlying runtime-skill command behavior.

## Practical Model

- use skills when you need a reusable app-specific workflow, not a one-off raw
  UI action
- use `skills list`, `skills search`, and `skills get` to discover what is
  available
- use `skills validate --dry-run` when you want to confirm registry integrity
  before a live run
- use `skills run` when you want the wrapper's validation gate, timeout, env
  injection, and JSON wrapper
- use `skillResult.result` as the deterministic domain answer when a skill
  emits a framed `SkillResult`

## Related Pages

- [Host Agent Orientation](../host-agents.md)
- [Skills CLI](cli.md)
- [Authoring](authoring.md)
- [Development Workflow](development.md)
- [Device Prep and Runtime](runtime.md)
- [Environment Variables](../api/environment.md)
- [Serve API](../api/serve.md)
