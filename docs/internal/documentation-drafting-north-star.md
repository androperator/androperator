# Documentation Drafting North Star

Documentation should let agents and people discover the relevant capability,
construct valid inputs, interpret results, and recover from likely failures.
Judge completeness by those outcomes, not by page length or a fixed template.

## Sources and Ownership

Verify behavioral claims against the code that owns them. Tests and live
observations help establish what is exercised; existing docs can be stale.
When implementation and docs disagree, fix the implementation or describe its
actual behavior without presenting aspirations as shipped features.

Use the source lookup below for the topic being changed. A typo or link fix does
not require a full API audit. Link to a concept's canonical owner instead of
duplicating its full contract. Brief context and a runnable example may repeat
what a reader needs at the point of use.

Public pages are authored in `docs/`; internal engineering guidance stays in
`docs/internal/`. The site and `llms-full.txt` are generated from canonical
inputs through docs-build. Keep both usable: clear prose for decisions and
explanations, tables for comparisons, and exact schemas/examples for contracts.

## Detail by Page Type

| Page | Include what the reader needs to act |
| --- | --- |
| Setup or how-to | Prerequisites, relevant path choices, runnable steps, observable success, likely failures and recovery |
| API reference | Valid inputs, omission/default semantics, outputs, command or request/response examples, error behavior |
| Contract | Complete coverage of the contract in scope, exact fields/codes, a worked example, related contract links |
| Configuration | Defaults, precedence, where a setting applies, invalid-value behavior, how to verify it |
| Design or workflow | Purpose, constraints, decision criteria, and evidence or source references where relevant |

For settings and contracts, preserve exact default values, valid ranges, enum
members, field paths, and error codes. Verify values against the owning source.
Show an observable success check when one exists; say when a setting cannot be
verified externally. Do not invent a JSON example, command, error code, or
three-item failure list just to fill a template.

Explain important branching conditions explicitly. A forced linear procedure
can mislead readers whose environment or current UI state differs.

## Efficient Authoring

Read the relevant parts of this guide when needed; there is no per-page reread
requirement. For unfamiliar page types, consult a relevant example:

- `docs/setup.md` for setup flows.
- `docs/api/actions.md` for action contracts.
- `docs/api/environment.md` for configuration.

Use those pages for useful structure, not as minimum length targets. Review the
changed claims and examples, fix gaps, then validate the coherent batch with
`./scripts/docs_build.sh`. Commit source and tracked generated output together.
Use additional passes when a defect or remaining uncertainty warrants them;
there is no minimum draft/refinement count or commit count per page.

Document the current product. Remove superseded guidance once remaining useful
content is migrated. Release history and necessary breaking-change migration
notes belong in their designated release/version context.

## Source Lookup

Paths below are repository-relative. Consult only the entries relevant to the
claim being authored.

| Topic | Verify against |
|-------|---------------|
| CLI commands, flags, aliases | `apps/node/src/cli/registry.ts` |
| Action types and parameters | `apps/node/src/contracts/execution.ts` |
| Selector flags and behavior | `apps/node/src/cli/selectorFlags.ts`, `apps/node/src/contracts/selectors.ts` |
| Error codes and meanings | `apps/node/src/contracts/errors.ts` |
| Result envelope shape | `apps/node/src/contracts/result.ts` |
| Execution limits and timeouts | `apps/node/src/contracts/limits.ts` |
| Execution validation | `apps/node/src/domain/executions/validateExecution.ts` |
| Execution runtime | `apps/node/src/domain/executions/runExecution.ts` |
| Snapshot extraction | `apps/node/src/domain/executions/snapshotHelper.ts` |
| Environment variables | Grep `process.env.CLAWPERATOR` across `apps/node/src/` |
| Runtime config | `apps/node/src/adapters/android-bridge/runtimeConfig.ts` |
| Navigation builders | `apps/node/src/domain/actions/waitForNav.ts`, `openApp.ts`, `openUri.ts` |
| Recording format | `apps/node/src/domain/recording/recordingEventTypes.ts` |
| Recording parsing | `apps/node/src/domain/recording/parseRecording.ts` |
| Recording CLI | `apps/node/src/cli/commands/record.ts` |
| Skills registry | `apps/node/src/contracts/skills.ts`, `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts` |
| Skills runtime | `apps/node/src/domain/skills/runSkill.ts`, `apps/node/src/domain/skills/skillsConfig.ts` |
| Skills CLI | `apps/node/src/cli/commands/skills.ts` |
| Skill validation | `apps/node/src/domain/skills/validateSkill.ts` |
| Skill compilation | `apps/node/src/domain/skills/compileArtifact.ts` |
| Operator setup | `apps/node/src/cli/commands/operatorSetup.ts`, `apps/node/src/domain/device/setupOperator.ts` |
| Permissions | `apps/node/src/domain/device/grantPermissions.ts` |
| Version compatibility | `apps/node/src/domain/version/compatibility.ts` |
| Doctor checks | `apps/node/src/domain/doctor/checks/` |
| Serve endpoints | `apps/node/src/cli/commands/serve.ts` |
| Install script | `sites/landing-clawperator/public/install.sh` |


## Terminology

- Use "operator" for the Android operator app.
- Distinguish execution actions, CLI commands, Serve endpoints, MCP tools, Node
  contracts, and result envelopes.
- Use "selector" except for the specific `NodeMatcher` type.
- Prefer primary flags `--device` and `--timeout`.
- Use the current flat CLI syntax, such as `snapshot` and `click --text`.
- Write Clawperator in full and use regular hyphens, not em dashes.

## Completion

The changed scope is complete when its claims match the implementation, its
examples and links are usable, relevant failure behavior is covered, and the
docs build passes. Describe any unverified behavior precisely; do not claim that
a successful build alone proves live device behavior.
