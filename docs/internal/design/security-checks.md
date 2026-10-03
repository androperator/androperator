# Local and pull-request security checks

This is repository engineering guidance, not product documentation. Keep this
page under `docs/internal/`; do not add it to public navigation, source-map
entries, static site files, or bundled product skills.

## Scope and operational impact

Semgrep CE supplies maintained static rules across the repository languages.
Reviewdog filters findings against Git changes and reports them locally. This
keeps the check usable by contributors and CI without a hosted scanner account.
Both tools are development dependencies, not Node runtime dependencies or Android
components. Scanning adds local/CI time, downloads, and cache storage; it does not
run during normal device operations.

The security workflow runs on PRs targeting `main` and manual dispatch, not on
every push, a schedule, or release tags. The local pre-PR requirement is recorded
in `AGENTS.md` and the completion skills; it is not a Git pre-commit hook. Making
the CI job mandatory for merging additionally depends on repository rulesets or
branch protection, which the workflow file does not configure.

The related installer and workflow hardening has a wider scope than PR checks:

- Both public installers verify the pinned nvm installer before execution when
  nvm must be bootstrapped. Existing nvm installations skip that download. A
  download, checksum-tool, checksum, or installer execution failure stops this
  path. This does not replace npm or Android artifact verification.
- GitHub Actions are pinned to commits, and affected workflow shell inputs use
  environment variables. These changes include release workflows.
- Validation helpers use private temporary execution files and reject hierarchy
  XML DOCTYPE declarations. These are test/skill helpers, not device-runtime
  contract changes.

## Running scans

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

## Tool installation and trust

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
The scanner environment and downloads are cached under
`${XDG_CACHE_HOME:-~/.cache}/androperator-security`. The rule archive and reviewdog
release SHA-256 checksums are verified on every run. An intact cache and completed
scanner installation permit offline scans. The installed Python environment is
trusted local state: dependency hashes are verified at installation, not by
rehashing every installed file on every scan. Keep the cache outside product
outputs and do not share a writable cache with untrusted processes.

