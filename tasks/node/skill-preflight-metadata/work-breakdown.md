# Skill Requirements Metadata and Preflight Work Breakdown

Parent plan: `tasks/node/skill-preflight-metadata/plan.md`

## Executive Summary

2 PRs, 4 phases. PR-1 introduces the requirements metadata contract, trusted
manifest parsing, `skills get` rendering, and the paired schema or exemplar
updates in `<workspace>`. PR-2 introduces runtime preflight
evaluation plus structured failures for hard requirements that can be checked
before spawn. This is a standalone skills-surface task pack.

## Status

| Item | Value |
| --- | --- |
| State | planning |
| Total PRs | 2 |
| Total phases | 4 |
| Completed | none |
| Remaining | 1, 2, 3, 4 |
| Current / Next | Phase 1 |
| Blockers | none |

## Hard Rules

- Keep this work scoped to skills-surface metadata and runtime preflight.
- Use `requirements` as the metadata field name. Do not create parallel
  `requires` and `preflight` registry fields.
- Keep requirements metadata distinct from `contract`. If information is already
  modeled as `contract.inputs`, reference it rather than duplicating validation
  logic.
- Only mechanically provable hard requirements may block execution in this pack.
  Subjective requirements stay advisory.
- Do not turn `skills list` or `skills search` into verbose requirement dumps.
  `skills get` is the detailed discovery surface.
- Land the Node-side contract change and the paired
  `<workspace>/skills/skills-registry.schema.json` change in the same
  review window. Do not prove the feature only with repo-local fixtures.
- Keep Google Home HVAC as the required exemplar set for seeded metadata and
  regression coverage.
- Do not add new stable precondition codes to `apps/node/src/contracts/errors.ts`
  unless current code proves that skill-specific codes do not belong in
  `apps/node/src/contracts/skills.ts`.
- One commit per logical step. Do not batch contract design, exemplar seeding,
  runtime preflight, and docs into one large commit.

## Required Reading

Read these files IN THIS ORDER before writing anything.

| File | Why it matters |
| --- | --- |
| `tasks/node/skill-preflight-metadata/plan.md` | Stable contract and scope boundaries |
| `apps/node/src/contracts/skills.ts` | Current `SkillEntry` shape and skill-surface codes |
| `apps/node/src/domain/skills/skillManifest.ts` | Trusted `skill.json` parsing path to extend |
| `apps/node/src/domain/skills/runSkill.ts` | Runtime pre-spawn evaluation boundary |
| `apps/node/src/cli/commands/skills.ts` | `skills get` output surface |
| `apps/node/src/test/unit/skills.test.ts` | Existing regression patterns for skills discovery and runtime behavior |
| `docs/skills/overview.md` | Public skill discovery contract and current error guidance |
| `docs/api/errors.md` | Public stable error-code documentation rules |
| `<workspace>/skills/skills-registry.schema.json` | Paired registry schema source of truth |
| `<workspace>/skills/skills-registry.json` | Real shipped registry data |
| `<workspace>/skills/com.google.android.apps.chromecast.app.get-climate-replay/skill.json` | Google Home read-only exemplar |
| `<workspace>/skills/com.google.android.apps.chromecast.app.control-hvac-orchestrated/skill.json` | Google Home orchestrated exemplar and safer-first-run pointer target |

## PR / Phase Plan

| PR | Branch | Purpose | Included phases | Agent tier | Merge gate | Cross-repo dependency |
| --- | --- | --- | --- | --- | --- | --- |
| PR-1 | `node/skill-preflight-metadata-p1` | Requirements contract and discovery | 1, 2 | thinking, default | none | paired `<workspace>` schema and exemplar update required before PR is complete |
| PR-2 | `node/skill-preflight-metadata-p2` | Runtime preflight enforcement | 3, 4 | thinking, default | PR-1 merged | none |

## Phase 1: Requirements Metadata Contract

### Agent Tier

thinking

### Goal

Define the additive `requirements` metadata shape and wire trusted manifest
parsing so Node can read it deterministically.

### Files or Surfaces To Change

