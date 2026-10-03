# Repository Guidelines

Androperator is the deterministic "hand" for an agent's "brain". Planning and
app-specific strategy stay in the agent or skills; the Android runtime and Node
API execute validated actions and return structured evidence.

## Working Scope and Completion

Read the sources relevant to the requested change. Use the routing below when
needed; there is no required full-repository reading pass.

Complete the requested scope through implementation, relevant validation,
repair of failures caused by the change, documentation, and local commits.
Continue through those steps without pausing for approval of routine local work.
Stop when the scope is complete or a missing decision, permission, or external
dependency blocks it. Report any validation that could not run and what remains
unproven. Do not expand into unrelated fixes or later PRs.

## Runtime Contracts

- The Node API/CLI is the canonical interface for agent-driven device actions.
  Preserve the `[Androperator-Result]` envelope and stable `commandId`/`taskId`
  correlation end to end.
- Use the branch-local build in `apps/node/` for development and verification,
  not the global `androperator` install, which may lag the checkout.
- Local development defaults to `com.androperator.operator.dev`; pass
  `--operator-package com.androperator.operator.dev`. Use
  `com.androperator.operator` for explicit release validation.
- Keep contracts strict. Distinguish omitted strings from `""` with explicit
  `undefined` checks; reject blank values where invalid. Avoid truthy fallbacks
  on contract fields such as file paths.
- Normalize a Node preflight or fallback to success only when it succeeded.
- Verify branch claims against code and runtime, not task notes or commit prose.

## Source Routing

| Work | Source |
| --- | --- |
| CLI commands, flags, aliases | `apps/node/src/cli/registry.ts` and command modules |
| Selectors | `apps/node/src/cli/selectorFlags.ts`, `apps/node/src/contracts/selectors.ts` |
| Actions, errors, results | `apps/node/src/contracts/execution.ts`, `errors.ts`, `result.ts` |
| Doctor checks | `apps/node/src/domain/doctor/checks/` |
| Serve endpoints | `apps/node/src/cli/commands/serve.ts` |
| Android behavior | `apps/android/` |
| Device setup | `docs/setup.md` |
| API design decisions | `docs/internal/design/node-api-design-guiding-principles.md` |
| Skill and prompt maintenance | `docs/internal/design/agent-instructions.md` |

## Documentation and Sites

Verify changed behavioral claims against their implementation. Document current
behavior, exact contract values, and observable success/failure conditions.
Keep authored docs aligned with public API, CLI, setup, and runtime changes in
the same change. Durable engineering guidance belongs in `docs/internal/design/`.

Use `.agents/skills/docs-author/SKILL.md` for authored docs and
`.agents/skills/docs-build/SKILL.md` for regeneration.

| Surface | Authored inputs | Build |
| --- | --- | --- |
| `androperator.com` README-based landing site | root `README.md`, `sites/landing/`, installer in `sites/androperator-public/`; full docs generated during build | `./scripts/site_build.sh` |
| `clawperator.com` preserved landing site | `sites/landing-clawperator/`; legacy machine-facing files and installer in `sites/landing-clawperator/public/` | `./scripts/site_build_clawperator.sh` |
| `docs.androperator.com` technical docs | `docs/`, code-derived inputs in `apps/node/src/`; root static files in `sites/docs/static/` | `./scripts/docs_build.sh` |

`sites/docs/.build/` and `sites/docs/site/` are generated. Fix the canonical
source or generator, then rebuild; do not hand-edit output. Use
`sites/docs/source-map.yaml` for code-derived pages and markers,
`sites/docs/ownership.yaml` for generated command detail routing, and
`sites/docs/mkdocs.yml` for navigation. Commit source and tracked regenerated
output together. When removing a page, remove its navigation, source-map entries,
and incoming links, then regenerate.

The preserved landing and docs sites deploy to Cloudflare after merge to `main`.
The new landing project remains staged until release cutover. Website-only
changes normally need source/build validation, not manual deployment.
`sites/landing/out/` is generated and ignored; never commit it. APK aliases reuse
the canonical redirect Worker and require published downloads metadata.

Remove stale guidance after migrating any still-useful content. Keep historical
material only where release/version management requires it.

## Skills and Task Packs

- Agents create and run local skills. Optional bundled examples will live in
  `examples/skills/`; no companion skills catalog is required.
  Canonical skill documentation lives here in `docs/skills/`.
- Repo maintenance skills live in `.agents/skills/`. Keep descriptions narrowly
  scoped and load conditional references only when needed.
- For contract changes affecting runtime skills, update bundled authoring skills
  and fixtures in lockstep and run relevant skills smoke checks.
- `tasks/` holds temporary handoffs. Separate active tasks may have separate
  packs, including small tasks. Before retiring a pack, move durable knowledge
  to docs, skills, or code and preserve actionable follow-up.
