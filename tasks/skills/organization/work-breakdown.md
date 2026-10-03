# Bundled Skills Organization and Surface Rename Work Breakdown

Parent plan: `tasks/skills/organization/plan.md`

## Executive Summary

2 PRs, 3 phases. **PR-1** contains Phase 1 (packaged-source relocation) and
Phase 2 (skill-id normalization and first-party branding). **PR-2** contains
Phase 3 (external rename from `agent-skills` to `bundled-skills` as a clean
breaking change). Phase 1 uses `thinking`, Phase 2 uses `default`, and Phase 3
uses `thinking`.

Current state is PR-2 complete locally. All three phases are implemented and
validated in the worktree.

## Status
| Item | Value |
| --- | --- |
| State | PR-2 complete locally |
| Total PRs | 2 |
| Total phases | 3 |
| Completed | 1, 2, 3 |
| Remaining | none |
| Current / Next | Awaiting review / merge |
| Blockers | none |

## Hard Rules

- Do not start PR-2 until PR-1 is merged.
- Treat `tasks/skills/organization/findings.md`
  as authoritative input. Do not rewrite existing findings sections.
- Use only the final bundled-skill ids named in `plan.md`. Do not invent a
  different prefix or shorter names.
- Do not rename JSON envelope keys such as `skills`, `count`, `installedDir`,
  or `agentDiscoveryDirs`.
- Do not rename `ERROR_CODES.AGENT_SKILLS_STALE` in this task. Do rename the
  four ad-hoc `AGENT_SKILLS_*` error-code string literals returned by install
  or list (`SOURCE_NOT_FOUND`, `SOURCE_EMPTY`, `INSTALL_FAILED`,
  `LIST_FAILED`) to their `BUNDLED_SKILLS_*` counterparts in PR-2 / Phase 3.
- Do not edit generated docs directly. Use
  `.agents/skills/docs-author/SKILL.md`
  for authored docs work, then validate with `./scripts/docs_build.sh`.
- A phase that changes behavior must include the tests that prove that behavior
  in the same phase and commit. Do not defer tests.
- Do not preserve the old `agent-skills` API surface with aliases, env-var
  fallbacks, or dual install-path support. Phase 3 is a clean break.
- If execution discovers a material contradiction with `findings.md`, append a
  dated `## Execution Notes` section to `tasks/skills/organization/findings.md`
  before the phase commit.

## Required Reading

Read these files IN THIS ORDER before writing anything.

| File | Why it matters |
| --- | --- |
| `tasks/skills/organization/plan.md` | Stable contract, scope boundaries, and phase decisions |
| `tasks/skills/organization/findings.md` | Migration rationale and the naming decisions this pack must preserve |
| `docs/internal/design/node-api-design-guiding-principles.md` | External-surface naming principles that justify `bundled-skills` |
| `apps/node/src/domain/skills/copyAgentSkills.ts` | Current packaged-source resolution and install behavior |
| `apps/node/src/cli/commands/agentSkills.ts` | Current install, update, and list command behavior |
| `apps/node/src/domain/skills/skillsConfig.ts` | Current install-dir constants and env-var plumbing |
| `apps/node/src/cli/registry.ts` | Current command registration, help text, and top-level guidance |
| `apps/node/src/domain/doctor/checks/hostChecks.ts` | Current doctor id, fix text, and installed-skill validation |
| `apps/node/src/test/unit/agentSkills.test.ts` | Main Node regression patterns for install or list behavior |
| `apps/node/src/test/unit/agentSkillsPack.test.ts` | Packaging mechanism that Phase 1 removes or replaces |
| `apps/node/src/test/unit/cliHelp.test.ts` | Help-text and command-surface regression patterns |
| `apps/node/src/test/unit/doctor/hostChecks.test.ts` | Doctor regression patterns |
| `validation/install/README.md` | Canonical installer validation entrypoint and maintenance rule |
| `sites/androperator-public/install.sh` | Current installer text and agent-guide generation |
| `docs/api/doctor.md` | Public doctor-check reference page carrying the id that must flip in Phase 3 |
| `docs/host-agents.md` | Main public docs page for the host-agent front doors |
| `.agents/skills/docs-author/SKILL.md` | Required workflow for authored public docs touched in Phases 2 and 3 |

