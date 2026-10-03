---
name: androperator-skill-author-by-agent-discovery
description: "Choose an evidence-backed next step when no installed Androperator runtime skill covers the goal or the app route needs bounded discovery before authoring."
---

# Androperator Skill Author By Agent Discovery

Guide a host-facing agent through Androperator's no-match route from "no
installed runtime skill clearly fits" to "one truthful next step."

This is the no-goal-match front door. It does not author a durable runtime
skill. Its job is to inspect the current host and app surface, produce one
structured discovery artifact, and choose exactly one next step.

## What This Skill Owns

Use this skill when a user wants app-specific help or skill creation and one
of these is true:

- runtime-skill discovery found no clear installed match
- the target app route is still too uncertain to record truthfully
- the agent needs a bounded discovery pass before deciding whether recording,
  one-shot fulfillment, escalation, or decline is the honest answer

This skill owns bounded discovery and routing only.

## What This Skill Does Not Own

- Do not author or patch a durable runtime skill directly inside this skill.
- Do not replace `androperator-skill-author-by-recording`.
- Do not turn discovery into an unbounded research loop.
- Do not use general web research or external product docs as a substitute for
  installed-skill discovery, bounded live probes, prior local evidence, and
  first-party Androperator docs.
- Do not invent new Androperator runtime probes or new CLI nouns in this
  workflow.

## References by decision

Use the relevant canonical contract when its detail is needed:

- Host readiness and routing: `https://docs.androperator.com/host-agents/`
- Authoring handoff and proving: `https://docs.androperator.com/skills/authoring/`
- Runtime-skill categories and coverage: `https://docs.androperator.com/skills/overview/`
- Direct-command usage: `https://docs.androperator.com/quickstart/`
- Reusable skill design: `https://github.com/androperator/androperator/blob/main/docs/internal/design/skill-design.md`

Keep the discovery artifact below and the canonical proving workflow; do not
invent parallel contracts.

## Inputs To Gather Up Front

Collect or confirm these inputs before discovery starts:

- the user's plain-language goal
- target app name and package id if already known
- whether the request is read-only, reversibly mutating, or potentially
  irreversible
- target device id when more than one device is connected
- operator package
- whether the current host can actually run local shell commands with
  `androperator` and device access
- any prior recordings, findings, or runtime-skill ids already available

If the current host cannot run local shell commands with `androperator`, do not
fake discovery. Route the work into a local shell context first.

## Non-Negotiable Rules

- Check installed runtime skills first.
- Match the requested outcome, inputs, supported route, outputs and verification,
  not package-name overlap. Record missing goal coverage as `partial_match`; a
  Settings landing-screen skill does not satisfy OS version/build extraction.
- If there is a clear installed runtime-skill match, route
  `use_existing_skill` and stop.
- Produce exactly one top-level discovery artifact.
- Choose exactly one `recommended_next_step`.
- Keep discovery bounded to:
  - max 5 snapshots
  - max 3 screenshots
  - max 90 seconds wall time
- Use `snapshot` as the primary discovery surface. Use screenshots only when
  UI hierarchy alone is not enough.
- Use only Androperator commands for live device interaction.
- Do not author the durable runtime skill inside discovery.
- When `recommended_next_step = proceed_to_recording`, `handoff_target` must be
  `androperator-skill-author-by-recording`.
- If mutation risk is too high or user intent is underspecified, prefer
  `escalate_to_human` or `decline` over false confidence.
- Treat `skills new` as the low-level manual scaffold, not as the default
  zero-results route.
- Default to autonomous execution when the current host can drive the device.
  Do not ask the user to perform routine device actions that Androperator can
  perform itself.
- Ask for user intervention only when the agent hits a real blocker that
  Androperator cannot truthfully clear alone, such as a hard sign-in screen,
  MFA challenge, CAPTCHA, biometric gate, payment approval, or an approval
  step whose meaning cannot be inferred safely.
- When routing to `androperator-skill-author-by-recording`, pass forward the observed app
  route, mutation notes, evidence inventory, classification, and any known
  setup caveats that matter to the recording pass. Steer the recording workflow
  toward the same **`SkillResult` shape** the runtime expects: nested
  **`skillResult.result`** first (evidence-shaped), then **`skillResult.status`**,
  then proof fields. When suggesting nearby exemplar skills from the registry,
  prefer skills that already emit **`skillResult.result`** in framed runs.

