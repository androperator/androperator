# Local and pull-request security checks

Run the security check before opening a pull request:

```bash
python3 validation/security/check.py
```

The default compares changed files against the merge base with `origin/main`.
Fetch the intended base before scanning. Select another base explicitly when
needed:

```bash
python3 validation/security/check.py --base origin/main
python3 validation/security/check.py --full
```

Python 3.11-3.14, Git, curl, and a network connection for the first download are
required. macOS and Linux on arm64 and x86_64 are supported; Linux requires
glibc 2.34 or newer for the pinned scanner wheel. The command installs
Semgrep CE in an isolated Python environment and downloads reviewdog and the
maintained rules pinned in
`validation/security/tools.json`. The scanner version is pinned and installed
from PyPI with all transitive dependencies pinned and SHA-256 verified using
`validation/security/requirements.txt`. Only wheels are installed, avoiding
unlocked build dependencies. The scanner cache is keyed by the dependency lock
and Python minor version. Cryptography is constrained below version 49 to
retain Intel macOS wheels; revisit this constraint when updating dependencies.
The scanner environment
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

Reviewed exceptions use rule-specific `nosemgrep` comments next to the affected
code, with a nearby explanation of why that operation is safe or intentional.
Unrelated edits and line movement do not invalidate a suppression. Other rules
and unsuppressed occurrences remain blocking. Review the rationale when changing
the suppressed operation or its trust assumptions; do not add blanket suppressions.
Rule updates do not automatically expire existing suppressions, so inspect relevant
suppressions when changing rules. Semgrep strict mode is disabled because it
reports mismatched-suppression warnings for other rules on the same line. The
wrapper still rejects every reported scanner error, including parse failures.

Semgrep, reviewdog, and downloaded scanner rules are development-only tooling.
Never distribute their tools, scanner-only dependencies, rule payloads, caches,
configuration, or install/runtime download hooks in product outputs. This policy
covers npm packages, APKs, installers, bundled skills, and deployed websites.
Our own rule-specific suppression comments and development source references are
permitted. A dependency independently required by the product is not prohibited
merely because the scanner also uses it.

`validation/security/check_distribution.py` enforces the product boundary without
installing the scanner or any third-party Python packages:

```bash
python3 validation/security/check_distribution.py --npm
python3 validation/security/check_distribution.py --npm --output <release_tgz>
python3 validation/security/check_distribution.py --npm-archive <release_tgz>
python3 validation/security/check_distribution.py --apk <operator_apk>
python3 validation/security/check_distribution.py --directory <built_site_directory>
python3 validation/security/check_distribution.py --public-docs <built_docs_directory>
```

The npm mode runs `npm pack` with packaging lifecycle hooks enabled, then reads
the actual tarball entries, including bundled skills, without extracting them.
`--output` retains the checked tarball for publication; otherwise it is temporary.
The release workflow publishes that same tarball with `--ignore-scripts=true`,
so no later lifecycle hook or repacking can change its contents. Existing tarballs
can be inspected directly with `--npm-archive`. APK mode
reads archive entries without extracting them. Directory mode checks all built
website files, including installers. Nested ZIP and gzip content is inspected;
unreadable, malformed, missing, or empty expected output fails the check. Scanner
names, integration references, environment paths, and recognizable rule payloads
are rejected; our own `nosemgrep` comments are allowed in product code. Published
documentation has a stricter `--public-docs` check: no scanner names, suppression
markers, or internal security-tooling references may appear in any output file
or path. The docs build applies this to the final site after adding static files,
covering HTML, search indexes, sitemaps, and `llms-full.txt`. Internal security
guidance stays in development sources and is not published.

The npm check runs in validation CI and before npm publication. The APK check runs
on the copied release artifact before either GitHub or R2 upload. All three site
build scripts check their final output directories before reporting success.
New publication paths must add this check. This is an accidental-inclusion guard,
not a license audit or proof against arbitrarily renamed or obfuscated code.

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
all applicable findings anywhere in added or modified files, including findings
on unchanged lines whose safety may be affected by surrounding edits. Existing
findings in unchanged files are not reported. Untracked files have no
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
using the PR's base SHA and reporting GitHub workflow annotations throughout changed
files. Reviewdog filters the JSON findings locally; the check converts those
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
checksums together. Update `validation/security/requirements.in` to match the
scanner version in `tools.json`, then regenerate its universal hash lock:

```bash
uv pip compile validation/security/requirements.in --universal --python-version 3.11 --generate-hashes --output-file validation/security/requirements.txt --no-emit-index-url
```

The lock covers supported macOS/Linux hosts and Python 3.11-3.14. Run the
regression tests and verify both a clean scan and a known finding with the real
binaries.
