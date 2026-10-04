---
name: release-verify
description: Verify a published Androperator release across tags, workflows, packages, APKs, and checksums.
---

Use this skill after a release tag has already been pushed and the release workflows have had time to finish.

This skill verifies:
1. The requested `v<version>` tag exists and resolves to a commit.
2. The `Publish npm Package` and `Release APK` workflows completed successfully for that tag.
3. A GitHub Release exists for the tag with the expected APK and checksum assets.
4. npm contains `@androperator/cli@<version>`.
5. `https://downloads.androperator.com/operator/latest.json` points at the requested version.
6. The immutable APK and checksum URLs exist and agree with `latest.json`.
7. `https://androperator.com/operator.apk` redirects to the immutable APK URL for the same version.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
.agents/skills/release-verify/scripts/release_verify.sh <version>
```

Example:

```bash
.agents/skills/release-verify/scripts/release_verify.sh 0.2.4
```

## Preconditions

- The release tag must already exist on GitHub.
- `gh`, `curl`, `git`, `node`, and `npm` must be installed.
- `gh` must be authenticated for the target repository.

## Safety Rules

- This skill is read-only. It must not create, move, delete, or push tags.
- This skill must not publish packages or create releases.
- If a verification step fails, report the failing surface explicitly instead of trying to repair it.

## Output Expectations

The script prints one line per verification surface:

- tag commit
- workflow conclusions and URLs
- GitHub Release URL and assets
- npm published version
- `latest.json` version and checksum
- immutable APK URL status
- checksum match result
- stable redirect target

If all checks pass, the script exits successfully. If any check fails, it exits non-zero with a precise failure message.
