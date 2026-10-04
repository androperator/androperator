# Release Reference

## Scope

Androperator currently ships one product version across:

- the Node API / CLI package in `apps/node`
- the Androperator Operator App APK in `apps/android/app`

One git tag represents one coherent product release.

## Release Trigger

Push a semver tag with a `v` prefix:

- `v0.1.0`
- `v0.1.1`
- `v1.0.0`

That tag triggers:

- `.github/workflows/release-apk.yml`
- `.github/workflows/publish-npm.yml`

Both workflows validate that the tag version exactly matches `apps/node/package.json`.

## Release Outputs

For every tagged release, GitHub Actions should:

1. Build the Android release APK from `:app:assembleRelease`
2. Sign the APK with the configured Android release keystore
3. Create a GitHub Release and upload the APK plus checksum
4. Upload the same APK and checksum to Cloudflare R2
5. Update the stable metadata pointer:
   - all releases update `latest.json`
6. Publish the Node package to npm via Trusted Publishing (OIDC):
   - all published releases use npm dist-tag `latest`

## npm release archive

After building and testing, the npm workflow runs `validation/npm-release/pack.py`
with the tag version. Packaging hooks finish before the helper inspects the
actual tarball. It requires the `androperator` package name, matching version,
and a nonempty built CLI entry point, and rejects escaping paths, duplicate files,
and nonregular file entries. This is an archive integrity and release identity
check, not a dependency or security audit.

The helper retains the validated archive in the runner temporary directory. The
workflow publishes that exact file with `--ignore-scripts=true`; do not replace
this with directory-based publication that packs again. Packaging work belongs
in `prepack` or `prepare`; publication lifecycle hooks do not run. A packaging or
validation failure stops publication. Repair the source or hook and rerun the
workflow rather than publishing an older archive.

Run `python3 -m unittest discover -s validation/npm-release -v` for offline
regressions using real npm packaging hooks and publication dry-runs. These tests
require Node/npm but do not publish or verify registry authentication.

## Required Secrets

### Android signing

The workflow maps the existing signing secrets to `ANDROPERATOR_ANDROID_*`
environment variables, retaining the same signing key:

- `CLAWPERATOR_ANDROID_KEYSTORE_BASE64`
- `CLAWPERATOR_ANDROID_KEYSTORE_PASSWORD`
- `CLAWPERATOR_ANDROID_KEY_ALIAS`
- `CLAWPERATOR_ANDROID_KEY_PASSWORD`

These stored secret names are a deployment exception until credentials are renamed.

### Cloudflare R2

- `ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID`
- `ANDROPERATOR_CLOUDFLARE_ACCESS_KEY_ID`
- `ANDROPERATOR_CLOUDFLARE_SECRET_ACCESS_KEY`
- `ANDROPERATOR_CLOUDFLARE_R2_BUCKET`
- `ANDROPERATOR_CLOUDFLARE_DOWNLOADS_BASE_URL`

### npm publishing

- npm Trusted Publisher configured for `androperator/androperator`
- workflow filename on npm must exactly match `publish-npm.yml`

## Versioning Rules

- `apps/node/package.json` is the default version source for local Android builds.
- Tagged releases must use the exact same version for Node and Android.
- Do not cut a tag until `apps/node/package.json` is already set to that version.
- Do not introduce an independent Android release version unless there is a deliberate compatibility plan to support it.

## Cloudflare Layout

Expected public structure:

- `https://downloads.androperator.com/operator/latest.json`
- `https://downloads.androperator.com/operator/vX.Y.Z/operator-vX.Y.Z.apk`
- `https://downloads.androperator.com/operator/vX.Y.Z/operator-vX.Y.Z.apk.sha256`

Expected stable UX:

- `https://androperator.com/operator.apk` redirects to the current stable immutable APK
- `https://androperator.com/install.sh` bootstraps host prerequisites, installs the CLI, and delegates post-bootstrap behavior to `androperator install`
- `androperator install` uses release metadata from `latest.json` when operator remediation needs the current stable APK
- Public install guidance should not point users at GitHub Releases for the primary install path

## Release Checklist

