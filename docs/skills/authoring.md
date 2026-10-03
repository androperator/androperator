# Authoring

## Purpose

Document the current authoring contract for local skills: zero-results
discovery, recording-based proving, scaffolded files, `SKILL.md`, run scripts,
artifact compilation, and validation.

The [context adapter](context-adapter.md) in `local skill workspace` limits how
much UI data you send to a model while keeping node relationships, state and
capture details.

For optional model delegation, see [Using Jev in orchestrated skills](jev.md).
It covers the agent/provider boundary, proposal validation, and recovery evidence.

## Adaptive execution and goal coverage

After orientation, use `androperator-agent-control-loop` for bounded adaptive
navigation and independently verified extraction. It checks completeness,
coverage, freshness and UI relationships, executes on the explicit target, and
verifies each destination. Conditional references cover ambiguous selectors,
nested rows, selective screenshots, failed-step recovery and optional delegation.
No model provider credential is required by this bundled guidance.

Match runtime skills by requested outcome, supported inputs, outputs and evidence,
not package overlap. A Settings landing-screen skill does not cover OS version
and build-number extraction. Partial coverage remains a discovery gap.

For an explicit orchestrated-authoring request with sufficient bounded evidence,
discovery can return `proceed_to_orchestrated_authoring` with `handoff_target`
`androperator-agent-control-loop`. Discovery stops before authoring; the control
loop then uses the canonical authoring workflow and the Settings examples linked
from [Jev integration](jev.md). Recording-based authoring retains
`proceed_to_recording` and its dedicated proving workflow. One-shot requests do
not authorize durable skill creation. Discovery retains its five-snapshot,
three-screenshot and 90-second limits.

## Preferred Authoring Route

Use this order:

| Situation | Start here | Stop when |
| --- | --- | --- |
| An installed runtime skill already matches the request | `androperator skills for-app`, `androperator skills search`, `androperator skills get` | You have a truthful runtime skill to run. |
| Runtime-skill discovery returned no relevant match and you need the host-visible zero-results route | `androperator bundled-skills list`, then `androperator-skill-author-by-agent-discovery` | Discovery emits one artifact and chooses exactly one next step. |
| Discovery returned `proceed_to_recording`, or the route is already well understood | `androperator-skill-author-by-recording` | One recording-derived skill shape is authored and its self-test surfaces a `SkillResult`. |
| You explicitly want the low-level manual scaffold instead of the installed guided workflows | `androperator skills new <skill_id>` | The local scaffold exists and the registry entry was added. |

Current route rules:

- Start with runtime-skill discovery first.
- If the user or calling workflow explicitly chose to refresh the installed
  Androperator environment itself, use `androperator-upgrade` before debugging
  component-level skill surfaces.
- If runtime-skill discovery returns no relevant match, use
  `androperator-skill-author-by-agent-discovery` as the zero-results front door.
- Use `androperator-skill-author-by-recording` only after discovery returns
  `proceed_to_recording`, or when the route is already well understood.
- Use raw `androperator skills new <skill_id>` scaffolding only when you
  explicitly want the low-level manual surface instead of the installed guided
  authoring workflows.

## Host-Agent Discovery Rule

When a host-facing agent is trying to decide how to create or maintain a skill,
use this order:

1. Discover runtime skills first with `androperator skills for-app` or
   `androperator skills search`.
2. If runtime-skill discovery returns no relevant match and you need to inspect
   installed guided authoring workflows on the current host, run
   `androperator bundled-skills list`.
3. Start with `androperator-skill-author-by-agent-discovery` as the zero-results front door.
4. Use `androperator-skill-author-by-recording` only after discovery returns
   `proceed_to_recording`, or when the route is already well understood.
5. Use `androperator skills new <skill_id>` only when you explicitly want the
   low-level manual scaffold instead of an installed authoring workflow.

Verification pattern:

```bash
androperator bundled-skills list
```

Expected signals:

- top-level `skills`
- top-level `count`
- top-level `installedDir`
- each listed agent-skill includes `name` and `skillPath`
- `skills[].name` includes `androperator-agent-orientation`
- `skills[].name` includes `androperator-agent-control-loop`
- `skills[].name` includes `androperator-upgrade`
- `skills[].name` includes `androperator-skill-author-by-agent-discovery`
- `skills[].name` includes `androperator-skill-author-by-recording`

## Local Skill Workspace

Create skills in a workspace you control, with a `skills/skills-registry.json`
registry and `skills/<skill_id>/` directories. Set
`ANDROPERATOR_SKILLS_REGISTRY` to its registry path, then run
`androperator skills new <skill_id>`. No separate skills catalog is required.
Optional bundled examples will be added separately.

## Authoring Skills Install

Authoring skills are AI agent programs that help create or maintain skills.
They are not runtime skills, and they are not loaded from
`skills-registry.json`.

Normal first-time users do not need to install them manually. The recommended
installer:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

already installs first-party bundled skills automatically.

If you bootstrap the CLI with `npm install -g androperator` instead, run
`androperator install` to perform the same post-bootstrap install flow.

Current install model:

| Surface | Path | Role |
| --- | --- | --- |
| Canonical bundled-skills store | `~/.androperator/bundled-skills/` | copied first-party bundled skills |
| Claude Code discovery dir | `~/.claude/skills/` | symlinks into the canonical store |
| Codex discovery dir | `$CODEX_HOME/skills/` | symlinks into the canonical store when `CODEX_HOME` is set |
| Codex default discovery dir | `~/.codex/skills/` | used when `CODEX_HOME` is unset |
| Generic agents discovery dir | `~/.agents/skills/` | managed real directory copies for generic agent runtimes |
| Managed-copy marker | `~/.agents/skills/<skill_name>/.androperator-managed` | ownership marker used before refreshing or removing Androperator-managed generic agents copies |

Current packaged first-party bundled skills:

| Skill | Role | Boundary |
| --- | --- | --- |
| `androperator-agent-orientation` | first-run orientation | Routes an unfamiliar host agent to the correct Androperator front door and canonical docs without redefining the contracts. |
| `androperator-upgrade` | whole-product upgrade route | Checks `androperator --version`, verifies Node 24+, npm reachability, and Java 17/21, then uses `npm install -g androperator@latest`, `androperator install`, and `androperator doctor`. Uses `install.sh` only as recovery when the CLI is not reachable or the bootstrap prerequisites need repair. |
| `androperator-agent-control-loop` | adaptive execution and explicit orchestrated authoring | Bounded observe, decide, act and verify guidance with optional provider delegation. |
| `androperator-skill-author-by-agent-discovery` | zero-results front door | Produces one discovery artifact, chooses exactly one next step, and does not author a durable runtime skill directly. |
| `androperator-skill-author-by-recording` | proving workflow | Records a real device flow, authors one skill shape, and runs one self-test that surfaces the emitted `SkillResult`. |

Maintenance and repair commands:

| Command | Use it when | First-run requirement |
| --- | --- | --- |
| `androperator bundled-skills install` | repair a missing install, or manually bootstrap bundled skills without `install.sh` | no |
| `androperator bundled-skills update` | re-copy and re-wire bundled skills after `npm install -g androperator@latest` or after local conflicts are resolved | no |
| `androperator bundled-skills list` | inspect which bundled skills are installed and where their `SKILL.md` files live | no |

