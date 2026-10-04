---
name: release-set-code-version-number
description: Bump and locally commit the unreleased Androperator code version without changing published-version docs.
---

Use this skill to bump the repo's next unreleased code version without changing public release-facing docs or website content.

**Source of Truth:** The canonical code version is defined in `apps/node/package.json`. The Android APK derives its `versionName` and `versionCode` automatically from this file during the Gradle build process.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
.agents/skills/release-set-code-version-number/scripts/set_code_version.py <old_version> <new_version>
```

Example:

```bash
.agents/skills/release-set-code-version-number/scripts/set_code_version.py 0.4.0 0.4.1
```

The default path updates the lockfile directly, reuses the existing
`apps/node/node_modules` installation, builds the Node package, and runs the
version compatibility tests. Use `--full` after the versions when you need a
clean dependency install and the complete Node test suite:

```bash
.agents/skills/release-set-code-version-number/scripts/set_code_version.py 0.4.0 0.4.1 --full
```

Before validation, the script removes ignored `.DS_Store` artifacts from
`apps/node/bundled-skills`, where they would otherwise be packaged as skills
or make the packaging test fail.

This skill updates code-facing surfaces only:
- `apps/node/package.json`
- `apps/node/package-lock.json`
- code/tests that should know about the new unreleased version
- internal repo-maintenance skill docs

It intentionally does **not** update public release-facing docs and release-maintenance docs such as:
- `docs/troubleshooting/compatibility.md`
- `docs/internal/release-procedure.md`
- `sites/docs/**`
- `sites/androperator-public/install.sh`

## Mandatory Manual Audit

Review every modified file before accepting the bump. Be especially careful with:
- `apps/node/src/test/unit/versionCompatibility.test.ts`
- `scripts/fake_adb.sh`
- skill docs that contain command examples

Doctor release download copy in tests should follow production: build expected strings with `getCliVersion()`, `getOperatorApkDownloadUrl()`, and `getOperatorApkSha256Url()` from `apps/node/src/domain/version/compatibility.ts` instead of hard-coding versioned download URLs. That keeps `release-set-code-version-number` from failing on `DoctorService` tests after each bump.

Confirm the bump only touched code-facing surfaces and did not leak into public docs.

## Required Validation

The default script run builds Node and runs the version compatibility tests
before committing. Use `--full` for dependency installation and the complete
Node test suite. Inspect the validation result rather than repeating the same
checks after an unchanged successful run. If the audit requires a follow-up
edit, rebuild and rerun the affected tests. A failed validation leaves the
bump incomplete.

## Commit Behavior

After validation succeeds, the script creates a dedicated commit automatically with this exact subject:

```bash
git commit -m "chore(build): set code version to <new_version>"
```

Example:

```bash
git commit -m "chore(build): set code version to 0.4.1"
```

Do not fold unrelated changes into this commit. Start from a clean working tree.

The npm package is `@androperator/cli`, while the executable remains `androperator`.