1. Confirm `apps/node/package.json` has the intended release version.
2. Confirm `CHANGELOG.md` already has exactly one release block for the intended version. The release helper and `Publish npm Package` workflow both gate on that block before publishing.
3. Confirm signing and Cloudflare secrets are present in GitHub.
4. Confirm the branch is ready to release.
5. Create and push the tag.
6. Verify GitHub Actions completed successfully.
7. Verify GitHub Release assets exist.
8. Verify Cloudflare metadata and artifact uploads exist.
9. Verify npm publish succeeded.
10. Verify installation on a real device.

## v0.10 Acceptance Requirements

Feature implementation is merged through `b7ff0695`. Before publishing v0.10,
record evidence or an explicit release-scope disposition for these requirements:

1. Resolve or explicitly accept/defer the historical post-dispatch reader-exit
   cause described in the [transport findings](design/result-transport-reliability.md#diagnostic-verification-and-current-release-limits).
   Passing finite series and controlled disconnects establish bounded behavior,
   not the historical cause. Preserve original failures and never replay an
   uncertain mutation to recover evidence.
2. Run `./validation/test_all.sh` locally and retain the source revision and
   suite results. On 13 September 2026 the release owner selected local
   verification and removed the requirement for a GitHub hierarchy workflow run.
   The default runner covers Android unit tests, Node tests, evals and repository
   validation. It does not run live device suites, install APKs or exercise the
   supported CI emulator image. Preserve those coverage limits alongside the
   existing [local hierarchy evidence](../../validation/sensitive-hierarchy-access/README.md).
   The manual GitHub workflow remains available for optional device regression.
3. Record the final source commit, CLI/APK identities, supported-device limits
   and all declared attempts. Use existing validation where it covers the
   delivered revision; run the combined Node suite, relevant Android unit/build
   checks, docs build and affected live harnesses for uncovered candidate changes.
   Verify CLI help, strict/query results, compact snapshots, still bundles,
   managed-video lifecycle and overlay interaction together. Coordinate any
   affected sibling skill migrations, versions and smoke checks before claiming
   compatibility.

The earlier six-case debug/release fresh/subpage/search matrix at `306b38d`
passed; its [integration record](../../validation/sensitive-hierarchy-access/README.md#integrated-hierarchy-and-transport-acceptance)
retains build identity and attempt accounting. The later reader-exit recurrence
remains in the transport findings alongside passing series. Media verification
and retirement of implementation plans do not close outstanding release gates.

### Release-owner disposition for 0.10.0

On 13 September 2026, the release owner explicitly approved shipping 0.10.0
with the historical post-dispatch reader-exit investigation deferred. The
original cause remains unresolved; passing local suites and finite live series
do not establish failure-free transport. Preserve the recorded failures and
continue the investigation separately without replaying uncertain mutations.
This disposition satisfies requirement 1 above for this release only.

### Local verification on 13 September 2026

`./validation/test_all.sh` completed once with exit 0 against source
`99c2290b5edbb79c7851821cecad8d6b4567b1d4`, with only release-guidance edits
pending. Node build, Android unit tests, all 1,571 Node tests (no skips), all
124 eval tests and repository validation passed. Repository validation included
real-codec full-stream video checks, offline hierarchy/transport fixtures,
blocked-term policy, installer and on-screen-log harness checks.

This run did not install APKs, run live device suites or reproduce the historical
reader-exit cause. Those limits remain separate from the passing local suites.

## Tag Commands

Example release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Verification

After the workflows finish, verify:

- GitHub Release exists at `https://github.com/androperator/androperator/releases`
- npm package version exists at `https://www.npmjs.com/package/androperator`
- stable metadata file exists at `https://downloads.androperator.com/operator/latest.json`
- APK URL in metadata resolves
- checksum file matches the APK
- `curl -fsSL https://androperator.com/install.sh | bash` bootstraps the CLI and reaches the delegated `androperator install` flow
- `androperator install` downloads and verifies the current stable APK when operator remediation needs setup

## Rollback

Rollback should never replace or delete a versioned APK object.

Rollback means:

1. Point `latest.json` back to the last known good stable release
2. Purge metadata cache if required
3. Re-verify `https://androperator.com/operator.apk`

## Notes

- Releases should use the production Android signing key.
- Worker deployment for `/operator.apk` can be managed separately from the artifact upload workflow if needed.
