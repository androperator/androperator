---
name: task-cleanup
description: Retire a completed task pack after preserving durable knowledge, follow-up, and code rationale.
---

# Task Cleanup

Close out the requested task pack without losing information needed after
`tasks/` is deleted. Infer the path from context; ask if it remains ambiguous.

Cleanup can run on an implementation branch once the requested work is complete
and validated. It does not require an open PR, merge, release, or additional
permission to treat completed work as ready for cleanup. Include cleanup in the
same PR as the implementation when practical.

For a multi-PR pack, retire completed phases' obsolete instructions and preserve
a concise `[DONE]` record, durable knowledge, and acceptance evidence. Keep the
unfinished phases and their prerequisites actionable. Delete the whole pack once
all planned work is complete and the conditions below hold, including on the
final implementation branch before merge. Do not claim an actual merge or clear
a dependency that requires merged code merely because cleanup has run.

## Before Deletion

Read the pack's plan, work breakdown, findings, and deferred items. Establish
three things:

1. Durable knowledge is present and accurate in its permanent home.
2. Code and docs no longer depend on references to the retiring pack.
3. Delivered behavior satisfies the acceptance criteria, with meaningful gaps
   fixed, preserved as actionable follow-up, or explicitly accepted.

Use existing validation evidence for the delivered revision when sufficient.
Run affected checks for cleanup changes or unresolved acceptance concerns;
do not rerun every historical phase command automatically.

## Knowledge and References

Route public behavior to `docs/`, internal decisions to
`docs/internal/design/`, maintenance workflows to `.agents/skills/`, and
source-owned invariants to the relevant code. Runtime skill authoring guidance
belongs in `docs/skills/`; runtime packages live in `<workspace>`.
Verify the destination contains the needed facts rather than assuming an
earlier docs update covered them. Use docs-author and docs-build when applicable.

Discard ephemeral logs, progress tracking, and obsolete history. Preserve
actionable deferred work with its reason, destination, and next step.

Search for the task path and task-specific phase labels in relevant source,
tests, docs, and scripts. Remove obsolete references or rewrite useful rationale
so it stands alone. Leave unrelated active-task references and published release
history intact.

## Gaps

Classify material gaps as:

- Fix now: small, local, and within the requested cleanup scope.
- Defer: preserve concrete follow-up where a later agent can find it.
- Accept: deliberate variance supported by existing decisions or user agreement.

Ordinary implementation differences are not gaps if acceptance still holds.
Do not repair obsolete task prose solely to delete it. Do not silently drop a
missing deliverable or waive an acceptance requirement. Ask only when a
disposition requires a new scope or risk decision; keep the pack until that
decision is resolved.

## Delete and Finish

Once the three conditions hold, the cleanup request authorizes deletion without
another approval checkpoint. Verify the target resolves inside `tasks/`;
reject `tasks/` itself, absolute paths, `..`, and symlink escapes. Inspect
uncommitted contents so unrelated work is not lost.

Delete the specific completed pack with `git rm -r -- <task-path>`, without force.
For partial cleanup, remove only obsolete files within the pack and update its
remaining handoffs; do not delete unfinished work.
Commit coherent, validated cleanup work with a Conventional Commit.
Report what moved, what was removed, any preserved follow-up, and validation.
