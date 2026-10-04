---
name: release-orchestrator
description: Run or resume the complete Androperator release workflow, including publication and version follow-up.
---

# Release Orchestrator

## Overview

Use this skill to move one Androperator release through the full release phase while keeping the unreleased code version separate from the published release version.
At the start, confirm both the intended release version and the intended next unreleased version with the user if either is ambiguous.
Require a stable `major.minor.patch` release version, such as `1.1.0`, without a `v` prefix.

## Workflow

1. Establish the target versions.
   - Use the release version already specified by the user. Infer the next patch
     version unless another bump was requested; ask only if the versions remain ambiguous.
   - If the unreleased code version does not already match the intended release version, run `$release-set-code-version-number` first.
   - Treat the release version as the version that will be tagged and published.
   - Treat the next code version as the post-release unreleased version.
2. Verify CHANGELOG entry exists before tagging.
   - Check that `CHANGELOG.md` contains a `## [<version>]` block for the intended release version.
   - If the block is absent, run `$release-notes-author <previous-tag> main` (using the branch, not a tag, since the release tag does not exist yet). Review the generated entry, then merge it before proceeding.
   - Do not proceed to step 3 until the CHANGELOG entry is on the main branch.
3. Create the release.
   - Run `$release-create` for the intended release version.
   - Pass the exact release commit when needed.
   - Keep the release-create validations intact. For the one-time scoped 1.1.0 bootstrap, follow `docs/internal/release-procedure.md` and use `--bootstrap-existing-npm` after manual publication.
4. Verify the release.
   - After the release workflows complete, run `$release-verify` for the same version.
   - Stop if any verification surface fails.
   - Report the Homebrew update separately using the tap run and committed
     `Formula/cli.rb` version. `release-create` dispatches it automatically;
     a dispatch alone does not prove availability. Homebrew may defer a new
     dependency for 24 hours; hourly tap checks retry it. Do not recreate the
     npm release or hold public npm/APK docs updates for a deferred tap check.
5. Update published surfaces.
   - Once npm and GitHub Releases are live, run `$release-update-published-version` for the released version.
   - Keep the published-version commit separate from the code-version bump commit.
6. Advance the unreleased code version.
   - Run `$release-set-code-version-number` again for the next unreleased version.
   - Default to the next patch version unless the user explicitly asks for a different bump.
   - Keep the next version in the `0.x.y` series unless the user explicitly requests otherwise and the repo policy has changed.
7. Push the completed release commits only after every prior step has succeeded.
   - Push the branch commits after the release has been verified, the published surfaces have been updated, and the next code-version bump has been committed.
   - Do not push anything if verification fails, the release is not live, or any step is still incomplete.
   - Keep the release tag push separate from the branch commit push.

## Guardrails

- Keep code-facing and published-facing versions separate.
- Require the explicitly selected stable release version to match the committed package metadata.
- Do not update public docs before the release is live.
- If `release-create` already produced the published-version follow-up commit, review it instead of recreating it.
- Do not push `main` directly.
- If the user has already completed one of the steps, resume from the first incomplete step.
- Do not push the branch until the release is successfully verified and all release-phase commits are complete.