Current command behavior:

- `androperator bundled-skills install` copies packaged first-party bundled skills
  into `~/.androperator/bundled-skills/`, recreates discovery symlinks for
  Claude Code and Codex, and refreshes managed directory copies under
  `~/.agents/skills/`. Discovery directories are resolved to physical paths first;
  aliases of the same directory share one representation. Any group containing
  the generic agents location uses managed copies for all consumers.
- `androperator bundled-skills update` runs the same copy-and-wire flow but
  reports the result as an update rather than a first install
- rerunning either command repairs legacy Androperator-managed symlinks under
  `~/.agents/skills/` by replacing them with managed real directories
- the installer refuses to overwrite a non-Androperator entry in any shared
  discovery directory; generic agents directories are considered
  Androperator-managed when they contain the valid `.androperator-managed` marker.
  Unmarked directories that exactly match a known first-party bundled skill
  version are moved to a unique timestamped directory under
  `~/.androperator/bundled-skills-backups/` before replacement. Modified files,
  extra files, and symlinks inside unmarked copies prevent automatic migration.
  When discovery and backup directories are on different filesystems, the updater
  copies and verifies the backup before removing the original. A copy or
  verification failure preserves the original and reports the backup path.
- install and update return `discoveryGroups` with each physical `dir`, logical
  `aliases` (`label` and `dir`), and selected `representation` (`copy` or `symlink`).
  `migrations` records each `originalPath` and `backupPath`; it is empty when no
  backups were needed. Existing `agentDiscoveryDirs` fields remain available.
- before reporting success, install and update verify every discovery entry
  using Doctor's ownership check. A failed check returns
  `BUNDLED_SKILLS_INSTALL_FAILED` with the entry path, representation, and issue;
  completed migrations are included in the error explanation
- `androperator bundled-skills list` reports installed skill names and the
  absolute `SKILL.md` path for each installed bundled skill
- the current packaged install set contains
  `androperator-agent-orientation`, `androperator-upgrade`,
  `androperator-skill-author-by-agent-discovery`, and `androperator-skill-author-by-recording`

Current doctor behavior:

- `androperator doctor` includes `host.bundled-skills.staleness`
- if `~/.androperator/bundled-skills/` does not exist, doctor reports
  `pass` with `Bundled-skills not yet installed.`
- if the installed bundled-skills state exists but is stale, incomplete, or
  malformed, doctor reports `warn`
- Doctor resolves the same directory aliases as the installer and accepts managed
  copies for Claude Code or Codex when their directory aliases the agents location.
- current warning conditions include:
  - `version.txt` is missing, empty, unreadable, or does not match the current
    CLI version
  - `~/.androperator/bundled-skills/` exists but is not a directory, or is a
    dangling symlink
  - one or more packaged first-party bundled-skill directories are missing
    from the canonical install store
  - Claude Code or Codex discovery symlinks are missing, broken, conflicting,
    or no longer point at `~/.androperator/bundled-skills/<skill_name>`
  - generic agents discovery copies are missing, conflicting, unmarked, stale,
    or still present as legacy Androperator-managed symlinks
- recommended remediation for those `warn` states is
  `androperator bundled-skills update`
- if the install path itself is malformed and cannot be repaired in place,
  remove or rename the conflicting path and then run
  `androperator bundled-skills install`

Verification pattern:

```bash
androperator bundled-skills list
androperator doctor
```

Expected signals:

- `bundled-skills list` returns `installedDir` as
  `~/.androperator/bundled-skills/` or the resolved absolute equivalent on the
  current host
- `doctor` includes a check with
  `"id": "host.bundled-skills.staleness"`

## Recording-Driven Workflow Stance

When you create a skill from a recording, use these current authoring rules:

- use the `androperator-skill-author-by-recording` skill as the proving workflow after
  discovery returned `proceed_to_recording`, or when the route is already well
  understood
- start from the user's plain-language goal, not from a final prechosen
  `skill_id`
- derive the first-pass `skill_id` after inspecting the recording evidence
- author one skill shape per pass unless the caller explicitly asks for both
- treat replay and orchestrated as equally valid maintained skill shapes
- choose replay first when replay still looks truthful for the captured flow
- choose orchestrated immediately when replay would already be misleading,
  brittle, or insufficient
- treat a personalized local skill as a valid first result when the flow
  depends on one user's labels, rooms, or device graph

These are the current documented rules for recording-derived authoring. They
should stay aligned with the `androperator-skill-author-by-recording` skill.

## Discovery And Recording Boundary

Keep the two front doors distinct:

- `androperator-skill-author-by-agent-discovery` is the agent-driven zero-results route when
  runtime-skill discovery found no clear match
- `androperator-skill-author-by-recording` is the proving workflow where the user performs
  the recorded phone flow once recording starts
- discovery may hand off route notes, mutation notes, classification, and
  setup caveats, but it should not silently turn recording into continued
  autonomous device driving
- if you already know the route well enough to skip discovery, the recording
  workflow is still user-performed once recording begins

## Sources

- Scaffold implementation: `apps/node/src/domain/skills/scaffoldSkill.ts`
- Artifact compilation: `apps/node/src/domain/skills/compileArtifact.ts`
- Validation: `apps/node/src/domain/skills/validateSkill.ts`
- Runtime invocation: `apps/node/src/domain/skills/runSkill.ts`
- Runtime env resolution: `apps/node/src/domain/skills/skillsConfig.ts`
- CLI surface: `apps/node/src/cli/commands/skills.ts`
- Bundled-skills CLI discovery: `apps/node/src/cli/registry.ts`, `apps/node/src/cli/commands/bundledSkills.ts`

## Validation And Testing Boundary

Use `androperator skills validate` as the static gate. Use your workspace tests for off-device logic and a real device for live proof.

Current `validateSkill` coverage:

- checks `skill.json` parity against the registry entry
- checks required file presence
- checks `androperator-skill-type` frontmatter in `SKILL.md`
- validates artifact payloads only under `--dry-run`

Use `androperator skills validate --all` to check generated-index freshness when
the validated repo includes `scripts/generate_skill_indexes.sh`.

Current `validateSkill` non-goals:

- it does not replace `./scripts/test_all.sh` for pure off-device JS logic
- it does not replace live-device proof for selector, navigation, recording,
  compare-baseline, checkpoint, or terminal-verification behavior
- it does not replace the repo-local checklist in `local skill workspace/AGENTS.md`

Use this route when hardening a runtime skill:

1. Discover installed guided authoring workflows with
   `androperator bundled-skills list` when you need a host-visible
   front door and runtime-skill discovery returned no relevant match.
2. Start with `androperator-skill-author-by-agent-discovery`, then move to
   `androperator-skill-author-by-recording` only after discovery returns
   `proceed_to_recording`, or when the route is already well understood.
3. Scaffold only when you want the low-level manual surface:
   `androperator skills new <skill_id>`.
4. Run `androperator skills validate <skill_id> --dry-run` for skill-local file,
   metadata, and artifact checks.
