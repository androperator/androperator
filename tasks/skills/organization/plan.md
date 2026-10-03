# Bundled Skills Organization and Surface Rename

## Executive Summary

Reorganize the four shipped first-party host-agent skills so they live under
`apps/node/bundled-skills/`, stop masquerading as repo-local maintenance
skills, and present a consistent `clawperator-` branded identity. This is a
cross-surface cleanup that spans Node packaging, shipped skill contents, CLI
help, installer behavior, doctor output, eval harness expectations, and public
docs.

This task ships in **2 PRs across 3 phases**. **PR-1** handles packaged-source
relocation plus bundled-skill id normalization. **PR-2** renames the external
surface from `agent-skills` to `bundled-skills` as a clean breaking rename.
PR-2 is now implemented and validated locally.

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

## Goal

After this task ships:

- the four shipped first-party host-agent skills live as real directories under
  `apps/node/bundled-skills/`
- `.agents/skills/` once again means repo-local maintenance skills only
- all four shipped skill ids use the `clawperator-` prefix
- the primary external surface is `clawperator bundled-skills`
- the old `agent-skills` API surface is removed instead of carried forward

## Why Now

`tasks/skills/organization/findings.md`
already established that the current layout tells two conflicting stories at
once:

- the four public skills appear to be repo-internal because their real files sit
  under `.agents/skills/`
- the Node package actually ships them as first-party product artifacts

That ambiguity now leaks into packaging, docs, installer guidance, doctor
terminology, and eval expectations. The task exists to retire the conflicting
taxonomy before more docs, tests, and onboarding flows continue to build on the
wrong mental model.

## In Scope

- move the four shipped first-party host-agent skills out of `.agents/skills/`
  and into `apps/node/bundled-skills/` as real directories
- remove the `apps/node/agent-skills/` symlink-packaging dance and the related
  prepack or postpack script
- rename the two unprefixed skill ids to:
  - `clawperator-skill-author-by-agent-discovery`
  - `clawperator-skill-author-by-recording`
- tighten frontmatter and opening copy on all four shipped skills so they read
  unambiguously as Clawperator first-party bundled skills
- rename the external surface from `agent-skills` to `bundled-skills` across
  the CLI noun, install dir, env var, doctor check id, installer text, docs,
  and eval references
- update or replace existing tests in the same phase as each behavior change

## Out of Scope

- folding bundled skills into the runtime `clawperator skills` namespace
- changing or versioning the sibling `../clawperator-skills` repo
- adding new bundled skills beyond the current four shipped entries
- redesigning runtime-skill behavior, registry format, or runtime-skill docs organization
- rewriting unrelated repo-local maintenance skills under `.agents/skills/`

## Existing Artifact Scope

- `tasks/skills/organization/findings.md`:
  treat as authoritative input for the naming decisions, migration rationale,
  and scope boundaries. It has already been updated to match the clean-break
  policy in this plan. If execution discovers a material contradiction,
  append a dated `## Execution Notes` section at the end instead of rewriting
  the existing sections.
- `apps/node/src/domain/skills/copyAgentSkills.ts`,
  `apps/node/src/cli/commands/agentSkills.ts`,
  `apps/node/src/domain/skills/skillsConfig.ts`,
  `apps/node/src/cli/registry.ts`, and
  `apps/node/src/domain/doctor/checks/hostChecks.ts` are in scope for the
  relocation and rename work only. Do not redesign unrelated skills behavior.
- `sites/landing-clawperator/public/install.sh`, `validation/install/`, `docs/`, and
  `evals/` are in scope only for bundled-skills terminology, skill-id
  references, and the validation needed to prove the rename. Preserve unrelated
  behavior and content.

## Surfaces and Ownership

| Surface | What changes | Owner |
| --- | --- | --- |
| `apps/node/bundled-skills/` | New canonical home for the four shipped skills | PR-1 / Phase 1 |
| `.agents/skills/` | Stops containing the four shipped public skills | PR-1 / Phase 1 |
| `apps/node/package.json` | Package file list; remove prepack or postpack wiring | PR-1 / Phase 1 |
| `apps/node/src/domain/skills/copyAgentSkills.ts` | Packaged-source resolution for installed bundled skills | PR-1 / Phase 1 |
| `apps/node/src/test/unit/agentSkills.test.ts` | Relocation and install behavior regression coverage | PR-1 / Phase 1, PR-2 / Phase 3 |
| `apps/node/src/test/unit/agentSkillsPack.test.ts` | Delete or replace because the pack script is removed | PR-1 / Phase 1 |
| `apps/node/bundled-skills/*/SKILL.md` | Frontmatter and bundled-skill branding | PR-1 / Phase 2 |
| `apps/node/src/cli/commands/agentSkills.ts`, `registry.ts` | External noun rename and removal of the old command surface | PR-2 / Phase 3 |
| `apps/node/src/domain/skills/skillsConfig.ts` | Default bundled-skills install dir and env-var plumbing | PR-2 / Phase 3 |
| `apps/node/src/domain/doctor/checks/hostChecks.ts` | Doctor id and fix text rename | PR-2 / Phase 3 |
| `sites/landing-clawperator/public/install.sh` | Bundled-skills install path and guide text | PR-1 / Phase 2, PR-2 / Phase 3 |
| `validation/install/` | Installer regression expectations | PR-1 / Phase 2, PR-2 / Phase 3 |
| `docs/host-agents.md`, `docs/skills/authoring.md`, `docs/skills/overview.md`, `docs/setup.md`, `docs/api/doctor.md`, `docs/internal/design/agent-host-integration.md` | Public and internal docs updates | PR-1 / Phase 2, PR-2 / Phase 3 |
| `evals/harness/`, `evals/specs/` | Authoring-front-door command expectations and any prompt text that actually names the shipped ids or surface | PR-1 / Phase 2, PR-2 / Phase 3 |