## PR / Phase Plan

| PR | Purpose | Included phases | Agent tier | Merge gate |
| --- | --- | --- | --- | --- |
| PR-1 | Move packaged source and normalize bundled-skill ids | 1, 2 | thinking, default | none |
| PR-2 | Rename the public surface to `bundled-skills` with no backwards compatibility | 3 | thinking | PR-1 merged |

## Phase 1: Packaged Source Relocation

### Agent Tier

thinking

### Goal

Make `apps/node/bundled-skills/` the only real shipped source tree for the four
first-party bundled skills, and remove the symlink-swapping pack mechanism.

### Files or Surfaces To Change

- `.agents/skills/androperator-agent-orientation/`
- `.agents/skills/androperator-upgrade/`
- `.agents/skills/skill-author-by-agent-discovery/`
- `.agents/skills/skill-author-by-recording/`
- `apps/node/bundled-skills/`
- `apps/node/agent-skills/`
- `apps/node/scripts/agentSkillsPack.mjs`
- `apps/node/package.json`
- `apps/node/src/domain/skills/copyAgentSkills.ts`
- `apps/node/src/test/unit/agentSkills.test.ts`
- `apps/node/src/test/unit/agentSkillsPack.test.ts`

### Steps

1. Use `git mv` to move the four shipped skill directories from `.agents/skills/`
   into `apps/node/bundled-skills/`. Do not copy and delete; preserve file
   history with moves.
2. Delete the `apps/node/agent-skills/` symlink tree and remove
   `apps/node/scripts/agentSkillsPack.mjs`.
3. Update `apps/node/package.json`:
   - replace `"agent-skills/"` with `"bundled-skills/"` in `files`
   - remove `prepack` and `postpack` entries tied to `agentSkillsPack.mjs`
4. Update `copyAgentSkills.ts` so packaged-source resolution reads from
   `../../../bundled-skills`. Phase 1 is only about source location. Do not
   rename the public command noun, install dir, env var, or doctor id here.
5. Update tests in the same phase. Required cases:
   - `copyAgentSkills` discovers the packaged skills from the new
     `bundled-skills/` tree
   - `listPackagedAgentSkills` still reports the expected four skills
   - `npm --prefix apps/node pack --dry-run` includes files from
     `bundled-skills/` without relying on prepack or postpack swapping
   - `agentSkillsPack.test.ts` is removed or replaced so the deleted script is
     not still treated as live behavior
6. Run the Phase 1 validation commands before committing.

### Acceptance Criteria

- `apps/node/bundled-skills/` exists and contains the four shipped skill
  directories as real directories, not symlinks
- `.agents/skills/` no longer contains those four shipped public skills
- `apps/node/agent-skills/` and `apps/node/scripts/agentSkillsPack.mjs` are gone
- `apps/node/package.json` ships `bundled-skills/` directly and no longer
  registers prepack or postpack handlers for the old pack script
- `copyAgentSkills.ts` resolves packaged skills from `bundled-skills/`
- Node build and test pass, and `npm pack --dry-run` shows the packaged files

Human review checklist:

- the relocation really changed the source of truth rather than adding a second
  copy