5. Regenerate indexes with `./scripts/generate_skill_indexes.sh` in
   `local skill workspace` when registry-linked metadata changes.
6. Run `androperator skills validate --all --dry-run` after regenerating those
   indexes.
7. Run `./scripts/test_all.sh` in `local skill workspace` when the change touches
   pure off-device JS logic.
8. Prove UI behavior on a real target device or emulator when the change affects
   selectors, navigation, checkpoints, compare baselines, or terminal
   verification.

## What A New Skill Contains

`androperator skills new <skill_id>` creates:

- `SKILL.md`
- `skill.json`
- `scripts/run.js`
- `scripts/run.sh`

and appends a new entry to the active skills registry.

The scaffold writes exact relative paths:

- `skills/<skill_id>/SKILL.md`
- `skills/<skill_id>/skill.json`
- `skills/<skill_id>/scripts/run.js`
- `skills/<skill_id>/scripts/run.sh`

When `--recording-context <file>` is provided, the scaffold also copies the source file to:

- `skills/<skill_id>/recording-context.json`

The success payload includes that copied path and the `files` array lists it.

It also appends this exact registry shape:

```json
{
  "id": "com.example.demo.capture-state",
  "applicationId": "com.example.demo",
  "intent": "capture-state",
  "summary": "TODO: describe com.example.demo.capture-state",
  "path": "skills/com.example.demo.capture-state",
  "skillFile": "skills/com.example.demo.capture-state/SKILL.md",
  "scripts": [
    "skills/com.example.demo.capture-state/scripts/run.js",
    "skills/com.example.demo.capture-state/scripts/run.sh"
  ],
  "artifacts": [],
  "contract": {
    "inputs": {},
    "goal": null,
    "verification": null
  }
}
```

## Skill ID Rules

The scaffold command requires `skill_id` to contain at least one dot, and the final segment cannot be empty.

Why:

- the scaffold derives `applicationId` from everything before the final dot
- it derives `intent` from everything after the final dot

Example:

| Skill id | Derived `applicationId` | Derived `intent` |
| --- | --- | --- |
| `com.android.settings.capture-overview` | `com.android.settings` | `capture-overview` |

If the id has no dot, scaffolding fails with `SKILL_ID_INVALID`.

Exact failure shape:

```json
{
  "code": "SKILL_ID_INVALID",
  "message": "skill_id must contain at least one dot so applicationId and intent can be derived"
}
```

## Recording Context

`androperator skills new <skill_id> --recording-context <file>` copies the provided export file verbatim to `skills/<skill_id>/recording-context.json`.

What that file is for:

- it is reference evidence for an external human or agent authoring the skill
- it is not an executable recipe
- `scaffoldSkill()` does not infer selectors, parameters, or control flow from it
- the source file must already match the recording export artifact schema
- `skills validate` does not inspect `recording-context.json`; it still validates only the registry-linked skill files

Practical authoring workflow:

- before recording, identify the target app or apps and close them so the
  capture starts from a fresh app state rather than a half-explored mid-flow
  screen
- after `record stop`, run `record pull` first and retain the local NDJSON file
- generate `recording export` from that pulled file or directory before any
  optional `record parse` inspection
- scaffold with `--recording-context` from the retained export, not from the
  parsed step log
- treat `recording-context.json` as authoring evidence that helps you design
  the skill, not as a skill that only needs light cleanup

Recommended source:

- use `androperator recording export --snapshots omit` by default when the goal is agent or human authoring context
- use `--snapshots include` only when the author genuinely needs the raw XML snapshots for manual inspection
- the parsed `recording parse` output is not a substitute for `recording-context.json`
- `recording parse` is a lossy step log, while `recording export` preserves the raw event timeline and package-transition evidence
- recording-derived selectors and path hints are starting evidence only; the
  authored skill still needs explicit control flow and truthful terminal
  verification
- the saved `androperator skills run` JSON wrapper is the v1 compare input for `androperator recording compare --result <file>`
- the recording export baseline is reference evidence for compare and authoring, not a runtime input passed to the skill

Recording-derived authoring truthfulness:

- the export is evidence, not a complete recipe
- authors may need live snapshots, fresh UI reads, or one-off inspection to
  refine selectors and verification
- if live inspection materially informed the authored route, say so in
  `SKILL.md` instead of implying the recording alone was sufficient
- do not over-claim `from scratch` if the author reused nearby same-app skills,
  fixtures, or shared helpers while drafting the result
- if the first recording looked exploratory, stateful, or obviously
  suboptimal, capture an additional pass instead of pretending one recording
  is a reliable baseline

Personalized versus shared skills:

- a recording-derived skill can be a valid personalized local first outcome
- use [Personalized Skills](personalized-skills.md) for the full local-versus-shared
  policy, privacy boundaries, promotion checklist, and verification rules
- keep recording-specific notes in the authored `SKILL.md`: what came from the
  recording, what needed live inspection, and what remains local-only

Authoring mode terminology:

- `from scratch` means do not consult same-app exemplar skills while authoring
- `assisted from nearby patterns` means exemplar reuse is allowed, but the
  authored skill must still be truthful about what came from the recording and
  what came from nearby references
- if you used nearby exemplars, say so in the authoring notes or `SKILL.md`
  rather than presenting the result as recording-only synthesis

Recommended exemplar inspection:

Use optional examples under `examples/skills/` when they become available.
The initial references will demonstrate Codex-only Settings orchestration and
bounded Jev delegation; importing those examples is deferred beyond the rename.
Validate each authored skill and prove its UI behavior on its intended device.

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.
```

Success output with recording context adds the copied path:

```json
{
  "created": true,
  "skillId": "com.example.recording.export-demo",
  "registryPath": "/abs/path/to/skills/skills-registry.json",
  "skillPath": "/abs/path/to/skills/com.example.recording.export-demo",
  "recordingContextPath": "/abs/path/to/skills/com.example.recording.export-demo/recording-context.json",
  "files": [
    "/abs/path/to/skills/com.example.recording.export-demo/SKILL.md",
    "/abs/path/to/skills/com.example.recording.export-demo/skill.json",
    "/abs/path/to/skills/com.example.recording.export-demo/scripts/run.js",
    "/abs/path/to/skills/com.example.recording.export-demo/scripts/run.sh",
    "/abs/path/to/skills/com.example.recording.export-demo/recording-context.json"
  ],
  "next": "Edit `SKILL.md` and `scripts/run.js`, then run `androperator skills validate <skill_id>`; if this repo uses generated indexes, rerun `scripts/generate_skill_indexes.sh` and `androperator skills validate --all`"
}
```

Verification:

```bash
androperator skills new com.example.recording.export-demo --recording-context ./recordings/export-demo.export.json
```

Check:

- `recordingContextPath` points at the copied file inside the new skill folder
- the copied file contents match the source export file byte-for-byte
- `skill.json.artifacts` remains `[]`

Failure modes:

- blank `--recording-context` values: `SKILLS_SCAFFOLD_FAILED`
- missing or unreadable source file: `SKILLS_SCAFFOLD_FAILED`
- non-export JSON or malformed export artifacts: `SKILLS_SCAFFOLD_FAILED`
- the scaffold does not derive skill logic from the recording context

## `SKILL.md` Format

The current scaffold writes `SKILL.md` with YAML frontmatter:

```markdown
---
name: com.android.settings.capture-overview
androperator-skill-type: replay
description: |-
  Capture a Settings overview snapshot
