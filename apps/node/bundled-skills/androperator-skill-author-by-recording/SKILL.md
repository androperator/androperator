---
name: androperator-skill-author-by-recording
description: Androperator first-party bundled skill. Create or update an Androperator skill from a fresh phone recording. Use when a developer wants the proving workflow after discovery has identified recording as the truthful next step, or when the app route is already well understood, and wants one front-door workflow that records a real device flow, derives the skill id from the recording and goal, defaults to replay on the first pass unless orchestrated is explicitly requested or clearly more truthful, and runs one self-test that surfaces the emitted SkillResult.
---

# Androperator Skill Author By Recording

Guide a developer through Androperator's recording workflow from "I can do this
once on my phone" to "I now have a truthful authored skill artifact."

This is the proving workflow. Do not split the user across helper skills in
this phase. The workflow must stay centered on:

1. record the flow once
2. keep the evidence
3. author the right skill shape from that evidence
4. run it once and inspect the result

## Relationship To Discovery

- `androperator-skill-author-by-agent-discovery` is now the zero-results front door when no
  installed runtime skill clearly matches or the app route is still too
  uncertain to record truthfully.
- Use this skill after discovery returns `proceed_to_recording`, or when the
  route is already known well enough that a separate discovery pass is not
  needed.
- Do not use this skill as the no-match router.

## What This Skill Owns

Use this skill when the user wants to create or revise a runtime skill from a
fresh phone recording.

This skill owns the authoring workflow only. The recording export is authoring
evidence, compare input, and maintenance evidence. It is not the runtime
program.

The runtime skill you author lives in a local workspace at
`<workspace>/skills/<skill_id>/`. Configure `ANDROPERATOR_SKILLS_REGISTRY`
for that workspace; no companion repository is required.

## Required Reading During Use

Read these durable sources before making authoring decisions:

- `https://docs.androperator.com/api/recording/`
- `https://docs.androperator.com/skills/authoring/`
- `https://docs.androperator.com/skills/overview/`
- `https://github.com/androperator/androperator/blob/main/docs/internal/design/skill-design.md`
- `https://github.com/androperator/androperator/blob/main/apps/node/src/contracts/skillResult.ts`
- `https://github.com/androperator/androperator/blob/main/apps/node/src/domain/skills/runSkill.ts`

Reuse those contracts. Do not invent a parallel recording, skill, or
`SkillResult` model inside this workflow.

## Non-Negotiable Rules

- Keep one human-facing entrypoint: `androperator-skill-author-by-recording`.
- Treat this skill as the proving step after discovery, not as the zero-results
  route selector.
- Treat the recording export as evidence, not as a finished skill or runtime
  recipe.
- Surface the concrete commands you run and the files they produce.
- Frame the first useful outcome as a personalized local skill unless you have
  evidence that the result is generic enough to share.
- Default to replay on the first pass unless the user explicitly asks for
  orchestrated or the recording evidence already shows orchestrated is the more
  truthful shape.
- Honor an explicit user request for `-replay` or `-orchestrated`.
- Author one requested or recommended skill shape per pass unless the user
  explicitly asks for both.
- Derive the initial `skill_id` after export analysis from the observed app and
  the user's plain-language goal. Do not require the user to invent a package
  name or reverse-domain id up front.
- Make the replay-versus-orchestrated recommendation explicit before you author
  code. If the recording evidence already shows replay would be untruthful or
  insufficient, say so plainly and author orchestrated in the same front-door
  workflow instead of forcing a fake replay-first detour.
- If replay proves untruthful, too brittle, or fails its first self-test,
  explain why and strongly recommend orchestrated as the next pass with clear
  pros and cons.
- Keep authoring-time recordings, exports, and self-test wrappers under
  `~/.androperator/recordings/<session_id>/` rather than `./recordings/` in the
  current repo.
- Do not author runtime skills that import contracts or helpers through
  machine-local absolute filesystem paths.
- Keep the retained sanitized baseline at
  `skills/<skill_id>/references/compare-baseline.export.json`.