- `apps/node/src/contracts/skills.ts`
- `apps/node/src/domain/skills/skillManifest.ts`
- `apps/node/src/test/unit/skills.test.ts` or a focused adjacent unit file if the
  existing file becomes unwieldy

### Steps

1. Extend `SkillEntry` with additive `requirements` metadata in
   `apps/node/src/contracts/skills.ts`.
2. Define a metadata shape that can clearly express:
   - hard machine-checkable host CLI requirements
   - hard machine-checkable Android package requirements
   - user-input guidance
   - advisory account or app-state notes
   - `saferFirstRun` guidance
3. Add parsing support in `skillManifest.ts` so trusted `skill.json` metadata is
   read and validated alongside existing `agent` and `contract` fields.
4. Add focused regression coverage for manifest parsing and metadata validation
   failures.
5. Stop here once the contract and parsing path are stable. Do not start `skills
   get` formatting or sibling repo edits in the same commit.

### Acceptance Criteria

- `SkillEntry` has additive `requirements` support with deterministic validation.
- Trusted `skill.json` parsing reads the new field and rejects malformed data
  clearly.
- Contract and parsing tests ship in the same phase.

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
```

### Expected Commit

```text
feat(node): add skill requirements metadata contract
```

## Phase 2: Discovery Surface and Google Home Exemplars

### Agent Tier

default

### Goal

Make `skills get` surface requirements metadata clearly and seed the real Google
Home HVAC skills with that metadata in `<workspace>`.

### Files or Surfaces To Change

- `apps/node/src/cli/commands/skills.ts`
- `apps/node/src/test/unit/skills.test.ts`
- `docs/skills/overview.md`
- `<workspace>/skills/skills-registry.schema.json`
- `<workspace>/skills/skills-registry.json`
- `<workspace>/skills/generated/`
- `<workspace>/skills/com.google.android.apps.chromecast.app.*/skill.json`

### Steps

1. Update `skills get` so pretty and JSON output both surface the new
   `requirements` metadata without changing the top-level `skill` envelope.
2. Decide how pretty output should order hard requirements, advisory notes, and
   safer-first-run guidance. Keep the JSON shape close to the underlying
   contract.
3. Update the sibling skills repo schema in
   `<workspace>/skills/skills-registry.schema.json` so the published
   registry accepts the new metadata.
4. Seed the four Google Home HVAC skills (`get-climate-replay`,
   `set-power-replay`, `set-temperature-replay`, and
   `control-hvac-orchestrated`) with real requirements metadata. At minimum
   cover:
   - required Android package `com.google.android.apps.chromecast.app`
   - user-input guidance for exact unit-name matching
   - advisory sign-in or linked-device notes
   - safer-first-run guidance from the orchestrated skill to the replay or
     read-only path
   Do not restate the orchestrated skill's existing `agent.cli = "codex"` as a
   `requirements.hostCli` entry; that is already covered by the manifest
   `agent` block.
5. Regenerate the sibling repo registry and committed indexes after the schema
   and exemplar-manifest edits:
   ```bash
   (cd <workspace> && ./scripts/generate_skill_indexes.sh)
   ```
   Treat `skills/skills-registry.json` and the changed files under
   `skills/generated/` as required Phase 2 outputs, not optional rebuild noise.
6. Ensure `skills get` discovery output still surfaces the orchestrated skill's
   manifest-level `agent.cli` dependency (`codex`) alongside the new
   `requirements` metadata. Do not leave that prerequisite discoverable only
   through a later runtime failure.
7. Validate the sibling repo generated outputs that changed. At minimum, confirm
   the regenerated `skills/skills-registry.json` and the Google Home
   `skills/generated/by-app/com.google.android.apps.chromecast.app.json` shard
   include the new requirements metadata, and inspect `skills/generated/manifest.json`
   if it changed.
8. Update public docs in `docs/skills/overview.md` so they describe the new
   discovery surface accurately.
9. Add regression coverage that proves `skills get` surfaces the seeded Google
   Home requirements in a stable shape.
   Include a regression that the orchestrated HVAC skill still exposes its
   manifest-level `agent.cli` dependency in discovery output without encoding it
   as `requirements.hostCli`.

### Acceptance Criteria

- `skills get` returns and pretty-prints `requirements`.
- `skills get` still makes the orchestrated HVAC skill's `codex` dependency
  visible at discovery time via manifest-derived output, without duplicating it
  in `requirements.hostCli`.
- The sibling repo schema and exemplar Google Home skills ship real metadata.
- The regenerated sibling repo `skills/skills-registry.json` and changed
  `skills/generated/` artifacts carry the new metadata instead of remaining
  stale.
- Docs describe `requirements` as the first-run discovery surface.
- Tests cover the seeded exemplar behavior rather than only synthetic fixtures.

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
(cd <workspace> && ./scripts/generate_skill_indexes.sh)
rg -n "\"requirements\"|\"saferFirstRun\"|\"codex\"" \
  <workspace>/skills/skills-registry.json \
  <workspace>/skills/generated/by-app/com.google.android.apps.chromecast.app.json
./scripts/docs_build.sh
```

