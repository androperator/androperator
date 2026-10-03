---
name: release-update-published-version
description: Update and locally commit public version surfaces after the release is live on npm and GitHub.
---

Use this skill only after a release is actually live on npm and GitHub Releases.

It will refuse to run for versions that are not already published on both surfaces.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
.agents/skills/release-update-published-version/scripts/update_published_version.py <version>
```

Example:

```bash
.agents/skills/release-update-published-version/scripts/update_published_version.py 0.2.4
```

This skill updates public release-facing surfaces such as:
- `docs/index.md` (the "Current release" badge that feeds the docs home page)
- `docs/troubleshooting/compatibility.md` (versioned Operator APK remediation example)
- `docs/internal/release-procedure.md` (versioned release command examples)
- `sites/androperator-public/install.sh`
- the generated docs-site outputs produced by `./scripts/docs_build.sh`, including the docs home page and `llms-full.txt`
- generated `llms-full.txt` artifacts

It then rebuilds docs/site artifacts, verifies that the built docs homepage and generated `llms-full.txt` artifacts contain the target release marker, and creates a dedicated follow-up commit:

```bash
git commit -m "docs(release): update published version to <version>"
```

## Safety Rules

- Run this only after the version is verifiably live.
- The target version must already exist as both `androperator@<version>` on npm and `v<version>` on GitHub Releases.
- This skill updates public-facing content. Do not use it for unreleased code versions.
- Do not fold unrelated changes into the published-version commit.

## Validation

The script runs:
- `./scripts/docs_build.sh`

If these steps fail, the published-version update is incomplete.