- no public naming changes leaked into Phase 1
- the test replacement proves the new packaging path instead of preserving the
  deleted pack-script assumptions

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
npm --prefix apps/node pack --dry-run
test -d apps/node/bundled-skills
test ! -e apps/node/agent-skills
test ! -e apps/node/scripts/agentSkillsPack.mjs
find apps/node/bundled-skills -maxdepth 1 -mindepth 1 -type d | sort
```

### Expected Commit

```text
refactor(node): move packaged skills into bundled-skills
```

## Phase 2: Skill Id Normalization and First-Party Branding

### Agent Tier

default

### Goal

Rename the two unprefixed bundled-skill ids, tighten the shipped skill
frontmatter and opening copy, and update every repo reference to the final four
skill ids while keeping the public noun `agent-skills` unchanged until PR-2.

### Files or Surfaces To Change

- `apps/node/bundled-skills/androperator-agent-orientation/`
- `apps/node/bundled-skills/androperator-upgrade/`
- `apps/node/bundled-skills/skill-author-by-agent-discovery/`
- `apps/node/bundled-skills/skill-author-by-recording/`
- `.agents/skills/androperator-agent-orientation/SKILL.md`
- `.agents/skills/androperator-upgrade/SKILL.md`
- `sites/androperator-public/install.sh`
- `validation/install/test_agent_skills.sh`
- `validation/install/test_main.sh`
- `docs/host-agents.md`
- `docs/skills/authoring.md`
- `docs/skills/overview.md`
- `docs/setup.md`
- `docs/internal/design/agent-host-integration.md`
- `evals/harness/runner.py`
- `evals/harness/test_run_eval.py`
- `evals/harness/test_rescore.py`
- `evals/specs/android-version/prompt-skill.md` if it names the old bare skill ids

### Steps

1. Use `git mv` to rename the two bundled-skill directories:
   - `apps/node/bundled-skills/skill-author-by-agent-discovery` ->
     `apps/node/bundled-skills/androperator-skill-author-by-agent-discovery`
   - `apps/node/bundled-skills/skill-author-by-recording` ->
     `apps/node/bundled-skills/androperator-skill-author-by-recording`
2. Update the four shipped `SKILL.md` files:
   - final `name:` values must match the four final ids from `plan.md`
   - each description must begin with `Androperator first-party bundled skill.`
   - the first paragraph of the discovery skill body must name Androperator
     explicitly
3. Update every repo reference to the final four skill ids. Search broadly with
   `rg` before editing so installer guidance, docs, tests, eval fixtures, and
   repo-local helper skills all move together.
4. Keep the public noun `agent-skills` unchanged in this phase. This phase is
   only about concrete skill ids and first-party branding.
5. Use `.agents/skills/docs-author/SKILL.md`
   for the authored docs touched here.
6. Update the tests and eval fixtures in the same phase. Required cases:
   - installer guide and harness expectations use the new skill ids
   - help or guidance docs and tests name the new skill ids
   - eval harness expectations for the zero-results authoring front door refer to
     the new skill ids
   - `evals/specs/android-version/prompt-skill.md` is updated only if it
     actually names the old bare skill ids
7. Run the Phase 2 validation commands before committing.

### Acceptance Criteria

- the four bundled-skill directories have the final names from `plan.md`
- all four shipped `SKILL.md` files advertise themselves as Androperator
  first-party bundled skills
- repo references to the old bare `skill-author-by-*` ids are gone outside the
  historical findings file and this task pack
- installer harnesses, docs, and eval fixtures all point at the new bundled
  skill ids

Human review checklist:

- the new ids remain self-documenting and preserve the author-by-X pairing
- docs use the new ids consistently without prematurely renaming the public noun
- no shipped `SKILL.md` still reads like a repo-internal maintenance skill

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
./validation/install/test_install.sh
./scripts/docs_build.sh
uv --project evals run pytest evals/harness/test_run_eval.py evals/harness/test_rescore.py
find apps/node/bundled-skills -maxdepth 1 -mindepth 1 -type d | sort
rg -n --pcre2 '(?<![a-z-])skill-author-by-agent-discovery(?![a-z-])|(?<![a-z-])skill-author-by-recording(?![a-z-])' apps/node docs sites/landing-clawperator/public validation evals .agents/skills
```

The final `rg` command should return no matches. If it reports a real remaining
bare old id, fix it before committing.