- Do not list that retained baseline under `skill.json.artifacts`.
- For orchestrated skills, keep `SKILL.md` as the runtime agent program and
  keep `scripts/run.js` as a thin harness only.
- Do not declare success until you have run one self-test invocation and shown
  the resulting `SkillResult`.
- During creation and verification, own the fix loop for the just-authored
  skill. If the first self-test fails, patch the created skill, validate it
  again, and rerun it instead of stopping at the first broken draft.
- Choose stable named user-facing inputs before finalizing the authored skill.
  Keep `skill.json.contract.inputs`, `SKILL.md` examples, script arg parsing,
  and emitted `SkillResult.inputs` aligned.
- Do not ship positional-only public interfaces for non-trivial skills when a
  named flag would be clearer.
- Be explicit about authoring mode. `From scratch` means no same-app exemplar
  reuse. `Assisted from nearby patterns` means exemplar reuse is allowed, but
  you must disclose it.

## Inputs To Gather Up Front

Collect or confirm these inputs before recording:

- plain-language goal
- the discovery artifact when `androperator-skill-author-by-agent-discovery` already ran
- target app or apps to reset before recording starts
- whether the user explicitly wants `-replay`, `-orchestrated`, or wants the
  default replay-first path
- whether the user wants a strict `from scratch` pass with no same-app exemplar
  reuse, or the default assisted pass where nearby patterns may be consulted
  and disclosed
- target device id when more than one device is connected
- operator package
  `com.androperator.operator.dev` unless the user explicitly needs the release
  package

Do not require the user to supply a final `skill_id` before recording. Derive
it after export analysis from:

- the app package observed in the recording
- the user's plain-language goal
- the chosen shape suffix such as `-replay` or `-orchestrated`

Offer the derived id for confirmation or override after you have evidence, not
before.

## Decision Table

Use this first-match-wins table exactly:

| Condition | Action |
| --- | --- |
| User explicitly requests `-replay` | Author replay first and do not up-sell orchestrated in the same pass unless replay proves untruthful or fails self-test |
| User explicitly requests `-orchestrated` | Author orchestrated and do not force a replay-first detour |
| No explicit shape and the recording evidence already shows replay would be untruthful or insufficient | Explain why and author orchestrated now |
| No explicit shape and the flow still looks replay-safe | Author replay first |
| Replay authoring or self-test shows replay is not truthful or sufficient | Explain why, show replay versus orchestrated tradeoffs, and strongly recommend orchestrated as the next pass |
| User explicitly wants both variants | Treat sibling authoring as intentional extra scope, not the default |

## Replay-Safe Versus Orchestrated

Replay is the default first pass.

Use replay for simple, repeatable flows where fixed script logic is likely to
stay truthful.

Use orchestrated for complex workflows where you want the run driven by an AI
agent against the current UI, especially when the next step depends on current
state, mid-flow recovery matters, or terminal proof must reflect a persisted
outcome rather than a fixed tap sequence.

Do not describe replay as a lower-grade artifact. Replay and orchestrated are
both first-class maintained skill shapes.

When deciding whether orchestrated is already the truthful first pass, look for
signs like these in the recording export plus the user's stated goal:

- the next action depends on reading current UI state before acting
- the flow needs recovery from a mid-route or resumed app state
- the terminal proof depends on a persisted value that cannot be trusted from
  one fixed tap sequence alone
- the recording only captures one branch of a state-driven route
- a personalized first pass is still valid, but it needs an agentic runtime
  program rather than a deterministic macro

## Workflow

### 1. Confirm Scope And Show The Plan

Tell the user what you are about to do:

- confirm the target app or apps and close them first so recording starts from
  a fresh state
- start recording
- ask them to perform the flow once
- stop recording and pull the raw capture
- export the recording artifact
- derive the skill id from the observed app and the user's goal
- retain a sanitized compare baseline
- make an explicit replay-versus-orchestrated recommendation from the recording
  evidence and the user's goal
- author replay first only when it still looks truthful; otherwise author
  orchestrated directly
