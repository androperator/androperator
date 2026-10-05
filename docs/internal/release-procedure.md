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
7. If npm or GitHub Release propagation was still catching up and `release-create` skipped that follow-up, rerun `.agents/skills/release-update-published-version/` once `@androperator/cli@X.Y.Z` and GitHub Release `vX.Y.Z` are both discoverable.
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

- npm contains `@androperator/cli@X.Y.Z`
- GitHub Release `vX.Y.Z` exists with APK and checksum assets
- `latest.json` points at `X.Y.Z`
- `https://androperator.com/operator.apk` redirects to the immutable `vX.Y.Z` APK URL

## One-time scoped package bootstrap (1.1.0)

The npm package is now `@androperator/cli`; the executable remains `androperator`.
The old unscoped `androperator` package receives no further releases.

1. Merge the migration and release notes, then check out the exact clean merged
   commit. Install dependencies, build, and test `apps/node`.
2. Retain the archive that will be published:
   `python3 validation/npm-release/pack.py --version 1.1.0 --output /tmp/androperator-cli-1.1.0.tgz`.
3. Log in to npm as an authorized member of the `androperator` organization.
   Publish the validated archive using
   `npm publish /tmp/androperator-cli-1.1.0.tgz --ignore-scripts=true --access public --tag latest`.
   Complete browser login and 2FA yourself; do not share tokens with the agent.
4. Configure the new package's npm Trusted Publisher: GitHub Actions,
   owner `androperator`, repository `androperator`, workflow `publish-npm.yml`,
   no environment, and allow `npm publish`. Require 2FA and disallow bypass tokens.
5. Run
   `.agents/skills/release-create/scripts/create_release.sh --bootstrap-existing-npm 1.1.0 <release_commit>`.
   This verifies the published archive matches a rebuild of the target commit before tagging.
   The tag workflow verifies the existing npm artifact for 1.1.0 instead of
   republishing it; Android/GitHub release publication proceeds normally.
6. Verify a fresh global installation and the signed APK together. Then deprecate
   the old package with a message directing users to `npm install -g @androperator/cli`.
   Retain its ownership and versions, and remove its old Trusted Publisher.

Future versions use normal tag-triggered OIDC publication. The bootstrap does not
prove OIDC publishing for the new package; verify that on the next release.
Never reuse a published version or move an existing release tag.

## Homebrew distribution

[androperator/homebrew-tap](https://github.com/androperator/homebrew-tap) installs
`@androperator/cli` and `@androperator/emulator` from their existing npm archives.
There is no additional application build or artifact publication.

After npm and APK workflows succeed, `release-create` requests `update.yml` in
the tap using the release operator's existing `gh` authorization. It reports
`homebrew_update=requested` with verification pending, or
`homebrew_update=deferred` if dispatch fails. Neither result claims the formula
was published. The tap's hourly schedule also detects releases without a dispatch.
No cross-repository CI token or additional npm token is required.

The tap verifies archives, installs and tests the candidates, then commits
formula updates automatically. Homebrew can refuse dependencies published in
the previous 24 hours; the schedule retries after that restriction elapses.
A failed tap check leaves existing formula versions unchanged. Inspect
[update runs](https://github.com/androperator/homebrew-tap/actions/workflows/update.yml)
and the committed `Formula/cli.rb` version before claiming Homebrew availability.
Do not recreate an npm release or its tag to retry a Homebrew update. A manual
retry uses `gh workflow run update.yml --repo androperator/homebrew-tap --ref main`.