Semgrep CE applies the Bash, generic, Java, JavaScript, Kotlin, TypeScript,
Python, YAML, JSON, Dockerfile, and HTML directories from
[Semgrep's maintained rules](https://github.com/semgrep/semgrep-rules).
The rules are downloaded for use by the check; they are not vendored or
redistributed in this repository. Semgrep-maintained rules use the
[Semgrep Rules License](https://semgrep.dev/legal/rules-license/), permitting
internal use and restricting redistribution and provision as a service.
Semgrep CE's engine is LGPL-2.1 and reviewdog is MIT. Per-rule license notices
remain intact in the downloaded collection.

## Findings, suppressions, and coverage

Only the selected rule directories are loaded. Coverage is limited to the
patterns and languages those rules declare and the CE engine's analysis
capabilities. This check does not provide dependency auditing or a review of
application logic.

The blocking policy requires category `security` or `audit`, and either the
`vuln`/`secure default` subcategory or rule ID `curl-pipe-bash`/`spawn-shell-true`.
General lint,
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
No whole-file checksums or fixed line numbers are used for exceptions. A
suppression is a reviewed trust decision, not proof that surrounding changes
cannot make the operation unsafe.

## Distribution policy and release checks

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

The npm modes require Node/npm and an already built `apps/node/dist/` directory
(`npm --prefix apps/node run build`). Archive and directory inspection use only
the Python standard library. Choose exactly one target option; `--output` is
valid only with `--npm`, and its parent directory must already exist. Packing
runs trusted repository lifecycle scripts and may modify the working tree.

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
It does not fetch and audit every transitive npm dependency. Review packaging,
publication, and dependency changes in addition to running the checks.

| Distribution | Enforcement point |
| --- | --- |
| npm tarball, including bundled skills | `publish-npm.yml` packs/checks into `$RUNNER_TEMP/androperator-release.tgz`, then publishes that file with scripts disabled |
| APK | `release-apk.yml` checks the copied artifact before checksum generation and either upload |
| Docs site | `scripts/docs_build.sh` runs `--public-docs` after generation and static-file copying |
| Androperator landing site | `scripts/site_build.sh` checks `sites/landing/out`, including its installer and copied docs corpus |
| Preserved landing site | `scripts/site_build_clawperator.sh` checks `sites/landing-clawperator/out` |

The docs assembler selects authored pages from navigation and excludes internal
pages; the full-text corpus is built from that navigation and staging output.
Do not copy this internal guidance into a public source to make it discoverable.
The final output check also covers generated search data and copied static files,
which source-only inspection would miss.

## File selection and scanner results

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
clean result. A successful scan with no targets means nothing needed scanning,
not that the full repository was audited. Reviewdog may omit `diagnostics` for a
clean result; the annotation writer accepts that valid empty report. There is no LLM, paid scanner account, or API key involved. Version
checks and scanner metrics are disabled; scanning uses downloaded local rules.

## CI reporting

`.github/workflows/security.yml` runs the same check on pull requests to `main`,
using the PR's base SHA and reporting GitHub workflow annotations throughout changed
files. Reviewdog filters the JSON findings locally; the check converts those
filtered findings to escaped workflow annotations without calling GitHub's API.
It uses a standard Ubuntu runner and read-only repository permissions;
it does not post review comments or require a write token. A manual workflow run
scans the full tree. GitHub Actions runner billing follows the repository's plan
and visibility; this workflow does not use paid larger runners.

## Validation and maintenance

Run orchestration and distribution regression tests without scanner downloads:

```bash
python3 -m unittest discover -s validation/security -v
```

Run the known-finding and clean-fixture test with the actual tools:

```bash
SECURITY_RUN_LIVE=1 python3 -m unittest discover -s validation/security -v
```

The offline suite also requires Node and npm: it builds temporary fixture
tarballs with real packaging hooks and runs `npm publish --dry-run` with scripts
disabled. It does not publish a package. The live scanner test additionally checks
findings on unchanged lines, clean annotation output, stable suppressions, new
unsuppressed occurrences, and parser failures.

The live test downloads the same pinned tools and runs automatically in the
security workflow. The orchestration tests also run in the repository's
validation suite and in the security workflow.

When updating tools or rules, update the pinned versions, rules commit, and
checksums together. Update `validation/security/requirements.in` to match the
scanner version in `tools.json`, then regenerate its universal hash lock:

```bash
uv pip compile validation/security/requirements.in --universal --python-version 3.11 --generate-hashes --output-file validation/security/requirements.txt --no-emit-index-url
```

The lock covers supported macOS/Linux hosts and Python 3.11-3.14. Run the
regression tests and verify both a clean scan and a known finding with the real
binaries.

## Recovering from failures

| Failure | Next step |
| --- | --- |
| Base ref cannot resolve | Fetch the intended base and rerun with `--base`; do not substitute a different comparison merely to get a clean scan |
| Download or checksum failure | Retry a transient network failure; investigate persistent checksum differences instead of replacing the expected hash with the received value |
| Corrupt or incomplete scanner environment | Remove only the affected scanner environment under the cache and rerun; an absent installation marker already causes a retry |
| Parser error or timeout | Treat the scan as incomplete; repair the source/tool compatibility issue or justify a narrowly scoped parser exclusion |
| Finding at an intentional operation | Inspect its callers and trust assumptions, then fix the operation or add a rule-specific suppression with rationale |
| Distribution failure | Remove the development artifact/reference from its owning source or packaging configuration, rebuild, and recheck; do not patch only generated output |
| npm packaging hook failure | Repair the hook and pack again; a source-tree scan is not a replacement for checking the produced archive |
| Public docs failure | Keep the engineering explanation under `docs/internal/`, remove public inputs or links that copied it, and rerun the full docs build |

Scan success is exit zero; findings and incomplete scans are nonzero. The scanner
wrapper returns 2 for its handled setup/scanner errors and propagates reviewdog's
status. The distribution checker prints `Distribution boundary passed` and exits
zero only after inspection; handled failures return 1 and invalid CLI usage
returns 2. Automation must require success rather than assuming every nonzero
status means a code finding.

For changes to the distribution checker, run its negative fixtures and inspect
real built outputs. For docs-policy changes, run `./scripts/docs_build.sh` and
confirm the public-docs guard succeeds. A local artifact check does not exercise
release signing, registry credentials, or remote uploads; those remain release
workflow responsibilities. Tool/rule updates also need a real known-finding and
clean scan on supported hosts. Preserve Action commit pins during updates.

Implementation owners: `validation/security/check.py` (scanning),
`validation/security/check_distribution.py` (artifacts),
`validation/security/test_check.py` and `test_distribution.py` (regressions),
`.github/workflows/security.yml` (PR/manual scanning), and the release/site
entry points listed above. Keep this page aligned with those sources.
