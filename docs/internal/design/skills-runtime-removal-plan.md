# Remove the runtime skills framework

Date: 4 October 2026. Status: revised plan following the project owner's explicit
scope clarification. This is documentation of proposed work, not implementation
or authorization to push, publish or open a PR.

## Decision and authority

The project owner states that Androperator has **no users and zero compatibility
obligations**. There is **no need for migration**. Do not spend implementation
work preserving an interface, installed package, saved wrapper or workflow solely
because the current code supports it.

Remove every public command under `androperator skills` and the supporting
runtime-package framework. Keep Android execution and structured evidence in
Androperator. Agents own reusable instructions, app-specific strategy and
optional orchestration; ordinary helpers may support those instructions.

This supersedes the smaller permanent runner and compatibility migration in the
[original audit](skills-architecture-audit.md), and the compatibility transition
in the independent V2 report (audit commit `5d6acaa5`, same source baseline
`627e128f`). The audits' implementation findings remain useful. Their caution
about preserving unknown external users no longer applies.

## How zero compatibility obligations changes the plan

| Earlier recommendation | Revised decision |
| --- | --- |
| Inventory external callers before deciding whether to remove the runner | No adoption investigation or external-caller gate. Internal reference searches are implementation dependency checks only. |
| Maintain a compatibility runner while callers move | Delete it in the coherent removal change. No hidden command or legacy support period. |
| Design a smaller manifest and explicit-path run/validate API | Do not build a replacement framework or rename the runner. |
| Deprecate registry configuration and ID lookup | Remove their contracts directly, including help, installation and diagnostics. |
| Preserve old result frames and saved-wrapper readers | Keep only evidence handling needed by current retained capabilities. No legacy reader solely for compatibility. |
| Fix runner status precedence and timeout escalation before retirement | Do not repair code that will be deleted. Carry relevant outcome/deadline lessons into retained helpers only where needed. |
| Prove equivalent behavior for every old executable skill | Validate retained product workflows. Do not port the former catalog or reproduce its feature set. |
| Wait for a staged or announced breaking migration | No transition period or migration tooling. Normal release communication can describe the removal without promising continuity. |

Removing compatibility does not authorize deleting local user files, historical
repositories or recordings. There is no need to modify them to remove the API.
It also does not justify leaving broken imports, stale guidance or failing tests
in the retained product. Update or delete internal dependents in the same scope.

## Remove

- All eleven runtime commands: `list`, `get`, `for-app`, `search`, `new`,
  `validate`, `compile-artifact`, `run`, `install`, `update` and `sync` under
  `androperator skills`. No aliases or replacement skill-execution namespace.
- `GET /skills`, `GET /skills/:skillId` and `POST /skills/:skillId/run`. Keep
  unrelated HTTP execution and evidence behavior.
- Runtime registry loading/search, collection indexes/shards/checksums,
  registry/manifest parity, package scaffolding, proprietary runtime skill-type
  validation, recipe compilation and child-agent launch/configuration machinery.
- `ANDROPERATOR_SKILLS_REGISTRY` and other runtime-only configuration, errors,
  result frames, schemas and logging fields once no retained capability uses them.
  Trace actual references; do not delete every variable with `SKILL` in its name
  blindly, because current example helpers also use execution/run context.
- Empty-registry setup and install-result fields, registry-specific host bridges,
  default child-agent/installed-runtime-skill doctor checks, and discovery-first
  routing in help and packaged guidance.
- Tests, fixtures and eval modes whose only purpose is the removed framework.
  Replace useful Android execution coverage with tests of retained interfaces.
  Remove stale generated docs routing and incoming links with their source pages.