### Expected Commit

```text
refactor(skills): prefix bundled skill ids and tighten first-party branding
```

## Phase 3: External Surface Rename to `bundled-skills`

### Agent Tier

thinking

### Goal

Rename the primary external surface from `agent-skills` to `bundled-skills`
across the CLI, install dir, env var, doctor id, installer output, docs, and
eval expectations, with no backwards-compatibility layer for the old surface.

### Files or Surfaces To Change

- `apps/node/src/cli/commands/agentSkills.ts`
- `apps/node/src/domain/skills/copyAgentSkills.ts`
- `apps/node/src/domain/skills/skillsConfig.ts`
- `apps/node/src/cli/registry.ts`
- `apps/node/src/domain/doctor/checks/hostChecks.ts`
- `apps/node/src/test/unit/agentSkills.test.ts`
- `apps/node/src/test/unit/cliHelp.test.ts`
- `apps/node/src/test/unit/doctor/hostChecks.test.ts`
- `sites/androperator-public/install.sh`
- `validation/install/test_agent_skills.sh`
- `validation/install/test_main.sh`
- `validation/install/README.md`
- `docs/host-agents.md`
- `docs/skills/authoring.md`
- `docs/skills/overview.md`
- `docs/setup.md`
- `docs/api/doctor.md`
- `docs/internal/design/agent-host-integration.md`
- `evals/harness/runner.py`
- `evals/harness/test_run_eval.py`
- `evals/harness/test_rescore.py`
- `evals/specs/android-version/prompt-skill.md` if it names `agent-skills`

### Steps

1. Rename the primary command surface to `androperator bundled-skills`. Register
   no alias for `agent-skills`. Keep the existing JSON envelope keys
   (`skills`, `count`, `installedDir`, `agentDiscoveryDirs`) unchanged.
2. Rename the primary install dir to `~/.androperator/bundled-skills/` and the
   primary packaged-source env var to `ANDROPERATOR_BUNDLED_SKILLS`. Do not keep
   `ANDROPERATOR_AGENT_SKILLS` fallback logic or old install-dir fallback logic.
3. Rename the primary doctor check id to `host.bundled-skills.staleness` and
   update fix text to use the new command noun. Keep the stable registered
   error code `ERROR_CODES.AGENT_SKILLS_STALE` unchanged in this task.
4. Rename the ad-hoc error-code string literals returned from install or list
   in the same commit that moves the surface:
   - `AGENT_SKILLS_SOURCE_NOT_FOUND` -> `BUNDLED_SKILLS_SOURCE_NOT_FOUND`
   - `AGENT_SKILLS_SOURCE_EMPTY` -> `BUNDLED_SKILLS_SOURCE_EMPTY`
   - `AGENT_SKILLS_INSTALL_FAILED` -> `BUNDLED_SKILLS_INSTALL_FAILED`
   - `AGENT_SKILLS_LIST_FAILED` -> `BUNDLED_SKILLS_LIST_FAILED`
   These are not registered in `ERROR_CODES` and not documented contract
   fields; they flip with the rest of the surface.
5. Rename user-facing message strings and installer banners. Required cases:
   - the `Agent-skills installed.` / `Agent-skills updated.` envelope
     messages emitted by `cmdAgentSkillsInstall` and `cmdAgentSkillsUpdate`
   - the `Setting up agent-skills...` and `Agent-skills setup complete.`
     banners in `install.sh`
   - the `No installed agent-skills found.` empty-list helper text
   - any remaining `agent-skills` strings in CLI help or registry guidance
6. Internal cleanup in this phase:
   - rename file paths: `agentSkills.ts` -> `bundledSkills.ts`,
     `copyAgentSkills.ts` -> `copyBundledSkills.ts`, matching test-file renames
   - rename exported symbols (`copyAgentSkills`, `DEFAULT_AGENT_SKILLS_DIR`,
     `AGENT_SKILLS_SOURCE_ENV_VAR`, `listInstalledAgentSkills`, command
     entry points) to their `bundledSkills` counterparts
   - rename `install.sh` variable names from `AGENT_SKILLS_*` to
     `BUNDLED_SKILLS_*` and the helper `parse_agent_skills_install_result`
   Do not leave new user-facing strings saying `agent-skills`.
