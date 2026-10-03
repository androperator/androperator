---
name: dev-take-task-to-completion-review-loop
description: Finish an implemented task through task cleanup, code simplification, local Astra reviews until clean, and GitHub PR creation.
---

# Dev Take Task to Completion - Review Loop

Take the current implemented task to an up-to-date GitHub PR. Run task cleanup,
code simplification, local review, and PR creation in that order. Run the review loop until clean. This workflow is written for GPT-6 Astra.
It takes no arguments; infer the task from the current conversation and
repository. The review workflow is fixed.

Completion means the requested work and closeout changes are validated and
committed, the review stage has finished, and the PR contains the final
branch HEAD. Report a concrete blocker if any required stage cannot finish.

## Scope and Dependencies

Infer the task pack, implementation branch, acceptance criteria, and full change
scope from the current task and repository. Preserve unfinished phases of a
multi-PR pack. If implementation or required validation is incomplete, finish
the authorized scope before cleanup; do not expand into later phases.

Use the skills below, reading each when its stage is reached. Resolve shared
skills through the available skill catalog; the personal installation is
`~/.agents/skills/<name>/SKILL.md`. They are not assumed to exist in this repo.
If a required skill is unavailable, report the missing dependency rather than
silently replacing its workflow.

Invocation to complete this workflow authorizes its local edits, validation,
commits, implementation-branch push, and PR creation. Automatic discovery alone
does not grant that authorization. Preserve narrower user limits; do not merge
the PR, publish a release, force-push, or push directly to `main` or `prod`.

## Workflow

1. **Clean up the task.** Run [task-cleanup](../task-cleanup/SKILL.md).
   Preserve durable knowledge and actionable follow-up before retiring the
   completed pack or phases. If there is no task pack, record this stage as
   not applicable. Resolve an ambiguous pack before deleting anything.

2. **Simplify the implementation.** Run `$simplify-code` on the full task change,
   including cleanup changes, rather than only the latest commit. Preserve
   behavior, run affected checks, and commit justified changes under repository
   policy. No edits are needed when simplification would not improve the code.

3. **Review the completed change.** Prepare the branch for `$pr-create` before
   capturing the review target: ensure in-scope changes are committed, fetch
   `origin/main`, and merge it into the implementation branch if needed. Resolve
   conflicts and validate affected behavior. Do not switch away from unrelated
   work or silently include it. If the current branch is `main` or `prod`,
   establish a task branch containing the intended changes before proceeding.

   Run `$pr-code-review-codex-loop` on the full branch change against a stable
   resolved base. Each pass uses a fresh, read-only GPT-6 Astra reviewing
   subagent; the calling agent fixes and validates confirmed issues.

   Require `CLEAN` for the unchanged, committed target before PR creation.
   Continue after validated fixes so a fresh reviewer inspects them. Follow
   the loop skill's recovery and stopping rules; a blocker or an incomplete
   review is not a clean result. Report unfinished work if the loop cannot
   finish.

4. **Create the PR.** Run `python3 validation/security/check.py` against the
   intended PR base first. Resolve new security findings and scanner failures
   before creating or updating the PR.

   Run `$pr-create`, using branch-total context to author its
   required title/body JSON. Include meaningful validation and the actual
   review outcome in the PR description. Resolve routine local prerequisites
   and rerun the skill instead of treating its preflight stop as completion.

   If its fresh fetch requires another merge, validate the resulting changes
   and rerun the review loop before pushing. Any other change after the clean
   outcome also requires validation and a fresh review loop. If the comparison
   base changes, explicitly establish the updated full-branch scope for the
   new loop.

   Push the final branch HEAD even when an upstream already exists. If the
   branch already has a PR, update that PR to describe the final scope rather
   than creating a duplicate. Verify its head commit matches local HEAD and
   return its URL. A failed push or PR operation leaves the workflow incomplete.

## Finish

Report cleanup and preserved follow-up, simplifications, validation, review
outcome, final commit, and PR URL. Include the review pass count. Keep the summary concise and identify any
unfinished stage without claiming completion.
