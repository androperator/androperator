# Local and pull-request security checks

Run the security check before opening a pull request:

```bash
python3 validation/security/check.py
```

The default compares changed lines against the merge base with `origin/main`.
Fetch the intended base before scanning. Select another base explicitly when
needed:

```bash
python3 validation/security/check.py --base origin/main
python3 validation/security/check.py --full
```

Python 3.11+, Git, curl, and a network connection for the first download are
required. macOS and Linux on arm64 and x86_64 are supported. The command installs
Semgrep CE in an isolated Python environment and downloads reviewdog and the
maintained rules pinned in
`validation/security/tools.json`. The scanner version is pinned and installed
from PyPI; its transitive Python dependencies are resolved by pip at installation time. The scanner environment
and downloads are cached under
`${XDG_CACHE_HOME:-~/.cache}/androperator-security`. The rule archive and reviewdog
release SHA-256 checksums are verified on every run. An intact cache and completed
scanner installation permit offline scans.

Semgrep CE applies the Bash, generic, Java, JavaScript, Kotlin, TypeScript,
Python, YAML, JSON, Dockerfile, and HTML directories from
[Semgrep's maintained rules](https://github.com/semgrep/semgrep-rules).
The rules are downloaded for use by the check; they are not vendored or
redistributed in this repository. Semgrep-maintained rules use the
[Semgrep Rules License](https://semgrep.dev/legal/rules-license/), permitting
internal use and restricting redistribution and provision as a service.
Semgrep CE's engine is LGPL-2.1 and reviewdog is MIT. Per-rule license notices
remain intact in the downloaded collection.

Only the selected rule directories are loaded. Coverage is limited to the
patterns and languages those rules declare and the CE engine's analysis
capabilities. This check does not provide dependency auditing or a review of
application logic.

The blocking policy selects rules labeled `security` or `audit` with the
`vuln` or `secure default` subcategory, plus `curl-pipe-bash` and `spawn-shell-true`. General lint,
portability, and manual audit suggestions do not block PRs. This is a security
gate, not a replacement for a manual review of command execution or dependencies.

`validation/security/reviewed-findings.json` records 20 reviewed exceptions,
with a reason for each. They cover required launcher activities and permission
protected debug activities, trusted local validation commands, intentionally
exposed agent capabilities, fixed-field video metadata, and documentation or
test fixtures. Each exception matches the rule, exact source location, and
SHA-256 of the entire file. A change anywhere in that file invalidates it.
Updating the rules commit also invalidates all exceptions. The command prints
the number of matched exceptions; new locations and new rules remain blocking.
Do not regenerate this file automatically or add exceptions without inspecting
the owning implementation and its callers.

The scan respects Semgrep CE's Git exclusions and excludes nested `.worktrees`.
Two exact paths are also excluded because their valid source syntax is not
supported by the scanner:

- `gradlew`: the generated Gradle wrapper, checked with `sh -n gradlew`.
- `sites/docs/overrides/main.html`: the Jinja template, checked by the docs build.

The command prints each applicable exclusion. These files receive no Semgrep
coverage; their names are not blanket exclusions for other wrappers or templates.
Keep these exceptions narrow and revisit them when updating the scanner.
GitHub workflow commands pass expression values through environment variables,
so those workflow files remain scanned without parser exceptions.

The default scans changed files in the working tree, including local tracked
edits, then reviewdog reports
only findings on added or modified lines in the diff. Untracked files have no
Git diff and must be staged before they can produce findings in the default
mode. With no changed files the command succeeds without downloading or scanning.
`--full` scans the entire tree and reports existing issues too. Parse errors in
unchanged files cannot block a diff scan but will block a full scan.
An inline `nosemgrep` suppression is honored by the scanner; use a rule-specific
suppression only after checking the finding and documenting its rationale.

The command exits zero when the scan and reporter succeed without applicable
findings. It exits nonzero for findings, download failures, invalid rules,
scanner errors, or reporter failures. Scanner errors are never treated as a
clean result. There is no LLM, paid scanner account, or API key involved. Version
checks and scanner metrics are disabled; scanning uses downloaded local rules.

`.github/workflows/security.yml` runs the same check on pull requests to `main`,
using the PR's base SHA and reporting GitHub workflow annotations on changed
lines. Reviewdog filters the JSON findings locally; the check converts those
filtered findings to escaped workflow annotations without calling GitHub's API.
It uses a standard Ubuntu runner and read-only repository permissions;
it does not post review comments or require a write token. A manual workflow run
scans the full tree. GitHub Actions runner billing follows the repository's plan
and visibility; this workflow does not use paid larger runners.

Run orchestration regression tests without downloads:

```bash
python3 -m unittest discover -s validation/security -v
```

Run the known-finding and clean-fixture test with the actual tools:

```bash
SECURITY_RUN_LIVE=1 python3 -m unittest discover -s validation/security -v
```

The live test downloads the same pinned tools and runs automatically in the
security workflow. The orchestration tests also run in the repository's
validation suite and in the security workflow. When updating tools or rules, update the pinned versions, commit, and
checksums together, run the regression tests, and verify both a clean scan and a
known finding with the real binaries.