7. Update `docs/api/doctor.md` so the doctor-check id column reflects
   `host.bundled-skills.staleness` and the surrounding prose reads
   `bundled-skills`. Keep the `AGENT_SKILLS_STALE` code column unchanged.
8. Use `.agents/skills/docs-author/SKILL.md`
   for authored docs updates. Public docs should teach `bundled-skills` as the
   primary term and remove `agent-skills` from live product guidance.
9. Update tests in the same phase. Required cases:
   - `androperator bundled-skills --help` works
   - `androperator agent-skills --help` fails with the standard unknown-command
     exit code (no alias registered)
   - the new install dir is the primary resolved dir
   - `ANDROPERATOR_BUNDLED_SKILLS` overrides the source dir
   - `ANDROPERATOR_AGENT_SKILLS` is not honored
   - install and list commands emit the renamed `BUNDLED_SKILLS_*` error
     codes on the failure paths
   - doctor results use `host.bundled-skills.staleness` with the
     unchanged `ERROR_CODES.AGENT_SKILLS_STALE`
   - installer harnesses and eval expectations accept the new command noun
   - `evals/specs/android-version/prompt-skill.md` is updated only if it
     actually names `agent-skills`
10. Run the Phase 3 validation commands before committing.

### Acceptance Criteria

- `androperator bundled-skills` is the documented and tested primary command
- `androperator agent-skills` returns the standard unknown-command error
- the primary install dir is `~/.androperator/bundled-skills/`
- the primary env var is `ANDROPERATOR_BUNDLED_SKILLS` with no fallback
- doctor results use `host.bundled-skills.staleness` while keeping
  `ERROR_CODES.AGENT_SKILLS_STALE`
- the ad-hoc install and list error-code strings use `BUNDLED_SKILLS_*`
- `docs/api/doctor.md` shows the new check id and unchanged error code
- public docs use `bundled skills` as the primary term

Human review checklist:

- the old `agent-skills` API surface has actually been removed rather than
  hidden behind synonyms
- remaining `agent-skills` references are only historical context in task notes
  or findings, not live product behavior
- no public docs, installer summaries, or CLI messages teach the old noun as
  the primary name

### Validation

```bash
npm --prefix apps/node run build
npm --prefix apps/node run test
./validation/install/test_install.sh
./scripts/docs_build.sh
uv --project evals run pytest evals/harness/test_run_eval.py evals/harness/test_rescore.py
node apps/node/dist/cli/index.js bundled-skills --help
node apps/node/dist/cli/index.js agent-skills --help ; [ $? -ne 0 ]
rg -n "host\\.agent-skills\\.staleness|ANDROPERATOR_AGENT_SKILLS|~/.androperator/agent-skills|androperator agent-skills|Agent-skills |Setting up agent-skills|AGENT_SKILLS_SOURCE_NOT_FOUND|AGENT_SKILLS_SOURCE_EMPTY|AGENT_SKILLS_INSTALL_FAILED|AGENT_SKILLS_LIST_FAILED" apps/node docs sites/landing-clawperator/public validation evals .agents/skills
```

Review the final `rg` output manually. Any remaining matches must be deliberate
historical context in task notes or findings only. If a match is still part of
live product behavior, fix it before committing. The one intentional exception
is `ERROR_CODES.AGENT_SKILLS_STALE` in
`apps/node/src/contracts/errors.ts`, `apps/node/src/domain/doctor/checks/hostChecks.ts`,
and `docs/api/doctor.md`.

### Expected Commit

```text
refactor(skills): rename the agent-skills surface to bundled-skills
```
