# Agent Instructions and Task Prompts

Maintain instructions for capable agents using different models. Keep the
project facts that change a decision; let the agent choose routine methods.
This guidance applies to repository instructions and maintenance skills.
Runtime skill authors should also use
[the public authoring guide](../../skills/authoring.md#writing-agent-instructions).

## Choose the Right Home

| Information | Home |
| --- | --- |
| Invariants that apply throughout the repo | `AGENTS.md` |
| A specific maintenance workflow | `.agents/skills/<name>/SKILL.md` |
| Details needed only for one mode | A linked skill reference |
| Repeated deterministic operations | A tested helper script |
| A particular task's outcome, inputs, and completion boundary | The task prompt or notebook plan |
| Agent-followed instructions and examples | `docs/skills/` |

`CLAUDE.md` links to `AGENTS.md`; keep one repository instruction source.

See [the planning migration record](planning-migration.md) for preserved research
and notebook destinations.

## Skill Discovery and Detail

Describe the actual capability and trigger in a short description. Distinguish
nearby workflows: saving a notebook plan is different from implementing a feature;
verifying a release is different from publishing it. Avoid broad keyword lists.

Keep purpose, routing, essential constraints, and completion in `SKILL.md`.
Move substantial conditional detail into references with a reason to read each.
Do not move an oversized mandatory reading list behind a router and still load
it all. A simple skill can remain self-contained.

Preserve machine contracts and deterministic helpers. Exact release sequencing,
device targeting, output frames, and destructive-operation boundaries warrant
precision. Generic encouragement and fixed drafting itineraries rarely do.

Keep UI descriptions and default prompts aligned with the skill. Preserve
existing invocation policies and dependencies unless changing them is part of
the request. Do not require tools or personal skills unavailable to contributors.

## Planning and Documentation Cleanup

Use `~/.codex/skills/notebook-plan/SKILL.md` (`notebook-plan`)
for plans, working context, handoffs, and unfinished work. Read the skill and
follow the notebook's live project mappings, shared-checkout policy, and local
commit rules. Do not maintain a parallel planning area in this repository.

Documentation cleanup is required before closing a task or retiring obsolete
material. Move durable engineering knowledge, design decisions, sanitized
evidence, and code rationale into the appropriate repository docs, skills, or
code. Verify behavioral claims against implementation and use docs-author and
docs-build for affected docs. Preserve unfinished actions and dependencies in
the notebook before deleting obsolete guidance. Completed local work does not
establish a merge, release, or acceptance gate.

## Task Prompts and Authorization

State the outcome, scope, inputs, constraints, acceptance evidence, and stopping
point. Include only non-obvious context and applicable source references.
Preserve genuine dependencies and user-specified review gates.

Define completion through the required implementation, verification, in-scope
repairs, docs, and commits. Do not add an approval pause after a first draft.
Existing authorization covers routine local steps inside the requested task;
it does not cover unrelated changes, later PRs, publishing, or device mutations
outside the requested goal.

Ask when a missing decision changes scope, contracts, or risk. Do not turn
routine implementation choices into blockers. If execution is blocked, report
the specific dependency and complete unaffected work.

## Validation and Maintenance

Use checks that can reveal a meaningful failure for the changed surface. A
frontmatter check proves structure, not useful skill behavior. For material
workflow changes, exercise realistic requests and inspect the result, including
scope boundaries and completion. Do not publish a release or operate a live
device merely to test wording.

When independently evaluating a skill, provide the evaluator the request and
necessary raw artifacts without the expected answer. Use delegation only when
available and authorized. Preserve deterministic scripts unless evidence
justifies changing them.

Revise guidance when a real failure exposes a missing invariant. Prefer a
narrow correction over a new universal rule. Do not assume a specific model
needs either maximum handholding or no verification.

These choices apply the principles in OpenAI's
[Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
