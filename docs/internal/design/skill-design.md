# Androperator Skill Design

Product naming:

- Product: `Androperator`
- Legacy Android module/package naming in current codebase: `ActionTask` (temporary during migration)
- Repository rename planned: TBD

## Purpose

Define a deterministic, open-source **skill package** format for Android automation guidance.

Skills are the primary artifact for agents and humans.

For the recording-to-skill workflow and the normalization rules that turn a
raw capture into a reusable skill, see [Skill Authoring from
Recordings](../../skills/authoring.md#recording-driven-workflow-stance).

Each skill may include:
- `SKILL.md` (canonical agent-facing interface)
- `scripts/` (deterministic wrappers)
- `artifacts/*.recipe.json` (optional deterministic execution templates)

Implementation language preference for `scripts/`:

1. Node.js/TypeScript is the default for new non-trivial skills.
2. Bash should be limited to small wrappers and command orchestration.
   Any non-trivial Bash skill is a temporary exception and must include a top-of-file migration note indicating it is queued for Node.js/TypeScript migration.
3. Python is supported as a future secondary option once a Python SDK contract is defined.

Practical note:

- Even accurate automations are inherently fuzzy because user/account UI state varies (feature flags, rollout state, number of devices, personalization).
- Skills should encode preferred strategy plus fallbacks, not brittle assumptions.

## Orchestrated Skill Authoring Lessons

The first stabilized orchestrated skills surfaced several durable design
lessons for future authors.

### Keep Per-Exec And Per-Skill Results Separate

`ResultEnvelope` and `SkillResult` solve different contract problems.

- `ResultEnvelope` is the per-`androperator exec` terminal envelope. It reports
  one execution's transport status, step results, and top-level error fields.
- `SkillResult` is the per-skill terminal frame. It reports the skill-level
  goal, checkpoints, terminal verification, diagnostics, and any embedded exec
  envelopes needed as evidence.

Multi-step skills need both layers.

If the runtime only exposed the last `ResultEnvelope`, the caller could see
that one execution succeeded but still could not tell:

- which checkpoint failed first
- whether the skill proved its declared final state
- whether the overall run was `success`, `failed`, or `indeterminate`
- which sequence of exec runs produced the final outcome

Keep the boundary explicit:

- `ResultEnvelope` remains the deterministic per-command contract
- `SkillResult` remains the deterministic per-skill contract built on top of
  those command results

### Keep Skill Authority In `SKILL.md`

The durable contract is:

- `skill.json` declares trusted runtime metadata
- `SKILL.md` is the app-specific runtime program
- `scripts/run.js` is a thin launcher

When app navigation, coordinates, checkpoint rules, or verification semantics
move into the harness, authors create a split-brain design where the runtime
agent reads one contract and the wrapper enforces another. That drift slows
debugging and makes later maintenance unsafe.

### Require Serialized Device Actions

Orchestrated skills should require one live Androperator device command at a
time.

If the runtime agent pipelines multiple live commands in the same turn, the UI
can be driven out of order and the resulting failure is hard to diagnose.
Serialized execution keeps the transcript readable and preserves a clean
evidence trail for each checkpoint.

### Verification Must Prove The Persisted State

Do not treat "the dialog accepted the input" as success.

For state-changing flows, the runtime program should:

- read the current value before editing
- use the user's requested target; verify an already-satisfied value without
  changing it merely to exercise the save path
- complete the save path when a change is needed, including confirmation prompts
- reopen the persisted screen state
- read the terminal UI again

This proved especially important for flows where the app returns to an editor
screen after `Confirm` and requires another save-confirm cycle before the
change actually persists.

For explicitly authorized reliability runs, carry forward the last known
persisted value and choose a different target within the permitted test range
when testing mutations. Repeating the same value proves an already-satisfied
state, not that a save operation persisted a change.

For prompt scope, conditional references, and completion guidance, see
[Writing Agent Instructions](../../skills/authoring.md#writing-agent-instructions).

### Decorative UI Text Must Not Cause False Failures

Some UI rows include decorative trailing glyphs such as chevrons.

Verification rules should match the semantic text that proves the state change,
not require brittle full-string equality when the row also includes a glyph
that does not change the meaning. For example, a read of
`Discharge to 45% ` is semantically sufficient to prove `Discharge to 45%`.

### Preserve Debug Artifacts

The most useful harness-level debugging artifacts were:

- the exact prompt given to the runtime agent
- the runtime agent stdout transcript
- the runtime agent stderr stream
- a small metadata file with device id, operator package, and forwarded args

Those artifacts made it possible to distinguish:

- route failures
- save-flow prompt mismatches
- strictness bugs in the emitted verification rule
- transport or runtime-controller mistakes
- lazy-mode agent behavior that looked superficially clean

Keep those artifacts as local debugging output, not as default committed
repository content. Durable docs should preserve the method, the thresholds,
and the synthesized conclusions. Raw per-run transcripts are scratch evidence
unless a specific sanitized excerpt is needed to support a durable claim.

When building local reliability runners around `androperator skills run`,
parse the actual result from `skillResult`. The top-level JSON wrapper can
carry controller metadata, so checking only a top-level `.status` field can
misclassify a successful run as empty or failed.

On macOS, pay attention to child process groups when capturing orchestrated
runtime output. If the wrapper does not terminate and reap the spawned group
cleanly, `codex exec` can outlive the parent skill run and muddy later
observations, making stalls and retries look more mysterious than they are.

### Prefer Current-State Continuation Over Blind Restarts

Real apps often resume inside the middle of a flow:

- already on the target editor
- already inside a nested dialog
- already showing the post-confirm save surface

The runtime program should tell the agent to continue from the current valid
state when possible, not blindly force the same top-level entry path every
time. That reduces unnecessary UI churn and avoids failures caused by assuming
the app always restarts from the same surface.

Important scope boundary:

- Skill artifacts are accelerators, not a hard dependency.
- Androperator must remain useful when a skill artifact is missing, stale, or incorrect.
- Runtime execution APIs must support direct execution without prebuilt artifacts.

## Concept Model

Recipe artifact semantics (inside a skill) are split into three explicit layers:

1. `probe`
   - Single observation/read operation.
   - No side effects.
   - Typical shape: `snapshot` + `read_text` + parse.
2. `flow`
   - Multi-step procedure.
   - Navigation and reads, optionally side-effect free.
3. `action`
   - Side-effecting procedure (toggle/set/click-with-effect).
   - Must include verification after side effect.

Allowed `recipe_type` values (required):

- `probe`
- `flow`
- `action`

## Repository Ownership

Recommended split and source of truth:

1. Core repo:
   - Android runtime + Node CLI/API
   - skill/recipe schema and compiler
2. Skills repo (`local skill workspace`):
   - versioned skill folders
   - optional deterministic `.recipe.json` artifacts per skill

Absence of a skill artifact must not block execution. It only removes compile assistance.

Suggested layout:

```text
skills/
  skills-registry.json
  skills-registry.schema.json
  generated/
    manifest.json
    skills-index.min.json
    skills-index.jsonl
    by-app/
      <application_id>.json
    by-prefix/
      <hash_prefix>.json
  tools/
    generate_skill_indexes.sh
  <application_id>.<intent>/
    SKILL.md
    skill.json
    scripts/
      *.ts | *.js | *.sh | *.py
    artifacts/
      *.recipe.json
```

Language policy for new skills:

- If the skill includes substantial parsing, state handling, retries, or multimodal outputs, implement in TypeScript.
- If the skill is a tiny launcher/wrapper, Bash is acceptable.
- Avoid introducing both Node and Python SDK dependencies at once; stabilize Node SDK/contracts first, then add Python based on demand.

## Recipe Artifact Schema

Implementation note:
- Current `skills/*/artifacts/*.recipe.json` files in this repository are runtime `AgentCommand` templates used by scripts/wrappers.
- The richer metadata schema below is the design target and is not yet enforced by the current artifact generator/runtime path.

Each optional recipe artifact remains deterministic and versioned.
If Markdown recipe files are used, they may start with YAML frontmatter.

Required fields:

- `recipe_id` (string, globally unique)
- `recipe_version` (semver)
- `recipe_type` (`probe|flow|action`)
- `application_id` (Android package id)
- `summary` (short purpose)
- `frameworks` (array from allowed taxonomy)
- `session_policy` (`fresh|resume_ok`)
- `app_build.version_name` (string)
- `app_build.version_code` (integer)
- `tested_on.android_api` (integer)
- `capabilities` (array from allowed capability set)
- `inputs` (array)
- `outputs` (array)

Recommended fields:

- `compatibility.min_version_code`
- `compatibility.max_version_code`
- `tested_on.device_model`
- `tested_on.locale`
- `tested_on.last_verified_at` (ISO-8601)
- `known_quirks`
- `failure_modes`
- `maintainers`
- `tags`
- `risk_level` (`low|medium|high`)

## Session Policy

`session_policy` is required.

- `fresh` (default)
  - Compiler auto-inserts step 0/1:
    - `close_app`
    - `open_app`
  - unless frontmatter sets `fresh_start_injected: false` and the recipe explicitly provides equivalent steps.
- `resume_ok`
  - compiler does not inject close/open.

This makes the reliability rule enforceable and uniform.

## PII and User-Specific Variable Policy

Canonical recipes must not contain user-specific literals.

Examples of forbidden literals in recipe files:

- personal names
- home/location labels
- device nicknames (for example a real AC tile label)
- physical device identifiers (for example real `adb` serials / `DEVICE_ID` values)
- account emails/addresses/phone numbers

Required approach:

1. User-specific/runtime-specific values must be declared in `inputs`.
2. Steps/selectors reference input variables, not hardcoded literals.
3. PII-like inputs must default to empty or generic placeholders, not real values.
4. Repositories should enforce a local sensitive-literal denylist via git hooks (`pre-commit` and/or `pre-push`) that scans staged diffs and blocks commits containing configured forbidden tokens.
5. Sensitive-literal scanning must include personal device serials/IDs used for local testing.

Local guardrail requirement:

- Keep denylist values in a local-only file that is never committed (for example under `.git/info/` or ignored local config).
- Hook output should identify offending file/line and fail with a clear remediation message.
- This is a complement to CI linting, not a replacement.

Example:

```yaml
inputs:
  - name: ac_tile_name
    type: string
    required: true
    default: ""
```

Compiler behavior:

- unresolved required variables fail compile deterministically (`RECIPE_INPUT_MISSING`).

## Framework Taxonomy

Allowed `frameworks` values:

- `views`
- `compose`
- `react-native`
- `expo`
- `flutter`
- `webview`
- `hybrid`
- `unknown`

## Capability Taxonomy

Required frontmatter field: `capabilities`.

Allowed values:

- `observe`
- `navigate`
- `click`
- `long_click`
- `enter_text`
- `toggle`
- `purchase_risk`

Node runtime uses this list for policy gating (allow/deny before execution).

## Deterministic Step Schema

Markdown remains human-readable, but each step must include a structured YAML block that maps 1:1 to runtime actions.

Example:

~~~md
## Step 3: Scroll to Devices

```yaml
id: scroll_devices
type: scroll_and_click
selector:
  text_contains: Devices
  annotation: STRUCTURAL
container:
  class: androidx.recyclerview.widget.RecyclerView
wait:
  after_ms: 500
retries:
  count: 3
```
~~~

Required step block fields:

- `id` (unique within recipe)
- `type` (runtime action type)
- selector/matcher block required when action needs a target

Optional fields:

- `container`
- `wait`
- `retries`
- `confirm`
- `params`

## Selector DSL (v1)

Only these keys are allowed in selector blocks:

- `resource_id`
- `class`
- `text_equals`
- `text_contains`
- `content_desc_contains`
- `clickable`
- `enabled`
- `selected`
- `index_in_parent` (discouraged but allowed)
- `any_of`
- `all_of`
- `annotation`

`annotation` allowed values:

- `STRUCTURAL`
- `VARIABLE`
- `USER_SPECIFIC`
- `DERIVED`

Unknown selector keys are schema errors.

Variable interpolation rule:

- Selector text fields may use explicit variable placeholders only (for example `${inputs.ac_tile_name}`).
- Raw user-specific literal strings in selectors are schema/lint violations.

## Output Redaction

Each declared output field supports required redaction behavior:

- `redaction: none | hash | mask | drop`

Default policy:

- For text-derived outputs, default is `mask`.
- For non-text numeric state outputs, default is `none` unless overridden.

Example:

```yaml
outputs:
  - name: account_name
    type: string
    redaction: mask
  - name: battery_percent
    type: number
    redaction: none
```

## Runtime Mapping

Compiler may only emit supported runtime action types:

- `open_app`
- `close_app`
- `wait_for_node`
- `click`
- `scroll_and_click`
- `read_text`
- `snapshot`
- `sleep`

Compilation must be deterministic and pure:

- no LLM reasoning at compile time
- no heuristics from prose-only sections
- identical input recipe + vars => identical execution output

## Validation Rules

Minimum validation checks:

1. Frontmatter required fields valid.
2. `recipe_type` and `frameworks` values valid.
3. `session_policy` present.
4. Every step has a valid YAML block.
5. Step action types are supported.
6. Selector DSL uses only allowed keys.
7. For `recipe_type=action` or capabilities containing `toggle|enter_text|purchase_risk`, a verification requirement must exist after each side-effecting step.
8. User-specific literals are not present in frontmatter, selectors, or step blocks.
9. Required input variables used by selectors are declared in `inputs`.

Verification can be satisfied by:

- explicit `confirm` block in the step, or
- subsequent `read_text`/assertion step referencing changed state.

## Fuzzy Real-World Variance (Cardinality Drift)

Skill artifacts must tolerate entity-count variance.

Example:

- artifact may prefer interacting with "second AC tile" when two units exist
- on another account only one unit may exist

Guidance:

1. Prefer selector intent over absolute index assumptions.
2. Treat index-based targeting as optional fallback, not primary strategy.
3. If preferred target cardinality is unavailable, emit a structured ambiguity/partial result and continue with best-effort navigation where safe.
4. Capture variance notes in `known_quirks`; avoid overfitting until real user data justifies tighter constraints.

## CI Requirements

`local skill workspace` CI should run:

1. per-skill metadata validation (`skills/*/skill.json`)
2. run `skills/tools/generate_skill_indexes.sh`
3. `skills/skills-registry.json` schema validation
4. registry/index cross-check (every registered path exists and every skill folder is registered)
5. markdown parse + frontmatter schema validation
6. step schema validation
7. deterministic compile test
8. PII lint pass
9. capability policy lint (forbidden combos by profile)
10. literal-detector lint pass (fail on likely user-specific literals where variables are required)
11. compile-time input completeness checks for required variables

## Testing Strategy

Recipe/compiler and runtime behavior must be tested at multiple levels.

1. Unit tests (fast, deterministic)
   - frontmatter/schema parsing
   - selector DSL validation
   - variable interpolation
   - redaction behavior
   - compile determinism (`same input => same execution`)
2. Integration tests (mocked bridges)
   - compile + execution orchestration
   - alias normalization
   - error contracts (`RECIPE_INPUT_MISSING`, `VERIFY_FAILED`, etc.)
3. Android instrumentation tests (real device/emulator)
   - run generated executions end-to-end against live UI tree
   - verify result envelope format and correlation IDs
4. Real-device smoke tests (required in CI/nightly where available)
   - baseline known app flow (current practical baseline: Google Home)
   - detect major runtime regressions in selectors/waits/verification behavior
5. Future dedicated test APK
   - build a stable Android test app with known UI elements/states
   - use as canonical non-flaky contract suite for `click/read/wait/scroll/toggle`

## Example Frontmatter (v1)

```yaml
recipe_id: com.google.android.apps.chromecast.app.toggle-power
recipe_version: 1.2.0
recipe_type: action
application_id: com.google.android.apps.chromecast.app
summary: Toggle climate power and verify final state.
frameworks:
  - compose
  - views
session_policy: fresh
app_build:
  version_name: "3.31.100"
  version_code: 5311000
tested_on:
  android_api: 34
capabilities:
  - observe
  - navigate
  - click
  - toggle
inputs:
  - name: ac_tile_name
    type: string
    required: true
    default: ""
outputs:
  - name: power
    type: string
    redaction: none
```