- run one self-test, inspect the `SkillResult`, and if it fails stay inside the
  created skill's repair loop until it passes or you hit a real blocker

Keep the Solax proving case separate from the generic workflow. If the user is
not authoring Solax, do not drag Solax-specific assumptions into the session.

Require the plain-language goal before recording starts. Do not block on a
final `skill_id`.

### 2. Reset Target Apps Before Recording

Before `recording start`, reset the user-confirmed target app or apps so the
recorded route starts from a fresh app state instead of a half-explored screen.

Use Androperator to close each target app explicitly.

For one target app, prefer the flat CLI:

```bash
androperator close --app <target_application_id> --device <device_serial> --operator-package <operator_package>
```

For multiple target apps, use one `androperator exec` with `close_app` actions.
A typical shape is:

```bash
androperator exec --device <device_serial> --operator-package <operator_package> --execution '{"commandId":"skill-author-reset-<timestamp>","taskId":"androperator-skill-author-by-recording","source":"androperator-skill-author-by-recording","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"close_target","type":"close_app","params":{"applicationId":"<target_application_id>"}}]}'
```

If more than one target app matters to the flow, close each of them before you
start recording.

Call out that `close_app` is the underlying Androperator action and that Node
runs it as an adb force-stop pre-flight. Do not tell the user to swipe apps
away manually unless the workflow explicitly depends on that human action.

Call out why this matters:

- many users will explore the UI first, then decide to record
- leaving the app mid-flow can produce a misleadingly short recording
- a truthful baseline should start from the app state the skill is expected to
  reproduce

### 3. Start Recording

Use the selected device and operator package explicitly. Show the concrete
command before or while running it.

```bash
androperator recording start --session-id <session_id> --device <device_serial> --operator-package <operator_package>
```

Then tell the human clearly that recording is active and it is their turn to
perform the target phone flow.

### 4. Human Performs The Flow

Pause for the human to do the workflow on the device. Do not guess what
happened. When they say the flow is complete, continue.

### 5. Stop, Pull, And Export

Run the full recording lifecycle in order and surface the resulting paths:

```bash
androperator recording stop --session-id <session_id> --device <device_serial> --operator-package <operator_package>
mkdir -p ~/.androperator/recordings/<session_id>
androperator recording pull --session-id <session_id> --device <device_serial> --operator-package <operator_package> --out ~/.androperator/recordings/<session_id>
androperator recording export --input ~/.androperator/recordings/<session_id> --out ~/.androperator/recordings/<session_id>/<session_id>.export.json --snapshots omit
```

Retain the pulled NDJSON as the raw capture.

Treat the export JSON as the canonical structured authoring artifact. Optional
`record parse` output is for human inspection only and does not replace the
export. Reuse the explicit export path above as `<export_json>` in the
subsequent scaffold and authoring steps.

Do not rely on the CLI default `./recordings/` output location for this
workflow. Use the explicit user-scoped path above so authoring artifacts do not
accumulate in whichever repo the skill happened to run from.

### 6. Confidence Check And Optional Extra Recording

Before you commit to authoring from a single pass, inspect whether the first
recording looked clean enough to trust.

Recommend another recording when any of these are true:

- the user explored or corrected themselves mid-flow
- the recording appears unusually sparse for the claimed route
- the path differs based on starting UI state
- replay would require guesswork rather than evidence-backed selectors
- the final state changed what the next run would look like

When confidence is low, ask plainly whether the user wants to run another
recording pass before you author the skill. Explain why:

- a second pass can confirm the intended route
- a second or third pass can expose state-driven branching
- extra passes help distinguish stable selectors from one-off noise

Do not silently merge multiple recordings into fake certainty. If there are
multiple passes, say which recording became the retained baseline and why.

### 7. Derive The App Identity And `skill_id`

Inspect the export and derive a truthful first-pass `skill_id`.

Base it on:

- the app package observed in the recording export
- the user's plain-language goal
- the shape suffix that matches the current pass

For the default first pass, derive a `-replay` id unless the user explicitly
requested orchestrated.

