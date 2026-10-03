---
name: agent-first-run-test
description: Explore an unfamiliar Android app with branch-local Androperator and record evidence from a first-run test.
---

# Agent First Run Test

Use this skill when you need to drive an Android app that has no prewritten skill yet, prove that Androperator can work in a blind install or first-run scenario, and leave behind markdown artifacts that explain what happened.

## Goal

Show how an agent can use Androperator to automate an unfamiliar Android app with no prior script or skill.

The agent should:
- inspect the live UI tree
- choose a selector from the current snapshot
- execute one action
- re-observe
- repeat until the task is complete or blocked

Treat this as the product's foundational "zero-shot automation" path. Use that phrase in user-facing writing.

## Source Of Truth

Before trusting any contract detail, verify the current repo source and runtime output:
- `apps/node/src/contracts/execution.ts`
- `apps/node/src/contracts/selectors.ts`
- `apps/node/src/contracts/result.ts`
- current CLI help from the branch-local build

Do not rely on stale task notes or the global `androperator` binary.

## Working Rules

- Default to a single action, then re-observe.
- Use multi-action payloads only after the flow is known to be deterministic.
- Prefer the live UI hierarchy over assumptions about the app.
- Record failed attempts, wrong guesses, and UI surprises instead of smoothing them away.
- If docs and runtime disagree, trust the runtime and note the discrepancy.

## Required Markdown Outputs

Write durable markdown files under `/runs/agent-first-run-test/{date-time}-{model-name}/` as you work:

- `execution-log.md`
  - chronological notebook of what you tried
  - include the hypothesis, exact action payload or matcher choice, observed result, and next step for each entry
- `findings.md`
  - distilled lessons for future agents
  - include API strengths, API gaps, documentation gaps, naming mismatches, and recovery guidance
- `skill-draft.md`
  - write this only if the exploration reveals a reusable flow that should be turned into a new skill

Use a single run folder per session, with a timestamped name and the model name in the directory name.

If the exploration reveals a reusable workflow, capture it in `skill-draft.md`.
Create a runtime package only when requested, in the skills repo or a user-local
skill location appropriate to its privacy scope. `.agents/skills/` here is for
repository maintenance workflows.

## Exploration Loop

1. Open the target app or entrypoint.
2. Snapshot the current UI.
3. Identify the strongest stable matcher available from the live tree.
4. Execute one action.
5. Re-snapshot and confirm the state change.
6. Repeat until the task is complete or blocked.
7. Summarize the session in the markdown outputs.

## What To Capture

- Which snapshot path was used and why.
- Which matcher fields were actually useful.
- Where `resourceId`, `contentDescEquals`, visible text, or `role` were misleading.
- Any mismatch between the agent's expectation and the actual action shape.
- Any blocking state in the app UI.
- Any point where a reusable skill became obvious.

## Product Framing

Use two clear modes in copy and notes:

- Explore mode: unknown app, live inspection, one-step loops, zero-shot automation.
- Skill mode: known flow, reusable skill, faster and more reliable execution.

When packaging is requested, distinguish reusable app behavior from account,
regional, or device-specific details. Parameterize private values; do not infer
permission to publish from permission to explore.

## Completion

Stop when the live task is done and the markdown artifacts are detailed enough for another agent to reconstruct the session and its conclusions.