## Source Of Truth

| Topic | Verify against |
| --- | --- |
| Task decisions and migration rationale | `tasks/skills/organization/findings.md` |
| Naming principles for the external noun | `docs/internal/design/node-api-design-guiding-principles.md` |
| Current command surface and help text | `apps/node/src/cli/registry.ts`, `apps/node/src/cli/commands/agentSkills.ts` |
| Packaged-skill install behavior | `apps/node/src/domain/skills/copyAgentSkills.ts`, `apps/node/src/domain/skills/skillsConfig.ts` |
| Doctor behavior | `apps/node/src/domain/doctor/checks/hostChecks.ts`, `apps/node/src/contracts/errors.ts`, `docs/api/doctor.md` |
| Ad-hoc error-code string literals on the install or list paths | `apps/node/src/domain/skills/copyAgentSkills.ts`, `apps/node/src/cli/commands/agentSkills.ts` |
| Installer behavior and guide text | `sites/landing-clawperator/public/install.sh`, `validation/install/README.md` |
| Existing Node-side regression patterns | `apps/node/src/test/unit/agentSkills.test.ts`, `apps/node/src/test/unit/cliHelp.test.ts`, `apps/node/src/test/unit/doctor/hostChecks.test.ts` |
| Existing packaging test coverage | `apps/node/src/test/unit/agentSkillsPack.test.ts` |
| Authored docs surfaces | `docs/` |
| Evals expectations | `evals/harness/test_run_eval.py`, `evals/harness/test_rescore.py`, `evals/harness/runner.py`, `evals/specs/android-version/prompt-skill.md` |

## Deterministic Versus Judgment

**Deterministic - do not re-derive:**

- The real shipped files move to `apps/node/bundled-skills/`. Do not keep a
  second source-of-truth copy under `.agents/skills/`.
- The four final bundled-skill ids are:
  - `clawperator-agent-orientation`
  - `clawperator-upgrade`
  - `clawperator-skill-author-by-agent-discovery`
  - `clawperator-skill-author-by-recording`
- The primary external noun becomes `bundled-skills`. Do not preserve
  `agent-skills` as an alias or fallback path.
- Keep discovery fan-out paths unchanged:
  - `~/.claude/skills/`
  - `~/.codex/skills/`
  - `~/.agents/skills/`
- Keep existing JSON envelope field names such as `skills`, `count`,
  `installedDir`, and `agentDiscoveryDirs`. Do not invent `bundledSkills`,
  `bundledSkillCount`, or other schema churn that the findings did not call for.
- Do not rename `ERROR_CODES.AGENT_SKILLS_STALE` in this task. Rename the doctor
  check id and human-facing fix text, but keep that one stable registered
  error code unchanged to avoid breaking a documented JSON contract that
  downstream consumers pattern-match on.
- The four ad-hoc error-code string literals returned from install or list
  (`AGENT_SKILLS_SOURCE_NOT_FOUND`, `AGENT_SKILLS_SOURCE_EMPTY`,
  `AGENT_SKILLS_INSTALL_FAILED`, `AGENT_SKILLS_LIST_FAILED`) are not
  registered in `ERROR_CODES` and are not documented contract fields. Rename
  them to their `BUNDLED_SKILLS_*` counterparts in PR-2 / Phase 3 along with
  the rest of the surface, and update their regression coverage in the same
  commit.
- User-facing message strings also renamed in PR-2 / Phase 3: the
  `Agent-skills installed.` and `Agent-skills updated.` envelope fields, the
  `Setting up agent-skills...` installer banner, and the
  `Agent-skills setup complete.` summary lines all flip to `bundled-skills`
  (or `Bundled-skills`) wording.
- Do not edit generated docs directly. Authored doc changes belong in `docs/`,
  and docs validation belongs in `./scripts/docs_build.sh`.

**Judgment required:**

- Whether internal filenames and symbol names can be fully renamed in PR-2
  without destabilizing the review; if a small cleanup wrapper is cleaner, it is
  acceptable as long as new user-facing behavior says `bundled-skills`
- How much brief migration explanation belongs in public docs versus internal
  docs, as long as public docs use `bundled-skills` as the primary term