Show the proposed `skill_id` before scaffolding. Only ask for an override if
the derived id is clearly misleading or the user wants a different naming
choice. Do not make users invent reverse-domain naming from scratch before the
recording exists.

### 8. Retain The Sanitized Baseline

Copy or write the sanitized retained export baseline to:

```text
skills/<skill_id>/references/compare-baseline.export.json
```

If the skill folder does not exist yet, scaffold first or create the
`skills/<skill_id>/references/` directory before you write this file.

Rules:

- keep this file as authoring and compare evidence
- keep it out of `skill.json.artifacts`
- do not present it as a runtime input
- do not treat `recording-context.json` as the long-term maintained compare
  path once this retained baseline exists

### 9. Explain The Chosen Shape

Make the current pass explicit.

If the user explicitly requested orchestrated, say so and explain why that
shape fits.

Otherwise, make a truthful recommendation from the export evidence before you
author code:

- if the flow still looks replay-safe, say that replay is the default first
  pass for this recording and that you will test it before escalating
- if the flow already looks orchestrated-shaped, say why replay would be
  untruthful or insufficient and move directly to orchestrated in this pass

Do not hide that decision. The user should be able to tell whether the front
door stayed replay-first or took the orchestrated branch and why.

Also make the personalization boundary explicit:

- if the authored path hardcodes personal labels, rooms, or one user's device
  graph, describe it as a personalized local skill
- do not describe that result as a shared generic skill unless you actually
  generalized those assumptions

When discussing tradeoffs, use plain language like:

- replay is a good fit for simple repeatable flows
- orchestrated is a better fit for complex workflows driven by an AI agent

Do not force the user to learn the taxonomy first, but do explain the tradeoff
clearly when it matters.

### 10. Scaffold The Runtime Skill

Create the runtime skill in the skills repo with recording context copied from
the export artifact:

```bash
androperator skills new <skill_id> --recording-context <export_json>
```

This copies the export to `skills/<skill_id>/recording-context.json`.

Remember:

- `recording-context.json` is scaffold-time evidence for the author
- it is not the executable program
- `skills validate` still validates the registry-linked skill files, not the
  recording context
- generated runtime skills must stay portable across machines and worktrees
- do not import runtime contracts from absolute local filesystem paths such as
  `/Users/<local_user>/src/...`
- if you need stable `SkillResult` frame constants in a generated script,
  prefer portable local constants or a repo-relative/runtime-safe import path

### 11. Author The Chosen Shape

Author exactly one requested or recommended shape in this pass.

For replay:

- keep the logic truthful to a deterministic path
- use the recording evidence to derive selectors, waits, and verification
- use live snapshots or fresh UI reads when the recording export is not enough,
  but say so plainly in the authored notes instead of implying the export
  alone determined the route
- remove scaffolded or recording-derived fixed sleeps before the first
  self-test whenever the UI exposes an observable readiness signal
- use daemon-backed condition polling: `wait_for_node`, `read_text`,
  `snapshot_ui`, or a short bounded loop over small executions
- stop polling as soon as the expected controller, value, or terminal state is
  observed instead of sleeping a guessed duration
- keep a fixed `sleep` only when no selector, text, value, snapshot, or visual
  condition can prove readiness; document that reason in `SKILL.md`
- make nested `androperator exec` calls use the wrapper-injected
  `ANDROPERATOR_BIN` and pass an explicit execution timeout for multi-step
  payloads that can exceed the default
- keep the retained compare baseline separate from runtime artifacts
- treat replay as the default first authored shape unless orchestrated was
  explicitly requested
- if the UI is known to reflect state late or unreliably, re-enter or re-read
  the relevant controller before claiming terminal verification
- if replay still cannot truthfully prove the persisted outcome after that
  re-read strategy, stop calling it replay-safe and recommend orchestrated as
  the next pass

For orchestrated:

- reuse the durable orchestrated runtime contract from
  `docs/skills/overview.md#orchestrated-runtime-contract`
- keep `skill.json.agent` as trusted runtime metadata
- write the app-specific runtime program in `SKILL.md`
- make `SKILL.md` own the route, checkpoints, verification policy, and emitted
  `SkillResult` shape