Implementation owners are identified in the [audit's source-linked findings](skills-architecture-audit.md#what-exists-today).
Shared functionality currently located in `domain/skills/` must be separated
before deleting modules. Directory names do not determine product ownership.

## Preserve and simplify

Keep device selection/readiness, strict action/execution validation, selectors,
queries, reads, snapshots, screenshots, evidence capture, and the
`[Androperator-Result]` envelope with `commandId`/`taskId` correlation. Keep CLI,
MCP and HTTP transports for those operations.

Keep first-party host guidance currently distributed through `bundled-skills`,
including its installation/discovery support. Rewrite relevant orientation,
control-loop, authoring and upgrade guidance to stop requiring runtime registry
lookup. Do not force every one-off Android task through durable skill creation.

Keep the [agent-followed examples](../../../examples/skills/README.md) and useful
deterministic helpers. Prefer these existing examples over inventing another
package format. Agents observe current state, choose actions, handle supported
deviations and verify the requested result. A helper can parse evidence or carry
out a short operation on verified state without becoming a complete replay
strategy. Neither deterministic replay nor agent involvement alone guarantees
success.

Scheduling, process supervision and optional model delegation belong to the host
or explicitly chosen caller-owned tooling. Do not create a separate runner
package as part of this work. There is no compatibility requirement to supply a
replacement for hypothetical unattended clients.

## Recording and authoring

Keep `recording start/stop/pull/export` and useful inspection as evidence tools.
Capturing a demonstration is distinct from executing it. Recordings can help an
agent understand intent, learn a likely route, inspect UI events or diagnose a
failure. They remain useful without a skill registry or replay package.

Remove `skills new --recording-context` with the scaffold. It currently attaches
reference evidence to a generated package; it does not automatically produce
correct automation. Retained guidance can read recording/export artifacts
directly.

Rewrite recording-based authoring around optional demonstration-to-adaptive
instructions. The normal route is agent exploration of an authorized workflow,
with reusable instructions saved when requested or worthwhile. Ask for human
demonstration only when it contributes missing knowledge or resolves a real
blocker. Do not require it merely because a catalog lookup found nothing.

A resulting skill should describe the goal, likely route, inputs, relevant
observations, supported recovery and outcome verification. It should not treat a
recorded sequence, screen position or elapsed delay as proof of the next state.

Assess `recording compare` on its retained value, not its existing coupling. If
it still serves a concrete recording/evaluation workflow, accept direct evidence
from that workflow and remove the requirement for a saved `skills run` wrapper.
If it only serves retired replay/package machinery, remove it. Do not retain its
old wrapper reader or design a general goal-result standard to satisfy nonexistent
compatibility obligations. This is an internal scope decision during reference
tracing, not a migration phase or external-user gate.

## Implementation order

1. Trace references and separate shared execution/configuration and bundled-guidance
   code from runtime-only modules. Determine whether recording comparison has a
   retained use. This is bounded dependency analysis, not another architecture audit.
2. Remove the commands, skill HTTP routes, runtime modules, install/doctor coupling
   and runtime-only contracts. Update or delete affected internal callers and tests
   together. Do not introduce temporary adapters between steps.
3. Rewrite authoring/onboarding documentation and bundled instructions around the
   active agent and optional helpers. Remove stale recipe-design claims and obsolete
   source-map/navigation references. Update useful evals and smoke checks to retained
   execution/evidence interfaces; drop runtime-package-only scenarios.
4. Run relevant validation and repair regressions in retained behavior. Regenerate
   docs and review the resulting public command/help surface. Commit coherent changes.

These steps organize implementation dependencies; they are not public transition
phases. One coherent removal change is preferred over a compatibility rollout.
No product changes are included in the current documentation-only request.

## Acceptance

- No registered `androperator skills` commands or skills-specific HTTP routes
  remain. Removed names receive ordinary unknown-command/route behavior, without
  bespoke compatibility shims.
- A fresh install and normal doctor run need no runtime registry or child-agent
  CLI. Bundled guidance installation and Android readiness still work.
- A host agent can use and author instructions without `skill.json`, an Androperator
  registry, a mandatory `run.js`, or launching another agent.
- Retained recording capture/export still provides usable evidence; retained
  authoring guidance can consume it without runtime package scaffolding.
- An agent-followed Settings scenario proves the requested values from current
  evidence on an explicit device. Include a bounded unexpected-state case or
  truthful blocked outcome; do not infer broad reliability from one successful run.
- Relevant Node tests, installer checks, docs build, example/helper tests and
  retained recording/eval checks pass. Run device checks where changed behavior
  requires them. Do not recreate tests for deleted APIs just to preserve counts.
- No dangling imports or active instructions direct agents to removed APIs. Old
  changelog/version history may remain historical; active design guidance may not
  advertise obsolete guarantees.
- The diff contains no replacement runtime framework, migration tooling,
  deprecation lifecycle, or support for old packages solely for compatibility.

Success is a smaller, coherent actuator and a direct agent workflow, not feature
parity with the former catalog architecture.
