# Skills API and architecture audit

Audit date: 4 October 2026. Baseline: freshly fetched `origin/main`, commit `627e128f` (CLI 1.0.1). This is a recommendation, not an implementation plan approved for execution. Product behavior is unchanged.

## Recommendation

Make instructions followed by the current agent the default skills model. Keep a small, optional execution facility for explicitly selected local automation, preserving useful result and process supervision contracts. Stop making the runtime registry and a possible child agent part of every user's onboarding. Retire catalog-specific indexes and distribution assumptions through a deliberate compatibility migration.

Do not simply delete `androperator skills`, and do not equate removing its registry with completing the architectural work. The namespace currently combines discovery, package validation, scaffolding, executable supervision, result interpretation, and obsolete distribution vocabulary. Those responsibilities have different consumers and deserve separate decisions. Retain the existing namespace as a compatibility surface during migration; a rename alone offers little value.

This conclusion follows both the actuator principle in [AGENTS.md](https://github.com/androperator/androperator/blob/627e128f/AGENTS.md) and the concrete consumers below. Running a user-selected script is compatible with deterministic execution. Choosing an app strategy or insisting that an already-running agent launch another agent is a different responsibility.

## What exists today

### Public interfaces and discovery

[CLI registration](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/cli/registry.ts#L2890) exposes `list`, `get`, `for-app`, `search`, `compile-artifact`, `new`, `validate`, `run`, `install`, `update`, and `sync`. `get` returns registry metadata, including the instruction path; it does not execute or interpret `SKILL.md`. [Search](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/searchSkills.ts) is deterministic filtering/ranking over one registry: exact app/intent filtering and keyword/id/summary matching. It is not online discovery, semantic retrieval, or a scan of host skill directories.

[Registry loading](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/adapters/skills-repo/localSkillsRegistry.ts) chooses an explicit function argument, then `ANDROPERATOR_SKILLS_REGISTRY`, then cwd-relative `skills/skills-registry.json`. Only missing implicit paths permit fallbacks: a repository-relative candidate when cwd is `apps/node`, then `~/.androperator/skills/skills/skills-registry.json`. Blank configured paths fail; explicit/configured missing paths do not silently fall back. The repository root is inferred as the registry file's grandparent. This is a collection-layout contract, not merely a configurable filename. Loading only checks that `skills` is an array; deeper validation happens elsewhere.

[HTTP serve](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/cli/commands/serve.ts#L614) offers list/get/run routes backed by the same functions. [MCP tools](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/mcp/tools/index.ts) expose device actions, execution, configuration and evidence, without a skills discovery/run tool. An MCP-only host therefore cannot assume access to these CLI workflows. At the Node layer, functions such as `runSkill`, `validateSkill` and `compileArtifact` are exported from individual modules. [Package metadata](https://github.com/androperator/androperator/blob/627e128f/apps/node/package.json) points `main` at the CLI and declares no dedicated library export map; this is not a polished top-level skills SDK. Deep imports are possible but their external adoption was not established.

### Execution and evidence

[CLI run](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/cli/commands/skills.ts#L400) validates by default, resolves the Operator/device, checks APK presence and interactive readiness, injects execution environment, and invokes [runSkill](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/runSkill.ts#L625). Serve has corresponding preflight. Direct `runSkill` imports do not perform that whole CLI/HTTP validation/readiness sequence. That distinction matters when claiming that the runtime always validates or always needs a device.

The runner selects a declared JavaScript script preferentially, then a shell script, then the first script. Agent metadata instead requires `scripts/run.js`. It captures stdout/stderr, correlates logs with a skill run ID, forwards signals, sends SIGTERM on timeout, checks optional output substrings, and parses a terminal `[Androperator-Skill-Result]` frame. The default timeout is 120 seconds; explicit timeout overrides manifest agent timeout. The implementation waits for child close after SIGTERM and contains no hard-kill escalation: timeout supervision should not be described as an unconditional deadline against an uncooperative child.

[Manifest metadata](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/skillManifest.ts) is authoritative for `agent` and `contract`; registry/manifest parity does not make the registry authoritative for agent execution settings. The core resolves the configured agent executable, but the skill harness actually launches it. Docs describe Codex as the supported orchestration path; [executable resolution](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/agentCli.ts) is not hardcoded to only the name `codex`. Another host would still need a compatible launcher and result adapter. Executable discovery proves neither authentication nor model compatibility.

The [result schema](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/contracts/skillResult.ts) and runner preserve checkpoints, terminal verification, domain results and source metadata. The runner injects source from the manifest and checks frame structure/version/identity. Declared `node_text_matches` verification compares reported text against a matcher rendered from invocation inputs. This checks consistency of reported evidence; it does not independently observe Android. Script skills may succeed without any frame. Without declared verification, wrapper process success does not universally imply the embedded domain result succeeded. Consumers must inspect the inner result and actual evidence, not only exit zero.

[Execution configuration](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/skillsConfig.ts) has useful contracts independent of discovery: branch-local CLI selection, Operator selection and explicit device propagation. CLI/serve clear an inherited device selection when no explicit selection was supplied. Script execution prepends an explicit device to argv; agent harnesses receive original args and injected program/input/agent settings. Removing `ANDROPERATOR_SKILLS_REGISTRY` would not justify removing these other variables. The examples also use several execution/logging variables directly.

### Authoring, validation and artifacts

[Scaffolding](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/scaffoldSkill.ts#L314) requires a readable registry, derives application/intent from a dotted ID, writes instructions, duplicated manifest metadata and JS/shell entrypoints, and updates the registry. Optional recording context is validated/copied reference evidence, not an automatic conversion of a recording into correct automation. The starter closes/opens an app, waits with fixed sleeps and snapshots it. It does not implement the user's app goal or emit the complete SkillResult required by the richer authoring workflow.

[Validation](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/validateSkill.ts) checks layout, file existence, registry/manifest parity, replay/orchestrated frontmatter and optional payloads. A script-only dry run explicitly skips payload validation. It also contains an app-specific legacy frontmatter exception and substantial generated-index validation. The latter is conditional on a `scripts/generate_skill_indexes.sh` file, so a new empty workspace does not require those indexes. It remains maintenance coupling to the former catalog's min index, JSONL, shards and checksum manifest.

[compileArtifact](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/compileArtifact.ts) substitutes recipe variables, creates deterministic default correlation IDs, validates an Execution, and returns it with `mode: artifact_compiled`. It does not execute the payload. This has value for repeatable parameterized automation, but its useful operation does not inherently require catalog lookup. The [skills smoke script](https://github.com/androperator/androperator/blob/627e128f/scripts/androperator_smoke_skills.sh) uses it before `exec`, defaulting to a Google Home climate skill that installation no longer supplies. That smoke is a real code consumer, not proof of a working clean-install user journey.

### Installation, guidance and doctor

[Sync](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/syncSkills.ts) now only creates/preserves an empty local registry, accepts `main`, rejects other refs, and downloads nothing. [Install](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/cli/commands/install.ts#L340) still invokes it as a setup step. The shell installer delegates post-bootstrap work to the Node installer. CLI help nevertheless advertises pulling latest skills and pinning Git refs. This is directly contradicted by current execution, rather than merely outdated terminology in historical notes.

Keep this separate from [bundled skill installation](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/skills/copyBundledSkills.ts): packaged orientation, control-loop, discovery, recording-authoring and upgrade instructions are installed for agent hosts. The canonical store, Claude/Codex symlinks and generic-agent managed copies serve an actual host-integration purpose. Runtime app skills are not mirrored into those directories. [Host setup](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/host/hostSetup.ts#L510) writes a local guide, registry summaries and an existing shared AGENTS bridge. Its default discovery-first instructions can send every new user through an empty inventory.

[Doctor](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/doctor/checks/hostChecks.ts#L246) checks the default orchestration CLI (Codex), installed skills' agent dependencies and bundled guidance freshness. [Critical readiness policy](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/doctor/criticalChecks.ts) does not make these skills advisories critical Android prerequisites. Do not claim missing Codex makes the actuator unusable. However, default checks still add unrelated host warnings; the registry loader can emit a warning before the skill-aware check converts an unconfigured missing registry into a skip/pass.

## Concrete consumers and evidence strength

| Consumer | Current dependency | What it establishes |
| --- | --- | --- |
| [Recording authoring guidance](https://github.com/androperator/androperator/blob/627e128f/apps/node/bundled-skills/androperator-skill-author-by-recording/SKILL.md) | Registry, scaffold, validate/run, saved wrapper and SkillResult | A maintained product workflow uses these contracts; deleting the API breaks its instructions and proving loop. |
| [Orientation](https://github.com/androperator/androperator/blob/627e128f/apps/node/bundled-skills/androperator-agent-orientation/SKILL.md) and [bounded discovery](https://github.com/androperator/androperator/blob/627e128f/apps/node/bundled-skills/androperator-skill-author-by-agent-discovery/SKILL.md) | Runtime lookup before adaptation/authoring | Current first-party consumers, but also self-imposed discovery dependency. Their existence alone does not prove catalog demand. |
| [Replay eval](https://github.com/androperator/androperator/blob/627e128f/evals/harness/replay.py#L226), [live skill eval](https://github.com/androperator/androperator/blob/627e128f/evals/harness/live_skill_eval.py#L646), [authoring eval prompt](https://github.com/androperator/androperator/blob/627e128f/evals/specs/android-version/prompt-skill.md) | Isolated registry environment, skill invocation, saved evidence | Runnable development infrastructure depends on the interface. Solax live runs require locally supplied app automation; the new installer does not furnish it. |
| [Recording comparison](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/domain/recording/compareRecording.ts#L571) | Saved successful skills-run wrapper containing SkillResult | A separate product capability is coupled to the output contract, not to discovery. Automatic compare mode also uses source kind. |
| [Serve integration tests](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/test/integration/serve.test.ts), [skills unit tests](https://github.com/androperator/androperator/blob/627e128f/apps/node/src/test/unit/skills.test.ts) | Registry, wrapper, verification and failures | Broad regression investment; not external adoption statistics. Serve tests substitute device readiness. |
| [Current examples](https://github.com/androperator/androperator/blob/627e128f/examples/skills/README.md) | Agent instructions, direct CLI, optional local evidence helpers; optional Jev | No runtime registry, `skill.json`, child Codex or `skills run` requirement. Helpers use Node built-ins and retain verifiable evidence. |
| Former companion repository | Generated catalog and executable orchestration | Historical design and concrete old examples; not a required Androperator distribution dependency. |

There is no usage telemetry in this audit. Private user scripts, deep-import clients and remote HTTP consumers were not inventoried. Absence of bundled runtime skills is not evidence that nobody has authored one. Conversely, fixtures and prompts alone do not prove market demand for a generalized workflow platform.

## History versus current behavior

GitHub metadata confirms [PR #366](https://github.com/androperator/androperator/pull/366) is closed with no merge timestamp. Its files proposed discovery/registry/configuration changes as well as executable examples. Those changes cannot be assumed present.

[PR #367](https://github.com/androperator/androperator/pull/367) merged on 3 October 2026; its file set contains examples, helpers/tests, skills documentation and navigation. It does not change runtime discovery, installer, doctor or registry contracts. Its README explicitly reserves the API decision for this audit.

The local former skills repository was inspected at `76bad61b5915e70dd53f38111eaf932c5ff92706`. Its README documents generated registry/index distribution. [Historical PR #52](https://github.com/clawperator/clawperator-skills/pull/52), merged on 20 September 2026, records real Codex/optional-Jev orchestration and bounded retained evidence, along with explicit reliability limits. That supports the usefulness of app-specific evidence helpers and optional delegation; it does not require a community catalog or core-owned planning. Current examples adapt this work without its child-agent launcher.

The migration notebook's checked-off registry-removal items and PR-progress prose are historical intent. Current loader, environment references and GitHub merge metadata take precedence. No assertion here relies on those checkbox states.

## Alternatives and host implications

| Approach | Benefit | Cost / reason to reject or select |
| --- | --- | --- |
| Retain the entire current model | Minimal compatibility work; one registry-backed package model | Empty-install discovery detours, duplicated metadata, stale catalog vocabulary and universal agent advisories persist. Not recommended. |
| Delete all skills machinery now | Smallest core; hosts run instructions/scripts themselves | Breaks authoring, evals, HTTP clients and recording comparison; discards result supervision and replay conveniences. Too broad for the evidence. |
| Replace registry with folder scanning only | Removes manual index maintenance | Still makes Androperator own discovery; introduces search roots, duplicate IDs and precedence questions; does not resolve orchestration/default-routing confusion. Insufficient by itself. |
| Optional explicit local runner plus host-owned instructions | Preserves concrete executable/evidence uses while simplifying the default experience | Requires compatibility adapters and coherent migration. Recommended. |

For Codex, Claude Code and other hosts with native skill support and shell access, the host should discover/read instructions and use CLI actions or deterministic helpers. Keep host policy, model selection, authorization and optional delegation there. Installing another Codex CLI merely because a task uses Android is unnecessary.

For an agent with only MCP, direct device/evidence tools are already the usable interface. Skill instructions can be supplied by that host; shell-specific helpers require a suitable local execution facility or an adapted example. Do not promise that copying a SKILL.md makes all helpers usable in every host.

For a scheduler, HTTP client or agent deliberately invoking executable automation, a bounded runner with stable structured results remains useful. It should accept an explicit local package/manifest, avoid ambiguous global discovery, and preserve the preflight/result behavior expected by existing callers. A child agent may be a deliberate implementation of such a package, but its host adapter belongs with the package or optional integration, not in the universal actuator prerequisites. Do not add arbitrary remote-path execution to HTTP as a side effect of a local CLI path interface; preserve an explicitly registered/allowed server execution set.

The recommended destination for the current commands is explicit:

| Surface | Recommended destination after compatibility migration |
| --- | --- |
| `skills run`, `validate` | Keep for explicit local executable packages; validate structure separately from proving a live outcome. |
| `skills new` | Keep only as an optional executable-package starter; agent-followed instructions need no manifest/scaffold ceremony. Replace fixed sleeps when modernizing the starter. |
| `skills get` | Retain package inspection, with an explicit local target; legacy ID lookup remains transitional. |
| `list`, `search`, `for-app` | Deprecate as universal skill discovery. Let hosts discover their instructions; retain legacy collection lookup only during migration or as a separately justified optional integration. |
| `install`, `update`, `sync` | Retire the empty-registry lifecycle; keep distinct bundled host-guidance installation. |
| `compile-artifact` | Preserve existing recipe users during migration; decouple input-file compilation from registry identity if it remains a supported convenience. |
| Result contracts and recording comparison | Preserve and separate from discovery. A host-followed workflow may produce compatible evidence without using the runner. |

The main cost here is architectural coupling and maintenance, not a large unique dependency download. Runner/scaffold/index code largely uses Node built-ins and schemas; shared server, MCP and validation packages also serve non-skills features. Deleting skills code would not automatically eliminate those package dependencies.

## Proposed scope and order, if implementation is approved

1. Correct the current story first. Align help with empty-workspace initialization; distinguish agent-followed instructions from executable packages; make discovery conditional on a known local collection; scope doctor agent checks to the chosen/installed capability. Preserve first-party bundled guidance installation. Keep ordinary install/device readiness independent of a runtime workspace.
2. Establish one canonical local executable manifest and an explicit-path run/validate route. Preserve current ID/registry lookup as an adapter initially. Define path resolution, script working directory, argument/device handling, timeouts, versioning and result provenance before changing callers. Keep app strategy outside core. Move shared Operator/CLI configuration out of skills-specific ownership as needed. Extract result parsing/supervision without silently changing its success semantics.
3. Migrate actual consumers together: recording-authoring instructions and fixtures, replay/live eval harnesses, CLI and HTTP adapters, host setup, environment docs and recording comparison. Let comparison consume a versioned result artifact independently of how execution was discovered, while retaining a saved-wrapper reader. Preserve command/task/run correlation and failed/indeterminate evidence. Keep a generic recipe compilation capability only where current artifact consumers need it; avoid building a new templating platform.
4. Remove obsolete catalog responsibilities after adapters are proven: generated shard/index freshness policy, app-specific compatibility exceptions after explicit migration, misleading install/update/sync lifecycle and compulsory registry initialization. Deprecate registry configuration before removal; do not reinterpret an existing configured path as something else or delete user collections. Do not replace it with another compulsory global search-root environment contract.
5. Validate a clean install with no registry or agent CLI, agent-followed Settings execution, an executable local replay skill, an explicitly delegated package where supported, serve invocation, recording comparison and eval replay. Use real device evidence for affected runtime behavior, plus no-match/duplicate/path failures and timeout/failure/result regressions. Only then remove compatibility in an announced breaking release if warranted.

Compatibility inventory must include `ANDROPERATOR_SKILLS_REGISTRY`, registry-relative paths, IDs and duplicate resolution, `skill.json` and frontmatter, agent configuration overrides, injected argv/env, script selection, result frames, CLI JSON versus HTTP wrappers, error codes, install output fields, doctor check IDs and saved eval/recording artifacts. Keep execution variables used by examples unless individually migrated. Existing `-replay`/`-orchestrated` names should remain usable identifiers rather than being mass-renamed.

Success means a fresh user can use the actuator and agent-followed examples without an empty catalog ceremony, while an existing executable skill still has a documented migration preserving its useful guarantees. It does not mean replacing every legacy abstraction in a single PR.

## Validation and limits

The audit used a fresh worktree under the requested repository `.worktrees/` directory, fetched `origin/main`, read current AGENTS.md, and built the worktree's Node package after `npm ci --ignore-scripts`. No global CLI was used for probes.

- 323 tests passed across skills, local workspace setup, doctor host checks and host setup.
- 108 tests passed across agent CLI resolution, bundled skills, install commands and recording comparison. The cross-repository baseline assertion returns early unless `ANDROPERATOR_SKILLS_ROOT` is configured; this audit did not exercise that optional assertion.
- All 18 current example tests passed.
- Isolated temporary-workspace probes: initialization and empty listing succeeded; lookup of the bundled version example returned `SKILL_NOT_FOUND` with exit 1; scaffolding and dry-run validation succeeded with payload validation explicitly skipped; blank registry environment failed with `REGISTRY_READ_FAILED` and exit 1; non-main sync returned `SKILLS_SYNC_FAILED`; direct fixture `runSkill` returned `TEST_OUTPUT:audit` with a null SkillResult.

The complete `./scripts/docs_build.sh` pipeline passed, including route/link validation and the organization check (no organization warnings). This internal audit is intentionally excluded from public docs assembly.

These are host-only checks. No Android installation, live app execution, authenticated child-agent run, Jev request or live eval was performed. This audit makes no new device reliability claim. Full Node/installer suites were not run; selected tests and implementation inspection support the architectural conclusions, not comprehensive product certification. Raw host-test/probe logs were retained locally outside version control. No product behavior changes, push or PR are part of this audit.
