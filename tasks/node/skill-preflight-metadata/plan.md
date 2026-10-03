# Skill Requirements Metadata and Preflight

## Executive Summary

This pack adds first-class requirements metadata to the runtime skills model,
surfaces it through discovery, and enforces only the mechanically provable
requirements before execution. It is Node-dominant even though it includes a
paired change in `<workspace>`: 2 PRs, 4 phases. PR-1 ships the
metadata contract plus discovery surfaces. PR-2 ships runtime preflight
evaluation and structured failures.

## Status

| Item | Value |
| --- | --- |
| State | not started |
| Total PRs | 2 |
| Total phases | 4 |
| Completed | none |
| Remaining | 1, 2, 3, 4 |
| Current / Next | Phase 1 |
| Blockers | none |

## Goal

After this task ships, `androperator skills get <skill_id>` should tell a caller
what a skill requires before first run, and `androperator skills run <skill_id>`
should fail early with structured skill-surface errors when a declared hard
requirement can be checked mechanically and is not met.

## Problem Statement

Runtime skill discovery can identify the correct skill while still leaving a
first-run trust gap: callers do not yet see important prerequisites before deep
runtime execution. That is a skills contract and runtime problem, not an
install or onboarding problem.

At minimum, Google Home exemplar skills need to surface requirements such as:

- `com.google.android.apps.chromecast.app` must be installed on the target
  device
- Google Home must already be signed in and have a linked climate unit
- the caller may need to supply the exact `unit_name` that matches the UI
- orchestrated skills can depend on their manifest-level `agent.cli`, which is
  already guarded at runtime by `SKILL_AGENT_CLI_UNAVAILABLE`

Not all requirements are equally provable ahead of time:

- missing Android packages on a known target device can be checked
  mechanically
- additional host CLIs declared by `requirements` can be checked mechanically
- sign-in state, linked-device state, and exact unit-label correctness are
  advisory first-run guidance unless the runtime gains a truthful proof path

The design intent for this pack is:

- render all relevant requirements in discovery
- block execution only on hard requirements that can be checked mechanically
  before spawn
- keep subjective requirements visible without pretending they are
  authoritatively checked
- keep manifest-level `agent.cli` visible in discovery for orchestrated skills
  even though its runtime guard already exists separately

## In Scope

- Add first-class requirements metadata to the runtime skill contract
- Parse the new metadata from trusted `skill.json` manifests and registry entries
- Surface requirements metadata through `skills get`
- Seed the Google Home HVAC skills in `<workspace>` with real
  requirements metadata as the canonical exemplar
- Add runtime preflight evaluation for hard, mechanically provable requirements
- Return structured skill-surface precondition failures before spawning the
  runtime harness when a hard requirement is known to be unmet
- Update public docs for the new discovery and error surfaces

## Out of Scope

- Install-script or onboarding artifact changes
- Docs organization or CLI-orientation work from D1 and D2
- New runtime skills or app-specific workflow redesign
- Deep UI-state probing for subjective preconditions such as "user is signed in"
- Turning `doctor` into a skill-capability browser

## Existing Artifact Scope

- `apps/node/src/contracts/skills.ts`: in scope for additive requirements
  metadata and new skill-surface precondition codes; preserve existing contract
  semantics for `contract`, `agent`, and `keywords`
- `apps/node/src/domain/skills/runSkill.ts`: in scope for additive preflight
  evaluation before spawn; do not rewrite the core harness contract
- `apps/node/src/domain/skills/skillManifest.ts`: in scope so trusted
  `skill.json` metadata stays aligned with registry entries
- `apps/node/src/cli/commands/skills.ts`: in scope for `skills get` rendering
  only; do not redesign list or search output into verbose metadata dumps
- `<workspace>`: in scope for paired schema and skill-metadata updates
  plus regeneration of the checked-in registry and generated indexes that must
  land with the Node-side contract work

## Surfaces and Ownership

