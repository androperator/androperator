# Skills Overview

## Purpose

Explain what Androperator skills are, how local discovery works, and how
runtime skills relate to authored skill packages and host-agent helpers.

For the post-install decision of when to start with `androperator skills`
instead of MCP or direct CLI automation, read
[Host Agent Orientation](../host-agents.md) first. Use [Skills CLI](cli.md) for
the exact `androperator skills` command contract.

## Sources

- Registry contract: `apps/node/src/contracts/skills.ts`
- Registry loading: `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`
- Runtime wrapper: `apps/node/src/domain/skills/runSkill.ts`
- Listing and search: `apps/node/src/domain/skills/listSkills.ts`, `apps/node/src/domain/skills/searchSkills.ts`
- CLI surface: `apps/node/src/cli/commands/skills.ts`, `apps/node/src/cli/registry.ts`
- Installer outputs: [`install.sh`](https://github.com/androperator/androperator/blob/main/sites/androperator-public/install.sh)
- Serve API wrapper: `apps/node/src/cli/commands/serve.ts`

## What Skills Are

Androperator helps agents create and run their own local skills. Installation
initializes an empty local workspace; it does not download an app-skill catalog.

Skills are deterministic wrappers around repeatable workflows.

Current role split:

- Androperator is the execution substrate
- a skill defines a reusable wrapper or artifact
- the agent decides when to invoke the skill and how to interpret the result

Runtime skills are discovered from local `skill.json` manifests. An existing
`skills-registry.json` remains an optional compatibility index. The list, search,
get, validate, and run commands share the collection loader; see [lookup rules](#registry).
The implementation calls the resulting in-memory collection a registry even when
no index file exists. `androperator skills` covers runtime skills only.
Authoring skills are a separate category of AI agent programs that live in
`.agents/skills/` in source form and install separately into
`~/.androperator/bundled-skills/` plus host-agent discovery directories. Claude
Code and Codex receive symlinks into the canonical store. Generic agents
receive managed real directory copies under `~/.agents/skills/`. When discovery
directories resolve to the same physical location as the generic agents directory,
all consumers share its managed copies.

Installer-facing discovery is deliberately split:

- `~/.androperator/AGENTS.md` is the installer-written local guide for runtime skills
- if `~/.agents/AGENTS.md` already exists, the installer appends one bounded Androperator bridge there that points back to `~/.androperator/AGENTS.md` and the `androperator skills` discovery commands
- the installer does not mirror runtime skills into shared agent skill directories such as `~/.agents/skills/`, `~/.claude/skills/`, or `~/.codex/skills/`

## Skill Categories

Current authoring practice recognizes two categories of skills:

- `-replay` skills:
  - recording-derived or replay-oriented wrappers
  - optimized for deterministic path execution on a known UI flow
  - may rely on tighter device or layout assumptions
- `-orchestrated` skills:
  - agent-controlled skills intended to better match the Androperator brain/hand model
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
- `scripts/run.js` is a thin harness. It reads the injected Androperator env vars, spawns the configured agent CLI on `SKILL.md`, and forwards stdout and stderr.
- the harness must not absorb the real skill logic. If app-specific decision policy, navigation authority, or terminal verification rules move into the harness, the skill has left this contract.
- `runSkill()` remains the Androperator-owned boundary. It validates the skill, injects runtime env vars, executes the harness, parses the framed result, and injects trusted `source` metadata.
- orchestrated output is contract-bound. The runtime agent must emit exactly one terminal `[Androperator-Skill-Result]` frame with a valid `SkillResult` object.
- replay skills remain first-class. Orchestrated skills are an additional runtime shape, not a replacement for replay-driven skills.

For the practical authoring rules that keep orchestrated skills debuggable and
truthful in real device runs, see
[Authoring](authoring.md#authoring-agent-driven-orchestrated-skills).

Current implementation notes:

- the currently supported orchestrated runtime path uses `codex` as the agent CLI
- some orchestrated harnesses currently run codex with `danger-full-access` so the runtime agent can reach live adb targets, but that is a harness-specific choice rather than a Node runtime guarantee

## Registry

Local skills are optional. Androperator discovers `skill.json` files directly in
`<cwd>/skills/<skill_id>/`. When `<cwd>/skills/` is absent, it uses
`~/.androperator/skills/skills/<skill_id>/`. A project collection, even an empty
one, shadows the home collection; collections are not merged.

`ANDROPERATOR_SKILLS_DIR` optionally selects a directory containing skill
folders. It must be non-blank and readable. No environment variable, index file,
or catalog checkout is required for a normal installation. A missing home
collection produces an empty list without warnings.

An existing `skills-registry.json` in the selected directory remains an optional
legacy index and takes precedence over manifest scanning. Explicit Node API
`registryPath` arguments still read that file and fail if it cannot be read.
Invalid manifests, duplicate ids, unreadable directories, or malformed indexes
fail with `REGISTRY_READ_FAILED`; repair the local file reported in the error.

Use `androperator skills new <application_id>.<intent>` to scaffold a skill.
It writes a manifest, instructions, and scripts without creating an index. When
an optional index already exists, scaffolding keeps it updated. Run
`androperator skills list`, inspect `skills get <id>`, then `skills validate <id>`
before `skills run <id>`. An empty list is valid and does not require reinstalling.

Optional [bundled examples](https://github.com/androperator/androperator/tree/main/examples/skills)
show a Settings starter, Codex-only navigation, and bounded Jev delegation.
They are references for agents to adapt, and are not installed by default.

## Registry Verification

`androperator skills list` returns the discovered skills and count. A fresh
host can return `{ "skills": [], "count": 0 }`. A missing default collection is
not a readiness failure. Existing index files are optional compatibility inputs.

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