## Discovery Budget

Default Pack A budget:

- snapshots: 5 maximum
- screenshots: 3 maximum
- wall time: 90 seconds maximum

Track actual usage in the discovery artifact under `discovery_budget_used`.
Stop early when:

- a clear existing runtime skill is found
- the route becomes clear enough for truthful recording handoff
- the request is better served as one-shot direct automation
- mutation risk or missing user intent blocks safe progress
- the budget is exhausted

## Required Discovery Artifact

Render the final discovery artifact as one fenced JSON object. It must contain
the following top-level keys.

| Key | Expected shape |
| --- | --- |
| `recommended_next_step` | One of `use_existing_skill`, `proceed_to_orchestrated_authoring`, `proceed_to_recording`, `iterate_discovery`, `one_shot_direct_automation`, `escalate_to_human`, `decline` |
| `existing_skill_verdict` | Object with `status` set to `match`, `partial_match`, or `none`, plus the queried registry paths or commands |
| `target_app_package` | Object with app label, package id, and any sub-route observed |
| `route_confidence` | Object with `level` set to `high`, `medium`, or `low`, plus supporting evidence |
| `mutation_risk` | Object with `level` set to `read_only`, `reversible_mutation`, or `irreversible_mutation`, plus notes |
| `evidence_collected` | Object inventorying captured artifacts and failed probes |
| `discovery_budget_used` | Object recording `snapshots`, `screenshots`, and `elapsed_wall_time_s` |
| `skill_classification` | Include only when `recommended_next_step = proceed_to_recording`; value must be `shared-general` or `personalized-local` |
| `handoff_target` | One of `androperator-agent-control-loop`, `androperator-skill-author-by-recording`, `raw-androperator`, `human`, `none` |
| `handoff_reasoning` | Short justification for the chosen route |

Required truth rules:

- Missing any always-required key blocks handoff.
- `skill_classification` is required only when the route is
  `proceed_to_recording`.
- `handoff_target` must match the chosen route.
- The artifact must stay inspectable. Do not hide route decisions in prose
  alone.

## Route Table

Use this first-match-wins table exactly:

| Situation | Required route |
| --- | --- |
| Installed runtime skill is a clear match | `use_existing_skill` |
| No full goal match, user explicitly requested orchestrated authoring, and bounded evidence supports its scope | `proceed_to_orchestrated_authoring` |
| No full goal match, route is understood, and reusable authoring is justified | `proceed_to_recording` |
| No full goal match, route is still uncertain, and discovery budget remains | `iterate_discovery` |
| One-shot fulfillment is better than a reusable skill | `one_shot_direct_automation` |
| Mutation risk is too high or user intent is underspecified | `escalate_to_human` |
| Request cannot be served truthfully | `decline` |

## Workflow

### 1. Confirm Scope And Discovery Context

Tell the user what you are about to do:

- inspect installed runtime skills first
- keep discovery bounded
- collect only the evidence needed to choose one truthful next step
- produce one structured discovery artifact
- hand off to recording only if discovery actually supports it

### 2. Check Installed Runtime Skills First

Start with the runtime-skill registry before touching the device.

Use the shortest truthful path:

```bash
androperator skills for-app <package_id>
androperator skills search --keyword "<term>"
androperator skills get <skill_id>
androperator bundled-skills list
```

Rules:

- Use `skills for-app` when the package id is known.
- Use `skills search --keyword` when you only know app or intent words.
- Use `skills get` when you need to inspect a candidate runtime skill before
  deciding whether it is a true match or only a partial match.
- Use `bundled-skills list` only after runtime-skill discovery fails
  to find a clear match and you need to confirm the installed authoring front
  doors on the host.

### 3. Run A Bounded Discovery Loop

If no clear runtime skill exists, gather only the evidence needed to route the
request truthfully.

Prefer this live-probe order:

```bash
androperator open <package_id> --device <device_serial> --operator-package <operator_package>
androperator snapshot --device <device_serial> --operator-package <operator_package>
androperator read --text "<visible label>" --device <device_serial> --operator-package <operator_package>
androperator read-value --label "<visible label>" --device <device_serial> --operator-package <operator_package>
androperator scroll-until --text "<target>" --device <device_serial> --operator-package <operator_package>
androperator screenshot --device <device_serial> --operator-package <operator_package> --path <file>
```