| Surface | What changes | Owner |
| --- | --- | --- |
| `apps/node/src/contracts/skills.ts` | Requirements metadata shape in PR-1 / Phase 1; new skill-surface precondition codes (if any) in PR-2 / Phase 3 |
| `apps/node/src/domain/skills/skillManifest.ts` | Trusted manifest parsing for new metadata | PR-1 / Phase 1 |
| `apps/node/src/cli/commands/skills.ts` | `skills get` discovery output | PR-1 / Phase 2 |
| `apps/node/src/test/unit/skills.test.ts` | Contract, discovery, and runtime preflight regression coverage | PR-1 / Phase 2, PR-2 / Phase 4 |
| `apps/node/src/domain/skills/runSkill.ts` | Hard-requirement preflight evaluation before harness spawn | PR-2 / Phase 3 |
| `docs/skills/overview.md` | Public discovery and requirements guidance | PR-1 / Phase 2, PR-2 / Phase 4 |
| `docs/api/errors.md` | Public documentation for any new stable error codes that belong on that page | PR-2 / Phase 4 |
| `<workspace>/skills/skills-registry.schema.json` | Registry schema for requirements metadata | PR-1 / Phase 2 |
| `<workspace>/skills/skills-registry.json` | Regenerated canonical registry consumed by Androperator | PR-1 / Phase 2 |
| `<workspace>/skills/generated/` | Regenerated committed indexes and manifest derived from exemplar metadata | PR-1 / Phase 2 |
| `<workspace>/skills/com.google.android.apps.chromecast.app.*/skill.json` | Seeded exemplar requirements metadata | PR-1 / Phase 2 |

## Source Of Truth

| Topic | Verify against |
| --- | --- |
| Current skill contract | `apps/node/src/contracts/skills.ts` |
| Trusted skill manifest parsing | `apps/node/src/domain/skills/skillManifest.ts` |
| Runtime skill execution boundary | `apps/node/src/domain/skills/runSkill.ts` |
| `skills get` output surface | `apps/node/src/cli/commands/skills.ts`, `docs/skills/overview.md` |
| Existing skill-surface regression patterns | `apps/node/src/test/unit/skills.test.ts` |
| Public error-code contract | `docs/api/errors.md`, `apps/node/src/contracts/errors.ts` |
| Runtime skills registry and schema | `<workspace>/skills/skills-registry.json`, `<workspace>/skills/skills-registry.schema.json` |
| Canonical exemplar manifests | `<workspace>/skills/com.google.android.apps.chromecast.app.*/skill.json` |
| First-run requirements problem framing | This `plan.md` under `Problem Statement` |

## Deterministic Versus Judgment

**Deterministic - do not re-derive:**

- Use `requirements` as the new metadata field on `SkillEntry`. Reserve
  "preflight" for the runtime evaluation step. Do not introduce both `requires`
  and `preflight` as parallel registry fields.
- Keep requirements metadata distinct from the existing `contract` object.
  `contract` describes trusted input shape, goal, and verification. `requirements`
  describes prerequisites and first-run guidance.
- Only `skills get` becomes the detailed requirements surface. Do not turn
  `skills list` or `skills search` into verbose metadata dumps.
- Only mechanically provable hard requirements should block execution in this
  pack. Advisory requirements must be rendered for discovery but must not cause
  false-authoritative runtime failures.
- New stable skill-surface precondition codes belong in
  `apps/node/src/contracts/skills.ts`, where the existing skill-specific codes
  already live. Do not move this pack into `apps/node/src/contracts/errors.ts`
  unless the current code proves that decision wrong.
- The Google Home HVAC skills are the required exemplar seed set for this pack.
  Do not prove the feature only with synthetic local fixtures.
- The sibling skills repo treats `skills/skills-registry.json` and
  `skills/generated/` as checked-in generated artifacts. Any Phase 2 schema or
  exemplar-manifest edit must be followed by `<workspace>/scripts/generate_skill_indexes.sh`
  so the shipped registry and indexes actually carry the new metadata.
- The manifest-level `agent.cli` field already exists and is already enforced
  at runtime by `SKILL_AGENT_CLI_UNAVAILABLE`. Do not restate `agent.cli` as a
  `requirements.hostCli` entry, and do not add a second preflight path for it.
  `requirements.hostCli` is reserved for additional host CLIs that a skill
  needs beyond its declared `agent.cli`.
- Discovery still needs to surface manifest-level `agent.cli` for orchestrated
  skills. The no-duplication rule applies to metadata shape and runtime
  preflight, not to discovery output. A caller using `skills get` should still
  learn that an orchestrated skill depends on `codex` before execution.