- Whether `evals/specs/android-version/prompt-skill.md` needs Phase 2 edits,
  Phase 3 edits, or both. Use judgment based on whether the prompt actually
  names the shipped skill ids or the `agent-skills` surface after each phase's
  changes.

## Decision Rules

| Question | Rule |
| --- | --- |
| Where do the real shipped skill files live after this task? | `apps/node/bundled-skills/` only. Remove the `apps/node/agent-skills/` symlink tree and the pack script. |
| Which references move in PR-1 / Phase 1? | Packaged source location, Node package file list, packaged-source resolution, and the tests tied to that mechanism. Do not rename the public CLI noun yet. |
| Which references move in PR-1 / Phase 2? | Concrete skill ids, skill frontmatter, first-paragraph branding, guide text, docs references, validation fixtures, and eval references. Keep the public noun `agent-skills` until PR-2. |
| Which references move in PR-2 / Phase 3? | Public command noun, install dir, env var, doctor check id, primary docs vocabulary, installer summaries, and the tests plus validations that prove the breaking rename. |
| What happens to the old API surface after the public rename? | Remove it. Do not add parser aliases, env-var fallbacks, dual install-path support, or shadow doctor ids for `agent-skills`. |
| What happens to the old install dir? | The primary and only supported install dir becomes `~/.clawperator/bundled-skills/`. Do not add migration or fallback logic for `~/.clawperator/agent-skills/` in this task. |
| What happens to the doctor id? | Use `host.bundled-skills.staleness` as the only durable id after Phase 3. |
| How should docs be authored? | Use `.agents/skills/docs-author/SKILL.md` for public docs touched in Phases 2 and 3. Do not hand-edit `sites/docs/.build/` or `sites/docs/site/`. |
| How should `evals/specs/android-version/prompt-skill.md` be handled? | Use judgment. Edit it in Phase 2 if it names the old bare skill ids, edit it in Phase 3 if it names `agent-skills`, and do not touch it in a phase where the prompt text is unaffected. |
| How should `findings.md` be handled during execution? | Treat it as authoritative input. It has already been aligned with the clean-break policy in this plan. Append `## Execution Notes` at the end only if implementation uncovers a material deviation later reviewers must see. |

## Failure Modes To Prevent

- leaving the four shipped skills under `.agents/skills/` and only changing docs
- renaming the public noun before the packaged-source relocation lands cleanly
- forgetting to update the tests that prove packaging, installer, doctor, or
  eval behavior in the same phase as the behavior change
- changing JSON envelope keys or the doctor error code unnecessarily
- updating docs to say `bundled-skills` while CLI help or installer output still
  says `agent-skills`
- carrying the old `agent-skills` surface forward with aliases or fallback code
  even though this task is intentionally a clean break
- letting bare `skill-author-by-*` ids survive in shipped skill directories or
  user-facing guidance after Phase 2
- editing generated docs instead of authored sources
- starting PR-2 before PR-1 is merged, leaving the external rename layered on
  top of an unmerged packaging change

## Output Contract

After PR-1:

- `apps/node/bundled-skills/` contains the four real shipped skill directories
- `.agents/skills/` no longer contains those four public skills
- `apps/node/package.json` ships `bundled-skills/` directly without prepack or
  postpack swapping
- the four shipped skill ids are the final branded ids listed above
- the shipped skill descriptions open with `Clawperator first-party bundled skill`
- docs, installer guide text, tests, and eval fixtures refer to the final skill
  ids even though the public noun is still `agent-skills`

After PR-2:

- `clawperator bundled-skills` is the primary command surface
- the primary install dir is `~/.clawperator/bundled-skills/`
- the primary env var is `CLAWPERATOR_BUNDLED_SKILLS`
- the primary doctor id is `host.bundled-skills.staleness`
- public docs use `bundled skills` as the primary product term

## Idempotency

- Re-running the Phase 1 relocation should not create duplicate bundled-skill
  trees or resurrect the pack script.
- Re-running Phase 2 renames should preserve the four final bundled-skill ids
  and frontmatter wording.
- Re-running `bundled-skills install` or `bundled-skills update` after Phase 3
  must be safe and keep the canonical install dir plus discovery symlinks
  aligned.

## Durable Follow-Up

| Knowledge | Permanent home |
| --- | --- |
| Canonical packaged-skill location and install-dir behavior | `apps/node/src/domain/skills/` plus public docs in `docs/skills/authoring.md` and `docs/host-agents.md` |
| Primary external noun and install guidance | `apps/node/src/cli/registry.ts`, `sites/landing-clawperator/public/install.sh`, `docs/host-agents.md`, `docs/setup.md` |
| Bundled-skill first-party branding rules | `apps/node/bundled-skills/*/SKILL.md` |
| Doctor terminology and remediation path | `apps/node/src/domain/doctor/checks/hostChecks.ts` and any user-facing docs that describe it |
| Eval command expectations for the authoring front door | `evals/harness/runner.py`, `evals/harness/test_run_eval.py`, `evals/specs/android-version/prompt-skill.md` |