Use snapshots as the primary probe. Add screenshots only when a visual affordance,
image-backed control, or ambiguous hierarchy truly needs image proof.

During discovery, keep notes on:

- the exact route segments observed
- whether the route depends on current UI state
- which observable readiness signals can replace fixed sleeps during authoring
  such as specific text, resource IDs, controller values, or stable snapshots
- whether the route mutates account state
- which probes failed and why
- whether the outcome is likely `shared-general` or `personalized-local`

### 4. Produce The Discovery Artifact

When you have enough evidence, emit one fenced JSON artifact with the exact
top-level keys above.

Do not hide the route choice in prose. The artifact is the contract.

### 5. Route To Exactly One Next Step

Apply the route directly:

- `use_existing_skill`
  - name the skill id and stop
- `proceed_to_orchestrated_authoring`
  - set `handoff_target` to `androperator-agent-control-loop` and hand off the
    explicit user request, goal-coverage gaps, evidence, budgets and limitations
  - use its [delegation and authoring reference](../androperator-agent-control-loop/references/delegation.md)
    and canonical authoring workflow after this discovery pass ends
  - do not write the durable skill inside discovery or claim unproved navigation
- `proceed_to_recording`
  - hand off to `androperator-skill-author-by-recording`
  - pass forward the user goal, package id, observed sub-route, mutation notes,
    evidence inventory, `skill_classification`, and any known setup caveats
- `iterate_discovery`
  - stop with a bounded next-probe recommendation in `handoff_reasoning`
  - do not keep looping indefinitely inside the same pass
- `one_shot_direct_automation`
  - route to raw `androperator` execution using
    [the control loop](../androperator-agent-control-loop/SKILL.md) for adaptive work
  - do not author a durable skill
- `escalate_to_human`
  - explain what must be clarified or approved first
- `decline`
  - state the truthful reason plainly

### 6. Stop At The Discovery Boundary

Once the artifact and route are emitted, stop.

Do not:

- scaffold `skills/<skill_id>/`
- write a durable runtime skill
- start recording inside this skill
- pretend a partial route is good enough for proving

## Anchor Scenario Example

User request:

> "Make an Androperator skill that opens Netflix, searches for House of Cards,
> and adds it to My List."

If runtime-skill discovery finds no clear Netflix match and the first bounded
probe still leaves the route uncertain, a truthful artifact can look like:

```json
{
  "recommended_next_step": "iterate_discovery",
  "existing_skill_verdict": {
    "status": "none",
    "queried_registry_paths": [
      "androperator skills search --keyword \"Netflix\"",
      "androperator bundled-skills list"
    ]
  },
  "target_app_package": {
    "label": "Netflix",
    "package_id": "com.netflix.mediaclient",
    "sub_route_observed": "Browse surface only; title-details route not yet proved"
  },
  "route_confidence": {
    "level": "low",
    "evidence": [
      "Home surface reached",
      "Search entrypoint not yet proved",
      "My List affordance not yet observed"
    ]
  },
  "mutation_risk": {
    "level": "reversible_mutation",
    "notes": [
      "Adding to My List changes account state but is reversible"
    ]
  },
  "evidence_collected": {
    "snapshots": [
      "netflix-home-snapshot-01.json",
      "netflix-menu-snapshot-02.json"
    ],
    "screenshots": [
      "netflix-home-01.png"
    ],
    "failed_probes": [
      "Title search route not yet proved within current budget"
    ]
  },
  "discovery_budget_used": {
    "snapshots": 2,
    "screenshots": 1,
    "elapsed_wall_time_s": 34
  },
  "handoff_target": "none",
  "handoff_reasoning": "One more bounded discovery pass is needed before recording can be truthful."
}
```

If a later bounded pass makes the route clear enough, change exactly one route:

- `recommended_next_step` becomes `proceed_to_recording`
- add `skill_classification`
- set `handoff_target` to `androperator-skill-author-by-recording`

## Done When

This skill is done when:

- installed runtime skills were checked first
- discovery stayed inside budget
- exactly one route was chosen
- the final artifact includes every required key
- no durable runtime skill was authored inside discovery