- Task cleanup can run on an implementation branch once its work is complete
  and validated; it does not require a PR, merge, or release. For a sequence of
  PRs, retain concise `[DONE]` entries and actionable unfinished phases. Delete
  the pack once all planned work is complete, including before the final PR
  merges. Cleanup does not assert a merge or satisfy a merged-code prerequisite.

## Validation

Choose checks for the changed behavior. Documentation or instruction-only edits
do not require Android installation or unrelated runtime suites.

| Changed surface | Validation |
| --- | --- |
| Node API/CLI | `npm --prefix apps/node run build && npm --prefix apps/node run test` |
| Android | `./gradlew :app:assembleDebug` and `./gradlew :app:testDebugUnitTest` |
| Device/runtime behavior | Install the matching APK and verify a real scenario on an explicit device |
| Docs | `./scripts/docs_build.sh` |
| Androperator landing site | `./scripts/site_build.sh` (includes docs and landing validation) |
| Preserved landing site | `./scripts/site_build_clawperator.sh` |
| Installer | Matching coverage in `validation/install/` and `./validation/install/test_install.sh` |

Build Node before tests that consume `dist/`; do not run build and test in
parallel. CLI option regressions must cover valid, invalid, and missing values,
global/command-local placement where supported, exit codes, and structured JSON.

For gestures, accessibility, navigation, screenshots, snapshots, and runtime
skills, verify the intended result on a physical device or emulator when a
runnable path exists. A successful process exit alone does not prove the right
screen, persisted state, output marker, or artifact. Add regression coverage for
live failures discovered during the change.

Relevant device helpers:

- Debug install: `./gradlew :app:installDebug`; launch the app's actual main activity.
- Permissions: `./scripts/androperator_grant_android_permissions.sh`.
- Ingress: `./scripts/androperator_validate_operator_ingress.sh`.
- Smoke: `./scripts/androperator_smoke_core.sh`, `./scripts/androperator_smoke_skills.sh`.
- Opt-in integration: `ANDROPERATOR_RUN_INTEGRATION=1 ./scripts/androperator_integration_canonical.sh`.
- Formatting: `./scripts/apply_coding_standards.sh -f`.

New repo validation harnesses belong in `validation/` and should be wired into
CI there. Repeat or broaden checks when changes, failures, or unresolved risks
justify it; successful checks need no ritual rerun.

### Device Selection and Measurements

Check `adb devices` or branch-local `devices` before choosing a target.
Pass `--device <device_serial>` when multiple devices are connected. Prefer a
physical device for skill testing unless the scenario calls for an emulator;
both are supported targets.

For accessibility measurements, verify that the app and input method actually
emit the events being measured. adb input may differ from human input. If a
substitute screen is needed, record why, preserve per-event evidence locally,
and report missing event categories and other measurement limits.

## Privacy and Git

Use placeholders such as `<device_serial>`, `<person_name>`, and `<local_user>`
in committed examples. Do not hardcode private names, device identifiers, or
machine paths. Do not abbreviate Androperator to Claw; Claw refers to OpenClaw or
similar agents. Use regular hyphens rather than em dashes in Markdown.

Keep `core.hooksPath=.githooks` and do not bypass hooks with `--no-verify`.
The local terms file is `~/.androperator/blocked-terms.txt`, with one term per
non-empty line and `#` comments. `ANDROPERATOR_BLOCKED_TERMS_FILE` overrides
its location. A missing file permits commits; an unreadable configured file
blocks them. The hooks scan effective author and committer identities, staged
content, and the sanitized commit message, case-insensitively, matching identifiers
or literal phrases as appropriate. Staged-content scans exempt PNG and WebP payloads with
a verified format signature and files named `KnownAppsRepository*`; text disguised
with a PNG or WebP extension is still scanned. Before pushing, the hooks also scan raw author
and committer identities and messages in the outgoing history.
Verify changes to this policy with `./validation/test_blocked_terms_policy.sh`.
Before release or force-push events, scan for blocked terms and verify history.

Semgrep, reviewdog, and their downloaded rules are development-only tooling. Never
ship their tools, scanner-only dependencies, rules, caches, configuration, or
download hooks in npm packages, APKs, installers, bundled skills, or deployed
websites. Our own rule-specific suppression comments are permitted in product
code, but published documentation must contain no scanner references or suppression
markers. Keep the
distribution checks in release workflows and site builds; new product distribution
paths must run them too. See `docs/internal/design/security-checks.md`.

Before opening a PR, run `python3 validation/security/check.py` against the
intended base branch. Resolve new findings and scanner failures. See
`docs/internal/design/security-checks.md` for setup, scope, and full scans.

Create narrow local Conventional Commits when coherent work is validated,
before returning for review. Prefer incremental commits over rewriting history.
Keep attribution trailers out of commit messages. Breaking contracts need
migration notes in the commit and relevant docs.

Push only when the user or active workflow requests remote sync. Never push
directly to `main` without explicit permission; use a PR by default. Keep local
worktrees under the repository's top-level `.worktrees/`, with descriptive
task-shaped names.