- keep `scripts/run.js` as a thin launcher that forwards stdout and stderr
- keep `skill.json.contract.inputs`, `SKILL.md` examples, forwarded wrapper
  args, and emitted `SkillResult.inputs` aligned around stable named inputs
- anticipate user-facing versus UI-facing value mismatches such as
  `medium` versus `med`; normalize them truthfully in the created skill instead
  of assuming the public contract text and the app label are identical
- keep per-run local debug artifacts when the harness runs:
  - `prompt.txt`
  - `agent-stdout.log`
  - `agent-stderr.log`
  - `run-metadata.json` with device id, operator package, forwarded args, and
    output paths
- save the outer `androperator skills run` wrapper and stderr capture
  alongside that harness bundle under `~/.androperator/recordings/<session_id>/`
- do not bury app-specific navigation or verification policy in the harness
- on the first repair pass, harden the runtime prompt against the failure class
  you just observed, especially around:
  - exact command templates
  - exact final frame shape
  - explicit bans on recursive skill calls or unrelated repo introspection
  - single-line shell command requirements when multiline commands already
    caused wrapper or transport drift

In both cases, make the terminal verification policy explicit and ensure the
artifact reflects what the runtime can actually prove.

Before the first self-test, tell the user that scaffold plus first draft is not
the finish line. This pass includes:

1. author the skill
2. validate the created files
3. run the created skill
4. if it fails, inspect the failure artifacts and patch that same skill
5. rerun validation and the skill until it works or a real blocker remains

Do not treat the first failed self-test as a satisfactory endpoint.

### 12. Show The Authored Files

Surface the key authored files so the developer can inspect the result:

- `skills/<skill_id>/SKILL.md`
- `skills/<skill_id>/skill.json`
- `skills/<skill_id>/scripts/run.js`
- `skills/<skill_id>/recording-context.json`
- `skills/<skill_id>/references/compare-baseline.export.json`

If the chosen shape is replay, make clear which file contains the replay logic.

If the chosen shape is orchestrated, make clear that:

- `SKILL.md` is the runtime agent program
- `skill.json.agent` is the trusted runtime metadata
- `scripts/run.js` is only the thin harness

### 13. Run One Self-Test

Run exactly one first self-test invocation of the authored skill and save the
full JSON wrapper plus stderr:

```bash
androperator skills run <skill_id> --device <device_serial> --operator-package <operator_package> > ~/.androperator/recordings/<session_id>/<skill_id>.skills-run.json 2> ~/.androperator/recordings/<session_id>/<skill_id>.skills-run.stderr.log
```

If the skill takes inputs, pass the minimum truthful input set required for one
real run.

The self-test phase is an active repair loop, not a one-shot ceremony.

If the first self-test fails:

- inspect the saved wrapper JSON, stderr, and any orchestrated debug bundle
  from that exact run before changing strategy
- classify the failure before patching anything:
  1. environment or runtime mismatch
  2. wrapper, contract, or frame issue
  3. agent-prompt drift
  4. app navigation or selector issue
  5. terminal verification or normalization issue
- patch the just-authored `SKILL.md`, `skill.json`, or `scripts/run.js`
  directly when the failure points to a skill bug
- rerun `skills validate <skill_id>` after each substantive patch
- before each rerun, restore the target app or apps to the same truthful
  starting precondition the skill expects so you are not validating against a
  mutated mid-flow screen from the failed attempt
- rerun the same skill with the same truthful input set until the pass either
  succeeds or you hit a concrete blocker such as missing evidence, ambiguous UI
  state, or a user decision that cannot be inferred safely

Stay focused on the created skill during this loop.

Run only one active self-test per device at a time during authoring and repair.
Do not overlap live retries on the same phone or emulator.

Do not:

- wander into unrelated skills in the repo
- treat auxiliary repo skills as the next step unless the user explicitly asked
  for them
- leave the authored skill broken while exploring other workflows
- stop after surfacing a failed `SkillResult` if the failure is fixable from
  the current artifacts and code

