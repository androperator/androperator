---
name: release-create
description: Create a Clawperator release from a committed version by validating and pushing its release tag.
---

Use this skill after the release code version has already been committed to the repository. Keep code-version bumping separate.

This skill creates a release by:
1. Verifying the requested version matches both `apps/node/package.json` and `apps/node/package-lock.json`.
2. Refusing to proceed unless `CHANGELOG.md` already contains exactly one release block for the requested version.
3. Refusing to proceed if the version is already published on npm, if the tag already exists, or if a GitHub Release already exists.
4. Running the same local Node checks used by `.github/workflows/publish-npm.yml`:
   - `npm --prefix apps/node ci`
   - `npm --prefix apps/node run build`
   - `npm --prefix apps/node run test`
5. Creating an annotated `v<version>` tag at the requested SHA.
6. Pushing only that tag.
7. Inspecting the resulting `Publish npm Package` and `Release APK` workflow runs with `gh`.
8. Attempting `.agents/skills/release-update-published-version/` after the workflows succeed, retrying briefly for npm/GitHub propagation and creating a follow-up local commit for public docs and website content when the release is discoverable.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
.agents/skills/release-create/scripts/create_release.sh <version> [sha]
```

Example:

```bash
.agents/skills/release-create/scripts/create_release.sh 0.12.6
```

If `sha` is omitted, the script tags `HEAD`.

## Preconditions

- The target release commit must already exist locally.
- `apps/node/package.json` and `apps/node/package-lock.json` must already contain the target version.
- `CHANGELOG.md` must already contain exactly one `## [<version>]` block for the target release.
- Public release-facing docs do not need to be pre-bumped. This skill will try to prepare the published-version follow-up after the release succeeds.
- `git`, `npm`, and `gh` must be installed and authenticated.

## Safety Rules

- Do not force-move existing tags.
- Do not publish a version that already exists on npm.
- Do not push a branch as part of this step. Push the tag only.
- Do not use this skill to repair a partially published version. Bump to a new version instead.
- The post-release published-version update is a separate local commit. Review and push or merge it explicitly.
- If npm or GitHub Release propagation is still catching up after the workflows finish, the script reports a skipped published-version update instead of failing the release. Run `.agents/skills/release-update-published-version/` later in that case.

## Output Expectations

The script prints:

- release version
- target tag
- target commit SHA
- local validation status
- pushed tag confirmation
- detected workflow run URLs and conclusions
- published-version follow-up commit information when the release is already discoverable
- or a clear skipped message if publication metadata is still propagating

If a workflow does not appear quickly, the script reports that clearly instead of guessing success.