---

Starter scaffold for `com.android.settings.capture-overview`.
```

The scaffold always writes the frontmatter as a YAML block scalar under `description: |-`. That matters for multi-line summaries because `indentYamlBlockScalar()` preserves embedded lines without collapsing them:

```markdown
---
name: com.example.multiline.capture
androperator-skill-type: replay
description: |-
  Line1
  Line2: has colon
  - list-looking line
  # looks like a comment
---
```

Current reality:

- the scaffold writes `name`, `androperator-skill-type`, and `description`
- `validateSkill` now reads `SKILL.md` frontmatter enough to require
  `androperator-skill-type`
- `validateSkill` still does not treat `SKILL.md` as a full schema beyond that
  frontmatter check

Current skill-type convention:

- current active values are `replay` and `orchestrated`
- new and updated skills should declare one of those values in `SKILL.md`
  frontmatter
- the validator enforces those values for current authoring work
- `script` is accepted only for `au.com.polyaire.airtouch5.set-zone-state`;
  do not use `script` for new work

Recommended current practice:

- use a `-replay` id suffix for replay-oriented baseline skills
- use a `-orchestrated` id suffix for agent-controlled skills
- when a skill follows one of those conventions, keep the frontmatter `androperator-skill-type` value aligned with the id suffix

So the minimum current `SKILL.md` contract is:

- `SKILL.md` exists
- the registry entry points to it correctly
- the frontmatter declares `androperator-skill-type`

The scaffold's usage section is a starting point, not a machine-enforced schema.

For agent-driven orchestrated skills, `SKILL.md` is also the runtime agent
program. In that shape:

- `scripts/run.js` should stay a thin harness
- the harness spawns the configured agent CLI from `skill.json.agent`
- the runtime agent uses Androperator as the hand
- the runtime agent emits exactly one terminal `[Androperator-Skill-Result]` frame
- the currently supported orchestrated runtime path uses `codex` as the agent CLI
- some orchestrated harnesses currently run codex with `danger-full-access` so the runtime agent can reach live adb targets, but that is a harness-specific choice rather than a Node runtime guarantee

<a id="writing-agent-instructions"></a>
## Writing Agent Instructions

Write for a capable agent while preserving Androperator's exact runtime
contracts. These are authoring recommendations, not additional validator rules.

- Keep the description short: name the capability and the request that should
  select it. Avoid broad app or domain keywords that attract unrelated tasks.
- Put the intended outcome, inputs, essential constraints, completion evidence,
  and relevant routing in `SKILL.md`.
- Link substantial mode-specific examples and troubleshooting from supporting
  references, with a reason to read each. Keep a simple skill self-contained.
  Before relying on references at runtime, verify the configured agent harness
  can access them; do not assume links are automatically loaded.
- Retain exact output frames, input constraints, serialized device commands,
  and terminal verification rules. Concise instructions do not relax these
  contracts.
- Describe checkpoints and meaningful state transitions. Prescribe exact
  navigation only where app behavior requires it; let an orchestrated agent
  continue from an already-valid UI state.
- Keep deterministic replay steps and parsing in their existing executable
  contracts. Do not replace them with agent guesswork.
- Preserve the user's requested values and existing authorization. A skill
  should not broaden the task, select a different target merely for testing,
  or add repeated approval pauses for already-authorized steps.
- Define when the goal is complete and when recovery should stop, including
  runtime budgets and cases where success cannot be verified.

For meaningful instruction changes, try representative requests and check
observable outcomes, including an already-satisfied target and a recoverable
intermediate state where relevant. Structural validation alone cannot prove
that the agent selected the right workflow, stayed in scope, or verified success.

## `skill.json` Contract

`skill.json` is stricter than `SKILL.md`. Validation compares its parsed fields against the registry entry.

Important current rule:

- `skill.json` metadata must match the registry entry exactly for these fields:
  - `id`
  - `applicationId`
  - `intent`
  - `summary`
  - `path`
  - `skillFile`
  - `scripts`
  - `artifacts`
- `agent` is intentionally excluded from this parity check. `skill.json.agent` is trusted runtime config, not registry identity metadata.
- other `skill.json` fields are allowed, but the current validator does not
  compare or enforce them

Current orchestrated-skill extension:

- `skill.json.agent` is an optional runtime block for agent-driven skills
- current supported fields are:
  - `cli` required string
  - `cliPath` optional string or null
  - `timeoutMs` optional positive integer
- if `agent` is present, `runSkill()` resolves the configured CLI before spawn
- if the CLI is unavailable, `runSkill()` returns `SKILL_AGENT_CLI_UNAVAILABLE`
- the harness still owns the direct agent spawn; `runSkill()` executes `scripts/run.js`

Current contract declaration extension:

- `skill.json.contract` is optional
- when present, the v1 shape is:
  - `inputs`: object map of input names to simple schema strings
  - `goal`: object with required `kind` plus any extra JSON fields, or `null`
  - `verification`: currently `null` or:
    ```json
    {
      "kind": "node_text_matches",
      "matcher": "Discharge to {percent}%"
    }
    ```
- the scaffold writes a present-but-empty block by default:
  ```json
  "contract": {
    "inputs": {},
    "goal": null,
    "verification": null
  }
  ```
- a missing `contract` block means there is no declaration enforcement
- a present-but-empty `contract` block is allowed and validates, but is treated the same as missing until an author fills a meaningful field
- `skill.json.contract` participates in registry parity checks, unlike `agent`

If any of those differ, validation fails with `SKILL_VALIDATION_FAILED`.

Literal authored `skill.json` example:

```json
{
  "id": "com.example.demo.capture-state",
  "applicationId": "com.example.demo",
  "intent": "capture-state",
  "summary": "TODO: describe com.example.demo.capture-state",
  "path": "skills/com.example.demo.capture-state",
  "skillFile": "skills/com.example.demo.capture-state/SKILL.md",
  "scripts": [
    "skills/com.example.demo.capture-state/scripts/run.js",
    "skills/com.example.demo.capture-state/scripts/run.sh"
  ],
  "artifacts": [],
  "contract": {
    "inputs": {},
    "goal": null,
    "verification": null
  }
}
```

## Declared Verification And `indeterminate`

When a skill declares `contract.verification`, `runSkill()` cross-checks that
declaration against the parsed `skillResult`.

Current v1 rule:

- if the declared verification is proved, the run returns `status: "success"`
- if the skill exits without upstream runtime failure but does not prove the declared verification, the run returns `status: "indeterminate"`
- if the skill emits `skillResult.status: "failed"` for a declared-verification run, the run returns a normal failure result

For `node_text_matches`, the runtime currently requires:

- `skillResult.terminalVerification.status === "verified"`
- the declared `matcher` is rendered from trusted invocation inputs, preferring named flags that match declared input names in kebab-case form such as `unit_name -> --unit-name`, then falling back to trailing positional arguments forwarded by `androperator skills run` in deterministic lexicographic order of `contract.inputs`; `--` is not required for ordinary positional args, but can be used to keep wrapper-known flags such as `--timeout` or `--expect-contains` from being consumed by the wrapper, and to force tokens that would otherwise be intercepted by the top-level CLI or wrapper to be forwarded positionally; for example, `--help` is intercepted unless it appears after the forwarding `--`, while standalone literals such as `--foo=bar` can still be forwarded for positional binding
- `skillResult.inputs` must agree with those trusted invocation inputs for the declared fields
- the observed terminal verification text matches the declared matcher after placeholder replacement; decorative trailing glyphs or punctuation in the observed text are allowed, but a different value or different leading text is not

This keeps `skill.json` claims tied to the shipped `SkillResult` contract instead
of inventing a second result channel.

Use `androperator skills validate <skill_id>` to verify the file paths
and metadata match. After rerunning generated indexes in repos that own them,
use `androperator skills validate --all` for the repo-wide freshness
check:

```bash
androperator skills validate com.example.demo.capture-state
```

Success response:

```json
{
  "valid": true,
  "skill": {
    "id": "com.example.demo.capture-state",
    "applicationId": "com.example.demo",
    "intent": "capture-state",
    "summary": "TODO: describe com.example.demo.capture-state",
    "path": "skills/com.example.demo.capture-state",
    "skillFile": "skills/com.example.demo.capture-state/SKILL.md",
    "scripts": [
      "skills/com.example.demo.capture-state/scripts/run.js",
      "skills/com.example.demo.capture-state/scripts/run.sh"
    ],
    "artifacts": []
  },
  "registryPath": "/abs/path/to/skills/skills-registry.json",
  "checks": {
    "skillJsonPath": "/abs/path/to/skills/com.example.demo.capture-state/skill.json",
    "skillFilePath": "/abs/path/to/skills/com.example.demo.capture-state/SKILL.md",
    "scriptPaths": [
      "/abs/path/to/skills/com.example.demo.capture-state/scripts/run.js",
      "/abs/path/to/skills/com.example.demo.capture-state/scripts/run.sh"
    ],
    "artifactPaths": []
  }
}
```

## Authoring Agent-Driven Orchestrated Skills

The authoritative definition of this runtime shape lives in
[Skills Overview](overview.md#orchestrated-runtime-contract).

When a skill follows the orchestrated runtime contract, the authoring split is:

- `SKILL.md` contains the runtime program for the agent
- `skill.json` carries the trusted `agent` metadata
- `scripts/run.js` is a thin harness that:
  - receives the forwarded script args from `androperator skills run`
  - reads `ANDROPERATOR_SKILL_PROGRAM`
  - reads `ANDROPERATOR_SKILL_INPUTS`
  - reads the resolved agent CLI path from `ANDROPERATOR_SKILL_AGENT_CLI_PATH`
  - spawns the configured agent CLI on `SKILL.md`
  - forwards stdout and stderr

The harness should not absorb skill logic that belongs in `SKILL.md`. If the
wrapper starts containing the real navigation or verification policy, the skill
has left the orchestrated runtime contract described in
[Skills Overview](overview.md#orchestrated-runtime-contract).

### Practical Authoring Rules

These rules are the durable lessons from building and stabilizing the first
real orchestrated skills.

- Treat recordings as evidence, not route authority.
- Keep the harness thin.
- Put app-specific route authority in `SKILL.md`, not in `scripts/run.js`.
- Make `SKILL.md` name the exact checkpoints and the terminal verification rule
  the runtime agent must satisfy.
- Use retained recording export plus live device observation to define the
  checkpoints and terminal verification that matter.
- Require one live Androperator device command at a time.
- Do not pipeline multiple live device commands for the same run.
- Make success depend on post-save or post-action verification, not on the
  input value that was requested.
- When the UI includes decorative trailing glyphs on a verified row, treat the
  semantic text as authoritative. For example, a read like
  `Discharge to 45% ` still verifies `Discharge to 45%`.
- Prefer several small `exec` payloads over one oversized payload when a flow
  crosses multiple app states.
- When the current UI is already inside the target app flow, continue from the
  current state instead of forcing a full restart path every time.
- Use the user's requested target value. If it is already set, verify that
  persisted state and report it accurately. In an explicitly authorized
  reliability test, choose a different value within the allowed test range
  when needed to prove a real mutation.

### What The Harness Should Do

For orchestrated skills, `scripts/run.js` should be responsible for runtime
plumbing only:

- read the injected env vars
- invoke the configured agent CLI on `SKILL.md`
- preserve stdout and stderr
- optionally retain per-run logs for local debugging

The harness should not become the second source of truth for:

- app navigation policy
- app-specific selectors or coordinates
- checkpoint names or checkpoint success criteria
- terminal verification semantics
- `SkillResult` schema authority

If the harness starts owning those concerns, future updates drift because the
agent is reading one definition while the wrapper is enforcing another.

### Debugging A Failed Orchestrated Run

When an orchestrated skill misbehaves, start with the minimum durable evidence
set before you rewrite the skill:

1. The saved `androperator skills run` JSON wrapper result for that exact run.
2. The forwarded agent stderr stream from that run.
3. The emitted `SkillResult.checkpoints`.
4. Compare output against the retained baseline, if the skill keeps
   `references/compare-baseline.export.json`.
5. Replay artifacts too, if the same flow has a replay sibling or other
   retained replay evidence.

That order matters:

- the wrapper result tells you whether the failure was wrapper-level,
  runtime-level, or a post-run verification mismatch
- stderr usually explains what the runtime agent believed it was doing
- `SkillResult.checkpoints` show how far the skill really progressed on device
- compare output tells you whether the run still reached the right terminal
  outcome, diverged mid-route, or failed before the expected checkpoint
- replay artifacts can help you separate an orchestrated runtime problem from a
  selector, route, or terminal-proof assumption shared across both shapes

If those do not explain the failure, read these next:

1. The retained per-run `prompt.txt`.
2. The retained agent stdout and stderr logs, if the harness kept them.
3. The retained run metadata file, if the harness kept it.
4. A direct `androperator snapshot` from the current screen when the run ended
   in an unexpected UI state.

Recommended current debugging support for orchestrated harnesses:

- keep a per-run `prompt.txt`
- keep the runtime agent stdout log
- keep the runtime agent stderr log
- keep a small `run-metadata.json` file describing device id, operator
  package, forwarded args, and output paths
- keep the saved wrapper JSON or an equivalent stderr/stdout capture for the
  exact `androperator skills run` invocation you are debugging

This matters because many orchestrated failures are not pure route failures.
Common failure shapes include:

- the agent planned but did not act enough
- the save flow had an extra confirmation prompt
- the app resumed from a mid-flow state the prompt did not account for
- the post-save verification read was correct but the matching rule was too
  strict
- two live commands overlapped and drove the UI out of order

The fastest path out of "flying blind" is to preserve the exact runtime prompt,
agent transcript, and final `SkillResult`, then confirm the visible device
state with a direct `snapshot`.

`androperator skills run` injects the orchestrated runtime env vars that the
harness reads. For the exact variable list and defaults, see
[Environment Variables](../api/environment.md#orchestrated-skill-runtime-env-vars).

If `skill.json` drifts from the registry, validation fails with `SKILL_VALIDATION_FAILED` and names the mismatched fields:

```json
{
  "code": "SKILL_VALIDATION_FAILED",
  "message": "Skill com.example.demo.capture-state metadata does not match the registry entry",
  "details": {
    "skillJsonPath": "/abs/path/to/skills/com.example.demo.capture-state/skill.json",
    "mismatchFields": [
      "summary",
      "scripts"
    ]
  }
}
```

## Run Script Contract

Current runtime rules from `runSkill.ts`:

- the wrapper loads the registry entry
- it chooses the first `.js` script if present
- otherwise it chooses the first `.sh` script
- if neither exists, it uses the first script entry

Invocation rules:

- `.js` scripts are run with `process.execPath`
- other scripts are spawned directly
- stdout and stderr are captured separately
- success requires subprocess exit code `0`

## Non-Trivial Skill Success Rules

For non-trivial skills, reaching the end of the script is not enough to claim
success.

Required current rule:

- if an underlying `androperator exec` call fails, the skill must exit non-zero
- a non-trivial skill must verify the intended terminal app state before it
  reports success
- success should mean "the requested state was actually observed", not merely
  "the script finished running"

This guidance is intentionally general. The exact verification step depends on
the app and workflow, but the rule does not: success should reflect verified
state, and execution failure should remain visible to the caller.

The scaffolded `run.js` contract is:

```text
node run.js <device_id> [operator_package]
```

The scaffold writes an exact default `run.js` payload shape:

```json
{
  "commandId": "com.example.demo.capture-state-<Date.now()>",
  "taskId": "com.example.demo.capture-state",
  "source": "com.example.demo.capture-state",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "close",
      "type": "close_app",
      "params": {
        "applicationId": "com.example.demo"
      }
    },
    {
      "id": "wait_close",
      "type": "sleep",
      "params": {
        "durationMs": 1500
      }
    },
    {
      "id": "open",
      "type": "open_app",
      "params": {
        "applicationId": "com.example.demo"
      }
    },
    {
      "id": "wait_open",
      "type": "sleep",
      "params": {
        "durationMs": 3000
      }
    },
    {
      "id": "snap",
      "type": "snapshot"
    }
  ]
}
```

Notes on those literals:

- `taskId` is the literal `skillId`
- `commandId` is `${skillId}-${Date.now()}`
- the default `operatorPackage` fallback inside the scaffolded script is `com.androperator.operator`
- the child process timeout inside scaffolded `run.js` is `120000`
- the scaffolded script includes local `resolveAndroperatorBin()` and
  `resolveOperatorPackage()` helpers instead of requiring `skills/utils/common.js`
- the local command resolver honors `ANDROPERATOR_BIN`, checks
  `ANDROPERATOR_CLI_PATH`, prefers a detected branch-local `apps/node/dist/cli/index.js`
  when present, and may contribute both a command and parsed helper args before
  `exec`
- the scaffolded `sleep` actions are starter placeholders for app close/open
  settling; replace them with app-specific readiness checks before treating a
  non-trivial skill as authored

The scaffolded `run.sh` just forwards to `run.js`.

Current wrapper expectations:

- device id is passed as the first positional arg when the caller used `skills run --device ...`
- `ANDROPERATOR_BIN` is available in the environment
- `ANDROPERATOR_OPERATOR_PACKAGE` is available in the environment

Important boundary:

- the wrapper injects `ANDROPERATOR_BIN`, and the scaffolded default `run.js`
  reads it through its local `resolveAndroperatorBin()` helper
- direct `node run.js ...` execution also prefers a detected branch-local
  `apps/node/dist/cli/index.js` when available, before falling back to the
  global `androperator` binary
- the scaffolded script has no repo-level `skills/utils/common.js` dependency

Generated scripts forward child stdout and stderr once, including successful
stderr, and preserve numeric nonzero exit codes. Printable output, including
valid JSON, never changes a failed process into success. Signals, timeouts,
spawn failures, and unusable exit statuses produce exit code `1` with available
output and a concise stderr reason. Successful stdout is forwarded unchanged.

This behavior applies to newly generated scripts. Existing skills are not
silently regenerated; update older wrappers that convert child failures into
exit code `0` when adopting this behavior.

## Structured Skill Result Contract

Current runtime behavior from `apps/node/src/contracts/skillResult.ts` and
`apps/node/src/domain/skills/runSkill.ts`:

- `runSkill()` recognizes a skill-level framed result marker:
  `[Androperator-Skill-Result]`
- the v1 frame is two lines at the end of stdout:
  - line 1: the marker exactly
  - line 2: one JSON object line
- any non-whitespace stdout after the JSON line makes the frame malformed in v1
- multiple frames are rejected
- malformed framed output is rejected with `SKILL_RESULT_PARSE_FAILED`
- skills must emit one framed `SkillResult` for structured agent consumption

The emitted frame must not contain `source`. `runSkill()` injects it after
parsing:

- scripted skills get `source: { "kind": "script" }`
- skills whose `skill.json` contains `agent.cli` get
  `source: { "kind": "agent", "agentCli": "<cli>" }`
- framed `SkillResult` output requires readable trusted metadata from the
  skill's `skill.json`; if that metadata cannot be read or parsed, the runtime
  rejects the frame with `SKILL_RESULT_PARSE_FAILED` instead of guessing
  provenance

Current v1 `SkillResult` fields:

- **discoverable domain answer (emitted first in nested JSON):**
  - `result` (`SkillCheckpointEvidence` or `null` when no truthful value exists)
- required:
  - `contractVersion`
  - `skillId`
  - `status`
  - `checkpoints`
- injected by `runSkill()`:
  - `source`
- also optional:
  - `goal`
  - `inputs`
  - `terminalVerification`
  - `execEnvelopes`
  - `diagnostics`

**Authoring best practices for `result` and proof fields:**

- Every framed skill emits `result` with a `SkillCheckpointEvidence` value, or
  `result: null` when no truthful domain value exists.
- Put **`result` before `status`** in emitted JSON so humans and agents scan the
  answer first.
- Use the evidence union only: `kind: "text"`, `kind: "json"`, or
  `kind: "result_envelope_ref"`. Collections go in a singular `result`, for
  example `{ "kind": "json", "value": { "items": [...] } }`.
- **`terminalVerification`** is proof of final state, not the primary answer
  channel. Duplicate values into `result` when the same value is both the answer
  and the proof.
- **`diagnostics`** is for `runtimeState`, warnings, hints, paths, and debug
  metadata only, not a parallel copy of the return value.
- For non-trivial flows, prefer **map or state-machine checkpoints**: include
  expected checkpoint ids and mark unreached steps `skipped` instead of omitting
  nodes, when the skill needs a complete progress map.

Current status enums:

- top-level `status`: `success`, `failed`, `indeterminate`
- checkpoint `status`: `ok`, `failed`, `skipped`
- `diagnostics.runtimeState`: `healthy`, `poisoned`, `unavailable`, `unknown`

Current typed checkpoint evidence kinds:

- `text`
- `json`
- `result_envelope_ref`

Minimal framed example (note `result` before `status`):

```text
[Androperator-Skill-Result]
{"contractVersion":"1.0.0","skillId":"com.example.demo.capture-state","result":{"kind":"text","text":"40%"},"status":"success","checkpoints":[{"id":"terminal_state_verified","status":"ok","evidence":{"kind":"text","text":"Discharge to 40%"}}],"terminalVerification":{"status":"verified","expected":{"kind":"text","text":"Discharge to 40%"},"observed":{"kind":"text","text":"Discharge to 40%"}}}
```

Current authoring rule for new non-trivial skills:

- emit a framed `SkillResult`
- keep process exit truthful
- use `terminalVerification` when the skill claims a persisted app-state
  change
- choose stable named user-facing inputs early and keep them aligned across:
  - `skill.json.contract.inputs`
  - `SKILL.md` usage examples
  - script argument parsing and emitted `skillResult.inputs`
- avoid positional-only public interfaces for non-trivial skills unless the
  contract is genuinely single-purpose and obvious
- if the skill is authored from a retained recording baseline, save a
  `skills run` wrapper for the run you want to compare and feed that
  wrapper directly to `androperator recording compare`
- design replay and scripted skills for daemon-backed polling, not arbitrary
  time padding:
  - split long recorded routes into the smallest execution calls that preserve
    truthfulness
  - use `wait_for_node`, `read_text`, `snapshot`, or bounded polling loops
    to observe readiness and terminal state
  - stop as soon as the expected UI state is observed
  - keep fixed `sleep` actions only when there is no observable state to poll,
    and document that reason in `SKILL.md`
  - pass an explicit execution timeout to nested `androperator exec` calls when
    a multi-step payload can legitimately run longer than the CLI default
  - use the wrapper-injected `ANDROPERATOR_BIN` so nested calls run through the
    same local Androperator implementation and daemon support as the outer
    `skills run`

Current compare contract for authored skills:

- compare reads the saved wrapper's top-level `skillResult`
- compare auto-selects `semantic` mode for `skillResult.source.kind == "agent"`
- compare auto-selects `literal` mode for `skillResult.source.kind == "script"`
- compare uses `terminalVerification` as the final-state proof channel
- compare classifies `diagnostics.runtimeState == "poisoned"` as
  `runtime_poisoned`
- compare classifies `diagnostics.runtimeState == "unavailable"` as
  `runtime_unavailable`
- compare expects the baseline input to be a recording export artifact such as `references/compare-baseline.export.json`, not a parsed `recording parse` step log
- compare accepts the full `skills run` JSON wrapper as the durable `--result` input, not a hand-edited bare `SkillResult`
- replay-style runs can succeed as `literal_match`
- agent-driven runs can succeed as either `semantic_match` or `outcome_matches_path_differs`
- v1 compare trust is enforced by fixture-backed Solax regression coverage, not by a generic per-skill compare contract

Version handling:

- same major version with a newer minor version is accepted
- a different major version is rejected with `SKILL_RESULT_PARSE_FAILED`

### Run Script Verification

Validate the registry entry first, then run the scaffolded skill through the wrapper:

```bash
androperator skills validate com.example.demo.capture-state --dry-run
androperator skills run com.example.demo.capture-state --device <device_serial>
```

For the run result, verify:

- for default JSON **success**, top-level `skillId` and `output` are
  **omitted**; read **`skillResult.result`** for the answer and
  `skillResult.skillId` for identity
- when `output` is present on **SKILL_OUTPUT_ASSERTION_FAILED**, it is raw
  stdout, including the frame line when the skill prints one
- `skillResult` is the parsed structured result object

If the script exits non-zero, `skills run` returns `SKILL_EXECUTION_FAILED` and
preserves `stdout`, `stderr`, `exitCode`, and any parsed `skillResult`.

If the script emits a malformed frame, `skills run` returns
`SKILL_RESULT_PARSE_FAILED`.

### Non-Trivial Skill Rule

For non-trivial skills, treat process success as a proof obligation, not just
an implementation detail.

Working definition:

- a skill is `non-trivial` when successful script execution is not enough to
  prove the claimed outcome
- this usually means the skill changes app state, crosses multiple UI
  transitions, or can fail silently while still appearing to have run
- a read-only or capture-only skill is often trivial; a state-changing skill
  should be assumed non-trivial unless proven otherwise

Current authoring expectation:

- if an underlying nested `androperator exec` call fails, the skill script must
  exit non-zero rather than translating the failure into a "successful" skill run
- if the skill's purpose is to change app state, the skill should verify the
  intended terminal state before reporting success
- if the immediate post-action UI is known to be stale or delayed, re-open or
  re-read the relevant controller before claiming terminal verification
- if replay cannot truthfully prove the persisted state after a reasonable
  re-read strategy, prefer an orchestrated or otherwise richer verification
  path instead of claiming replay success

Examples of terminal-state verification:

- re-read the row or field the skill changed and confirm it matches the
  requested value
- re-open the relevant dialog or screen and confirm the persisted state is
  present

Do not assume that "the taps and text entry ran" is enough evidence for a
non-trivial skill. If the skill changes state, prefer proving the state.

## Artifact Compilation

Current compile command:

```bash
androperator skills compile-artifact <skill_id> --artifact <name> [--vars <json>]
```

What `compileArtifact()` does:

1. load the registry
2. find the skill
3. resolve the artifact path
4. parse `--vars` JSON into string values with `String(v)` coercion
5. add deterministic `COMMAND_ID` and `TASK_ID` if they were not supplied
6. substitute `{{VAR}}` placeholders in the artifact template
7. parse the result as JSON
8. validate it as an execution payload
9. set `execution.mode = "artifact_compiled"`

Placeholder rules are exact:

- every placeholder must have a non-empty value
- values are JSON-escaped before substitution
- missing vars fail with `COMPILE_VAR_MISSING`

Deterministic id rule:

- if `COMMAND_ID` and `TASK_ID` are absent, the compiler derives them from a sha256 hash of `skillId`, normalized artifact name, and sorted vars

Compile success example:

```json
{
  "execution": {
    "commandId": "cmd-1a2b3c4d5e6f",
    "taskId": "task-1a2b3c4d5e6f",
    "source": "com.android.settings.capture-overview",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "snap",
        "type": "snapshot"
      }
    ],
    "mode": "artifact_compiled"
  }
}
```

The generated IDs are deterministic for the tuple:

- `skillId`
- normalized artifact name with any trailing `.recipe.json` removed
- `vars` sorted by key

So `climate-status` and `climate-status.recipe.json` produce the same default `commandId` and `taskId`.

### Artifact Compilation Verification

Run the compiler with JSON output, then validate the result as a normal execution payload:

```bash
androperator skills compile-artifact com.google.android.apps.chromecast.app.get-climate --artifact climate-status --vars '{"CLIMATE_TILE_NAME":"Master"}'
```

Success shape:

```json
{
  "execution": {
    "commandId": "cmd-1a2b3c4d5e6f",
    "taskId": "task-1a2b3c4d5e6f",
    "source": "com.google.android.apps.chromecast.app.get-climate",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "snap",
        "type": "snapshot"
      }
    ],
    "mode": "artifact_compiled"
  }
}
```

Check these exact fields:

- `execution.mode` is always set to `"artifact_compiled"` after validation succeeds
- `commandId` starts with `cmd-`
- `taskId` starts with `task-`
- the payload is valid input to `androperator exec --validate-only`

### Artifact Compilation Error Cases

Top-level usage failure:

```json
{
  "code": "USAGE",
  "message": "skills compile-artifact requires <skill_id> (positional) or --skill-id <id>, and --artifact <name>. Example: skills compile-artifact com.example.skill --artifact climate-status [--vars '{}']"
}
```

Compile failures from `compileArtifact()` are exact:

```json
{
  "code": "ARTIFACT_NOT_FOUND",
  "message": "Artifact not found: climate-status (skill: com.google.android.apps.chromecast.app.get-climate)",
  "details": {
    "skillId": "com.google.android.apps.chromecast.app.get-climate",
    "artifactName": "climate-status"
  }
}
```

```json
{
  "code": "COMPILE_VARS_PARSE_FAILED",
  "message": "Invalid --vars JSON",
  "details": {
    "varsJson": "{bad json}"
  }
}
```

```json
{
  "code": "COMPILE_VAR_MISSING",
  "message": "Missing required variable: CLIMATE_TILE_NAME",
  "details": {
    "placeholder": "CLIMATE_TILE_NAME",
    "skillId": "com.google.android.apps.chromecast.app.get-climate",
    "artifactName": "climate-status"
  }
}
```

```json
{
  "code": "COMPILE_VALIDATION_FAILED",
  "message": "[object Object]",
  "details": {
    "skillId": "com.google.android.apps.chromecast.app.get-climate",
    "artifactName": "climate-status"
  }
}
```

Current nuance:

- `compileArtifact()` forwards `String(e)` from `validateExecution(JSON.parse(...))`
- when the validator throws a structured object rather than a plain `Error`, the current message can degrade to a generic string such as `"[object Object]"`
- rely on the error code plus the artifact payload itself, not just the message text

Recovery pattern:

- `ARTIFACT_NOT_FOUND`: confirm the exact artifact filename in `skill.json` and the registry entry
- `COMPILE_VARS_PARSE_FAILED`: fix the JSON string passed to `--vars`
- `COMPILE_VAR_MISSING`: provide every `{{VAR}}` placeholder with a non-empty value
- `COMPILE_VALIDATION_FAILED`: repair the compiled execution payload until `androperator exec --validate-only` accepts it

## Validation

Current validation commands:

```bash
androperator skills validate <skill_id> [--dry-run]
androperator skills validate --all [--dry-run]
```

Validation checks:

- registry entry exists
- `skill.json` exists
- `SKILL.md` exists
- every listed script exists
- every listed artifact exists
- parsed `skill.json` matches the registry entry

With `--dry-run`:

- if artifacts exist, each artifact is parsed and validated as an execution payload
- if no artifacts exist, dry-run returns success with `payloadValidation: "skipped"`

Dry-run skipped example:

```json
{
  "valid": true,
  "dryRun": {
    "payloadValidation": "skipped",
    "reason": "skill has no pre-compiled artifacts; payload is generated at runtime by the skill script"
  }
}
```

If an artifact-backed skill compiles to an invalid execution shape, `skills validate --dry-run` fails before any live device run:

```json
{
  "code": "SKILL_VALIDATION_FAILED",
  "message": "Skill com.example.demo.capture-state: artifact payload schema violation",
  "details": {
    "artifact": "climate-status.recipe.json",
    "path": "actions[0]",
    "reason": "type must be a string"
  }
}
```

### Validation Verification

Use:

```bash
androperator skills validate com.example.demo.capture-state
androperator skills validate com.example.demo.capture-state --dry-run
androperator skills validate --all --dry-run
```

Check:

- single-skill validation returns `valid: true`
- `registryPath` points at the active registry file
- `checks.skillJsonPath`, `checks.skillFilePath`, `checks.scriptPaths`, and `checks.artifactPaths` resolve to real files
- `validate --all` returns `totalSkills` and `validSkills`

## Scaffolding

Create a new skill:

```bash
androperator skills new com.example.app.do-thing --summary "Do one deterministic workflow"
```

Success response shape:

```json
{
  "created": true,
  "skillId": "com.example.app.do-thing",
  "registryPath": "/path/to/skills-registry.json",
  "skillPath": "/path/to/skills/com.example.app.do-thing",
  "files": [
    "/path/to/skills/com.example.app.do-thing/SKILL.md",
    "/path/to/skills/com.example.app.do-thing/skill.json",
    "/path/to/skills/com.example.app.do-thing/scripts/run.js",
    "/path/to/skills/com.example.app.do-thing/scripts/run.sh"
  ]
}
```

Exact defaults and follow-up behavior:

- if `--summary` is omitted, the scaffold writes `TODO: describe <skill_id>`
- blank or whitespace-only summaries are treated as omitted
- `cmdSkillsNew()` returns `next: "Edit \`SKILL.md\` and \`scripts/run.js\`, then run \`androperator skills validate <skill_id>\`; if this repo uses generated indexes, rerun \`scripts/generate_skill_indexes.sh\` and \`androperator skills validate --all\`"`

### Scaffolding Error Cases

Top-level CLI usage failure:

```json
{
  "code": "USAGE",
  "message": "skills new <skill_id> [--summary <text>]"
}
```

Duplicate failures are exact:

```json
{
  "code": "SKILL_ALREADY_EXISTS",
  "message": "Skill already exists: com.android.settings.capture-overview"
}
```

```json
{
  "code": "SKILL_ALREADY_EXISTS",
  "message": "Skill directory already exists: /abs/path/to/skills/com.android.settings.capture-overview"
}
```

Registry write or filesystem write failures surface as `SKILLS_SCAFFOLD_FAILED`.

### Scaffolding Verification

Run:

```bash
androperator skills new com.example.app.do-thing --summary "Do one deterministic workflow"
androperator skills get com.example.app.do-thing
androperator skills validate com.example.app.do-thing
./scripts/generate_skill_indexes.sh
androperator skills validate --all
```

Confirm:

- `created` is `true`
- `files` includes `SKILL.md`, `skill.json`, `scripts/run.js`, and `scripts/run.sh`
- the new registry entry appears in `skills get`
- per-skill validation succeeds without hand-editing file paths
- `validate --all` succeeds after generated indexes are refreshed in repos that own them

## Practical Authoring Rules

- keep `skill.json` and the registry in sync
- let `skills validate --dry-run` prove skill-local artifact payloads
- use `skills new`, then verify with `skills get` and `skills validate`; if the repo owns generated indexes, rerun the generator and finish with `skills validate --all`
- use `skills compile-artifact` when a workflow should compile into deterministic execution JSON
- treat `SKILL.md` as required documentation, but do not overstate its current machine enforcement
- remove scaffolded fixed sleeps from non-trivial scripts during authoring and
  replace them with condition-based waits or snapshot/read polling

## Related Pages

- [Skills Overview](overview.md)
- [Development Workflow](development.md)
- [Device Prep and Runtime](runtime.md)
- [Actions](../api/actions.md)
- [API Overview](../api/overview.md)