### Expected Commits

```text
feat(node): expose skill requirements in skills get
```

```text
feat(skills): seed requirements metadata for Google Home skills
```

```text
docs(skills): document skill requirements metadata
```

## Phase 3: Runtime Preflight Evaluation

### Agent Tier

thinking

### Goal

Evaluate declared hard requirements before runtime spawn and return structured
skill-surface failures when the requirement is known to be unmet.

### Files or Surfaces To Change

- `apps/node/src/domain/skills/runSkill.ts`
- `apps/node/src/contracts/skills.ts`
- any adjacent Node helper under `apps/node/src/domain/skills/` if a small
  helper is justified

### Steps

1. Add runtime preflight evaluation ahead of harness spawn in `runSkill.ts`.
2. Implement checks only for hard requirements that can be proven before spawn,
   such as:
   - required host CLI declared via new `requirements.hostCli` missing from
     PATH or configured location. Do not re-check the manifest-level
     `agent.cli`; that path is already guarded by `SKILL_AGENT_CLI_UNAVAILABLE`
     in `runSkill.ts` and must not be duplicated here.
   - required Android package missing on the selected target device when a
     device is known
3. Decide what should happen when a device-side package requirement exists but
   no explicit target device is selected. Be explicit and consistent. Do not
   guess silently.
4. Add new stable skill-surface precondition codes to
   `apps/node/src/contracts/skills.ts` if needed, and keep the error shape
   aligned with existing skill-run failures.
5. Preserve advisory requirements as non-blocking. They should remain discoverable
   but must not produce false-hard failures.

### Acceptance Criteria

- `runSkill()` can stop before harness spawn when a declared hard requirement is
  definitively unmet.
- Advisory requirements still do not block execution.
- New stable failure codes live on the skill-surface contract, not in an
  unrelated error enum.

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
```

### Expected Commit

```text
feat(node): add skill preflight checks for hard requirements
```

## Phase 4: Runtime Regression Coverage and Error Docs

### Agent Tier

default

### Goal

Prove the new preflight behavior with focused regressions and document any new
stable failures or discovery semantics.

### Files or Surfaces To Change

- `apps/node/src/test/unit/skills.test.ts`
- `docs/skills/overview.md`
- `docs/api/errors.md` if the new stable codes belong on that page

### Steps

1. Add focused runtime regressions for at minimum:
   - missing required host CLI fails before harness spawn
   - missing required Android package fails before harness spawn when the target
     device is known
   - advisory requirements remain non-blocking
   - safer-first-run guidance remains visible through discovery output
2. Update `docs/skills/overview.md` to explain the runtime preflight behavior
   and where it does and does not make authoritative claims.
3. If new stable codes are part of the documented public contract, update
   `docs/api/errors.md` accordingly. If they remain skills-only contract codes
   documented in the skills docs, keep the docs split intentional and explicit.
4. Run the full Node build or test pass and docs build before declaring the pack
   phase complete.

### Acceptance Criteria

- Regression coverage proves the intended early-failure behavior.
- Docs explain the new discovery and runtime behavior without overstating what
  can be checked automatically.
- Node build, tests, and docs build pass together.

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
./scripts/docs_build.sh
```

### Expected Commit

```text
test(node): cover skill preflight requirement failures
```