If the authored shape is orchestrated, require the self-test run to preserve
the per-run debug bundle from the harness. At minimum retain:

- the saved `skills run` wrapper
- the saved `skills run` stderr log
- `prompt.txt`
- `agent-stdout.log`
- `agent-stderr.log`
- `run-metadata.json`

If the self-test was orchestrated and failed, use that exact debug bundle to
drive the next patch. Read it in this order before editing:

1. saved `skills run` stderr log
2. saved wrapper JSON `skillResult`
3. `agent-stderr.log`
4. `agent-stdout.log`
5. `prompt.txt`
6. `run-metadata.json`

During that orchestrated repair pass, distinguish clearly between:

- device work succeeded but the wrapper, frame, or contract handling failed
- the automation itself failed on device

Patch the failing layer first instead of mixing those cases together.

If the run fails or ends in an unexpected UI state, capture one immediate
device snapshot for post-mortem inspection and surface its path:

```bash
androperator snapshot --device <device_serial> --operator-package <operator_package>
```

### 14. Surface The `SkillResult`

Inspect the saved `skills run` wrapper. For **framed** default JSON success, the
top level has **no** duplicate `status`, `skillId`, `exitCode`, or `output`; the
parsed object is under `skillResult` only.

Call out at least, in this order when present:

- **`skillResult.result`** (canonical domain answer; authoring is incomplete until
  a self-test proves this path is populated for the skill's real return value)
- `skillResult.status`
- `skillResult.source`
- `skillResult.checkpoints`
- `skillResult.terminalVerification`
- `skillResult.diagnostics`

Framed success wrappers should not duplicate top-level process metadata that is
already represented inside `skillResult`.

When compare is relevant, note that the saved wrapper file is the durable v1
`--result` input for:

```bash
androperator recording compare --baseline skills/<skill_id>/references/compare-baseline.export.json --result ~/.androperator/recordings/<session_id>/<skill_id>.skills-run.json
```

Do not hand-edit a bare `SkillResult` and do not claim compare accepts only a
stripped result object.

If the self-test was orchestrated, also surface the debug-artifact paths and
tell the developer to read them in this order when debugging a bad run:

1. `skills run` stderr log
2. `SkillResult.checkpoints` and `terminalVerification`
3. `agent-stderr.log`
4. `agent-stdout.log`
5. captured snapshot path, if one was taken
6. compare output, when a retained baseline exists

Also surface:

1. whether the result is personalized local scope or genuinely shared-ready
2. whether the pass stayed `from scratch` or used assisted nearby patterns

If the self-test was replay and it failed, looked brittle, or could not
truthfully prove the requested outcome, say that explicitly and strongly
recommend an orchestrated refinement pass. When you do that, show the tradeoff
plainly:

- replay is better for simple repeatable flows
- orchestrated is better for complex workflows driven by an AI agent against
  live UI state

If the self-test failed first but the current pass repaired the created skill
successfully, surface that repair loop briefly:

- what broke on the first run
- which created file or files you patched
- which rerun finally passed

Do not silently switch shapes mid-pass. Finish the pass truthfully and make the
next-step recommendation explicit.

## Truthfulness Checks

Stop and correct the workflow if you find yourself implying any of these:

- the recording export already is the skill
- replay is only a temporary or lower-grade artifact
- orchestrated is mandatory for every recording-driven workflow
- the retained compare baseline is a runtime artifact
- the harness owns the orchestrated skill logic
- authoring is done before a self-test run emits an inspectable `SkillResult`
- the first failed self-test is an acceptable stopping point when the created
  skill could still be repaired from the current code and artifacts

## Output Standard

A complete pass should leave the developer with:

- one authored runtime skill shape
- one retained compare baseline
- one saved `skills run` wrapper from the self-test
- one saved `skills run` stderr log from the self-test
- for orchestrated runs, one local debug bundle with prompt, agent stdout,
  agent stderr, and metadata
- a clear statement of why replay or orchestrated was chosen
- visible file paths and commands that make the workflow inspectable

If any of those are missing, the pass is not done.
