# Release Procedure

This is the short, practical release flow for Androperator.

For the full release reference, see `docs/internal/release-reference.md`.

## Release Model

- One git tag represents one coherent Androperator release.
- The release version must already be committed in both `apps/node/package.json` and `apps/node/package-lock.json`.
- Pushing `vX.Y.Z` triggers both release workflows:
  - `.github/workflows/publish-npm.yml`
  - `.github/workflows/release-apk.yml`

## Expected Sequence

1. Run `.agents/skills/release-set-code-version-number/` to bump the repo's unreleased code version and create `chore(build): set code version to X.Y.Z` after validation passes.
2. Audit the resulting code-version commit for broken tests and internal examples.
3. Push the release branch or commit you want to tag.
4. Create the release tag with `.agents/skills/release-create/` against the exact commit to ship.
   - The release helper and the `Publish npm Package` workflow both refuse to continue unless `CHANGELOG.md` already has exactly one `## [X.Y.Z]` block for the tag.
5. Verify the published release with `.agents/skills/release-verify/` if you want an explicit read-only confirmation pass.
6. If `release-create` already prepared the follow-up `docs(release): update published version to X.Y.Z` commit, review it and then push or merge it so the public docs and website catch up to the live release.
7. If npm or GitHub Release propagation was still catching up and `release-create` skipped that follow-up, rerun `.agents/skills/release-update-published-version/` once `androperator@X.Y.Z` and GitHub Release `vX.Y.Z` are both discoverable.
8. After release, bump `main` forward to the next unreleased code version in a separate commit.

## Important Rules

- Do not release from a dirty working tree.
- Do not reuse or force-move release tags.
- Do not try to repair a partially published npm version. Bump to a new version instead.
- The tag must point at the exact commit whose `package.json` and `package-lock.json` versions match the tag.
- Keep the release commit and post-release version bump as separate commits.

## Standard Commands

Release creation:

```bash
.agents/skills/release-create/scripts/create_release.sh 1.0.0 [commit_sha]
```

Release verification:

```bash
.agents/skills/release-verify/scripts/release_verify.sh 1.0.0
```

## What Success Looks Like

- npm contains `androperator@X.Y.Z`
- GitHub Release `vX.Y.Z` exists with APK and checksum assets
- `latest.json` points at `X.Y.Z`
- `https://androperator.com/operator.apk` redirects to the immutable `vX.Y.Z` APK URL