**Judgment required:**

- The exact `requirements` sub-shape as long as it cleanly separates hard
  machine-checkable requirements from advisory first-run guidance
- Which requirements should be rendered most prominently in pretty output for
  `skills get`
- Whether a missing selected device should be a hard runtime blocker for a
  declared device-side package check or whether the check should degrade to
  advisory guidance before execution

## Decision Rules

| Question | Rule |
| --- | --- |
| What metadata name should the registry use? | `requirements`. Runtime "preflight" is derived from it; do not add a second parallel field. |
| What kinds of requirements should this pack support? | At minimum: host CLI requirements, Android package requirements, user-input guidance, advisory account or app-state notes, and an explicit safer-first-run pointer when a safer read-only alternative exists. |
| Which requirements are hard blockers at runtime? | Only requirements that can be checked mechanically before spawn, such as missing host CLIs or missing Android packages when a target device is known. |
| How should manifest `agent.cli` appear in discovery? | Surface it in `skills get` as existing orchestrated runtime metadata or an equivalent derived discovery field, but do not copy it into `requirements.hostCli` and do not add a second runtime preflight path for it. |
| What must happen after editing sibling repo schema or exemplar manifests? | Regenerate the sibling repo registry and committed indexes with `<workspace>/scripts/generate_skill_indexes.sh`, then validate the generated outputs that changed. Do not leave `skills/skills-registry.json` or `skills/generated/` stale. |
| How should subjective requirements such as sign-in state be handled? | Render them as advisory requirements in discovery output. Do not invent UI probing in this pack. |
| How should user inputs be represented? | As guidance metadata that complements, not replaces, the existing `contract.inputs` system. Do not duplicate contract parsing logic. |
| Where should safer-first-run guidance live? | In `requirements`, as an explicit pointer to the safer skill or route. Surface it in `skills get`; do not bury it only in prose docs. |
| Should replay and orchestrated skills share the same metadata field? | Yes. The metadata model is skill-wide; runtime enforcement may differ by what can be checked for each skill. |

## Failure Modes To Prevent

- Requirements metadata duplicates or conflicts with `contract.inputs`.
- Advisory guidance is treated as a hard blocker and causes false-authoritative
  runtime failures.
- Hard requirements are documented but still fail late because `runSkill()`
  does not check what it can know before spawn.
- Only the sibling skills repo changes and the Node runtime never reads the new
  metadata.
- Only Node fixtures change and the real Google Home exemplar skills remain
  unannotated.
- New stable codes are added to the wrong contract surface.
- `skills get` still hides the critical first-run requirements after this pack.

## Output Contract

After PR-1:

- `SkillEntry` supports additive `requirements` metadata.
- `skills get <skill_id>` surfaces that metadata clearly, including a
  safer-first-run pointer when present.
- `<workspace>` schema and the Google Home HVAC exemplar skills ship
  real `requirements` metadata in lockstep with the Node contract.
- The checked-in sibling repo registry and generated indexes are regenerated, so
  `skills/skills-registry.json` and `skills/generated/` actually carry the new
  metadata consumed by Androperator.

After PR-2:

- `runSkill()` evaluates declared hard requirements it can prove before spawn.
- When one of those hard requirements fails, the command returns a structured
  skill-surface precondition code and does not launch the runtime harness.
- Advisory requirements remain visible in discovery output but do not become
  false blocker failures.
- Public docs reflect the new metadata and error surfaces.

## Idempotency

- Re-reading the registry and manifests yields stable requirement metadata on
  repeated runs.
- Re-running `skills get` returns the same requirement structure for the same
  registry content.
- Re-running preflight checks is safe and does not mutate runtime state.

## Durable Follow-Up

| Knowledge | Permanent home |
| --- | --- |
| Requirements metadata contract | `apps/node/src/contracts/skills.ts` and `<workspace>/skills/skills-registry.schema.json` |
| Trusted manifest parsing rules | `apps/node/src/domain/skills/skillManifest.ts` |
| Discovery surface for requirements | `docs/skills/overview.md` and `apps/node/src/cli/commands/skills.ts` |
| Stable precondition failure codes | `apps/node/src/contracts/skills.ts` and docs that describe them |
