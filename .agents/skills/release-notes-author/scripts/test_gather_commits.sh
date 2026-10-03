#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/gather_commits.sh"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$REPO_ROOT" ]]; then
  printf 'FAIL: not inside a git repository\n' >&2
  exit 1
fi

cd "$REPO_ROOT"

failures=0

path_type() {
  local path="$1"
  case "$path" in
    apps/node/src/test/**|\
      apps/android/app/src/test/**|\
      apps/android/app/src/androidTest/**|\
      apps/android/app-conformance/**|\
      apps/node/node_modules/**|\
      apps/node/dist/**|\
      apps/node/coverage/**|\
      apps/android/build/**|\
      apps/android/app/build/**|\
      apps/android/**/generated/**|\
      .agents/**|\
      .github/**|\
      tasks/**|\
      docs/internal/**|\
      sites/docs/AGENTS.md|\
      sites/docs/requirements.txt|\
      sites/landing-clawperator/public/sitemap.xml|\
      sites/landing-clawperator/public/landing-sitemap.xml|\
      sites/docs/.build/**|\
      sites/docs/site/**|\
      sites/landing-clawperator/.next/**|\
      sites/landing-clawperator/out/**|\
      detekt*.yml|\
      detekt-baseline.xml)
      printf 'infra'
      ;;
    apps/node/package-lock.json|\
      sites/docs/static/llms-full.txt|\
      sites/docs/static/llms.txt|\
      sites/landing-clawperator/public/llms-full.txt|\
      sites/landing-clawperator/public/llms.txt)
      printf 'generated'
      ;;
    apps/node/package.json|\
      apps/node/tsconfig.json|\
      apps/node/tsconfig.*.json|\
      sites/docs/mkdocs.yml|\
      sites/docs/source-map.yaml|\
      sites/landing-clawperator/next.config.js|\
      sites/landing-clawperator/next.config.cjs|\
      sites/landing-clawperator/next.config.mjs|\
      sites/landing-clawperator/next.config.ts|\
      *.gradle.kts|\
      gradle/**|\
      gradle.properties|\
      local.properties)
      printf 'config'
      ;;
    *)
      case "$path" in
        apps/node/**|apps/android/**|docs/**|sites/docs/**|sites/landing-clawperator/**)
          printf 'src'
          ;;
        *)
          printf 'infra'
          ;;
      esac
      ;;
  esac
}

run_script() {
  local output_file="$1"
  local stderr_file="$2"
  shift 2
  bash "$SCRIPT" "$@" >"$output_file" 2>"$stderr_file"
}

run_script_in_repo() {
  local repo_dir="$1"
  local output_file="$2"
  local stderr_file="$3"
  shift 3
  (
    cd "$repo_dir"
    bash "$SCRIPT" "$@" >"$output_file" 2>"$stderr_file"
  )
}

first_non_empty_line() {
  awk 'NF {print; exit}' "$1"
}

case1_out="$(mktemp)"
case1_err="$(mktemp)"
if run_script "$case1_out" "$case1_err" v0.5.0 v0.5.1; then
  first_line="$(first_non_empty_line "$case1_out")"
  if [[ "$first_line" =~ ^RELEASE_DATE:\ [0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    printf 'PASS: gather_commits.sh emits RELEASE_DATE first\n'
  else
    printf 'FAIL: gather_commits.sh first non-empty line was: %s\n' "$first_line"
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_commits.sh v0.5.0 v0.5.1 exited non-zero\n'
  failures=$((failures + 1))
fi
rm -f "$case1_out" "$case1_err"

case2_out="$(mktemp)"
case2_err="$(mktemp)"
if run_script "$case2_out" "$case2_err" v0.5.0 v0.5.1; then
  if grep -q '^=== COMMIT ' "$case2_out" && grep -q '^CLASSIFICATION: ' "$case2_out"; then
    printf 'PASS: gather_commits.sh emits commit blocks with classifications\n'
  else
    printf 'FAIL: gather_commits.sh output missing commit block or classification line\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_commits.sh v0.5.0 v0.5.1 exited non-zero for classification check\n'
  failures=$((failures + 1))
fi
rm -f "$case2_out" "$case2_err"

case3_out="$(mktemp)"
case3_err="$(mktemp)"
if run_script "$case3_out" "$case3_err" v0.5.0 v0.5.1; then
  if awk '
    /^=== COMMIT b2f72345/ { in_block = 1; next }
    /^=== COMMIT / && in_block { exit }
    in_block && /^CLASSIFICATION: drop:no-src$/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$case3_out"; then
    printf 'PASS: b2f7234 is classified as drop:no-src\n'
  else
    printf 'FAIL: b2f7234 was not classified as drop:no-src\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_commits.sh v0.5.0 v0.5.1 exited non-zero for b2f7234 check\n'
  failures=$((failures + 1))
fi
rm -f "$case3_out" "$case3_err"

case4_out="$(mktemp)"
case4_err="$(mktemp)"
if run_script "$case4_out" "$case4_err" v0.5.0 v0.5.1; then
  if grep -q '^CLASSIFICATION: keep$' "$case4_out"; then
    printf 'PASS: at least one commit in the range is classified as keep\n'
  else
    printf 'FAIL: no keep commit found in the range\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_commits.sh v0.5.0 v0.5.1 exited non-zero for keep check\n'
  failures=$((failures + 1))
fi
rm -f "$case4_out" "$case4_err"

case5_path='apps/node/src/test/unit/foo.test.ts'
if [[ "$(path_type "$case5_path")" == "infra" ]]; then
  printf 'PASS: %s is classified as infra\n' "$case5_path"
else
  printf 'FAIL: %s was not classified as infra\n' "$case5_path"
  failures=$((failures + 1))
fi

case5b_path='apps/node/tsconfig.json'
if [[ "$(path_type "$case5b_path")" == "config" ]]; then
  printf 'PASS: %s is classified as config\n' "$case5b_path"
else
  printf 'FAIL: %s was not classified as config\n' "$case5b_path"
  failures=$((failures + 1))
fi

case5c_path='sites/landing-clawperator/next.config.js'
if [[ "$(path_type "$case5c_path")" == "config" ]]; then
  printf 'PASS: %s is classified as config\n' "$case5c_path"
else
  printf 'FAIL: %s was not classified as config\n' "$case5c_path"
  failures=$((failures + 1))
fi

case6_out="$(mktemp)"
case6_err="$(mktemp)"
if run_script "$case6_out" "$case6_err"; then
  printf 'FAIL: gather_commits.sh with no args unexpectedly succeeded\n'
  failures=$((failures + 1))
else
  if grep -q '^usage: \.agents/skills/release-notes-author/scripts/gather_commits.sh <start-tag> <end-ref>$' "$case6_err"; then
    printf 'PASS: gather_commits.sh with no args exits non-zero and prints usage\n'
  else
    printf 'FAIL: gather_commits.sh with no args did not print the expected usage line\n'
    failures=$((failures + 1))
  fi
fi
rm -f "$case6_out" "$case6_err"

case7_out="$(mktemp)"
case7_err="$(mktemp)"
if run_script "$case7_out" "$case7_err" v0.5.0 v0.5.1 extra; then
  printf 'FAIL: gather_commits.sh with extra args unexpectedly succeeded\n'
  failures=$((failures + 1))
else
  printf 'PASS: gather_commits.sh rejects extra positional args\n'
fi
rm -f "$case7_out" "$case7_err"

case8_out="$(mktemp)"
case8_err="$(mktemp)"
if run_script "$case8_out" "$case8_err" invalid-tag v0.5.1; then
  printf 'FAIL: gather_commits.sh with invalid tag unexpectedly succeeded\n'
  failures=$((failures + 1))
else
  printf 'PASS: gather_commits.sh with an invalid tag exits non-zero\n'
fi
rm -f "$case8_out" "$case8_err"

android_fixture_repo="$(mktemp -d)"
android_fixture_out="$(mktemp)"
android_fixture_err="$(mktemp)"
(
  cd "$android_fixture_repo" || exit 1
  git init -q
  git config user.name "Release Notes Test"
  git config user.email "release-notes-test@example.com"
  mkdir -p apps/android
  printf 'plugins {\n}\n' > apps/android/build.gradle.kts
  git add apps/android/build.gradle.kts
  git commit -q -m "feat: add android build config"
  git tag v0.4.0
  printf 'plugins {\n    id(\"com.android.application\")\n}\n' > apps/android/build.gradle.kts
  git add apps/android/build.gradle.kts
  git commit -q -m "chore: tweak android build config"
  git tag v0.5.0
)

if run_script_in_repo "$android_fixture_repo" "$android_fixture_out" "$android_fixture_err" v0.4.0 v0.5.0; then
  if grep -q '^CLASSIFICATION: drop:no-src$' "$android_fixture_out" && \
    grep -q '^  apps/android/build.gradle.kts  \[config\]$' "$android_fixture_out"; then
    printf 'PASS: synthetic android config fixture is classified as drop:no-src\n'
  else
    printf 'FAIL: synthetic android config fixture was not classified as drop:no-src\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: synthetic android config fixture invocation failed\n'
  failures=$((failures + 1))
fi
rm -rf "$android_fixture_repo"
rm -f "$android_fixture_out" "$android_fixture_err"

fixture_repo="$(mktemp -d)"
fixture_out="$(mktemp)"
fixture_err="$(mktemp)"
(
  cd "$fixture_repo" || exit 1
  git init -q
  git config user.name "Release Notes Test"
  git config user.email "release-notes-test@example.com"
  mkdir -p apps/node/src/feature
  printf 'export const value = 1;\n' > apps/node/src/feature/old.ts
  git add apps/node/src/feature/old.ts
  git commit -q -m "feat: add temporary feature"
  git tag v0.4.0
  rm apps/node/src/feature/old.ts
  git add -u
  git commit -q -m "feat: remove temporary feature"
  git tag v0.5.0
)

if run_script_in_repo "$fixture_repo" "$fixture_out" "$fixture_err" v0.4.0 v0.5.0; then
  if grep -q '^CLASSIFICATION: keep$' "$fixture_out" && \
    grep -q '^  apps/node/src/feature/old.ts  \[deleted\]\[src\]$' "$fixture_out"; then
    printf 'PASS: synthetic deleted-src fixture is classified as keep with a deleted src file\n'
  else
    printf 'FAIL: synthetic deleted-src fixture did not emit a deleted src keep commit\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: synthetic deleted-src fixture invocation failed\n'
  failures=$((failures + 1))
fi
rm -rf "$fixture_repo"
rm -f "$fixture_out" "$fixture_err"

release_fixture_repo="$(mktemp -d)"
release_fixture_out="$(mktemp)"
release_fixture_err="$(mktemp)"
(
  cd "$release_fixture_repo" || exit 1
  git init -q
  git config user.name "Release Notes Test"
  git config user.email "release-notes-test@example.com"
  mkdir -p docs/troubleshooting sites/landing-clawperator/public
  printf 'Compatibility guide.\n' > docs/troubleshooting/compatibility.md
  printf '#!/usr/bin/env bash\n' > sites/androperator-public/install.sh
  git add docs/troubleshooting/compatibility.md sites/androperator-public/install.sh
  git commit -q -m "docs: add public install docs"
  git tag v1.0.0
  printf 'Compatibility guide for 1.0.0.\n' > docs/troubleshooting/compatibility.md
  printf '#!/usr/bin/env bash\n# install 1.0.0\n' > sites/androperator-public/install.sh
  git add docs/troubleshooting/compatibility.md sites/androperator-public/install.sh
  git commit -q -m "docs(release): update published version to 1.0.0"
  git tag v1.0.1
)

if run_script_in_repo "$release_fixture_repo" "$release_fixture_out" "$release_fixture_err" v1.0.0 v1.0.1; then
  if grep -q '^SUBJECT: docs(release): update published version to 1.0.0$' "$release_fixture_out" && \
    grep -q '^CLASSIFICATION: drop:infra$' "$release_fixture_out"; then
    printf 'PASS: published-version release ceremony commit is classified as drop:infra\n'
  else
    printf 'FAIL: published-version release ceremony commit was not classified as drop:infra\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: published-version release ceremony fixture invocation failed\n'
  failures=$((failures + 1))
fi
rm -rf "$release_fixture_repo"
rm -f "$release_fixture_out" "$release_fixture_err"

if [[ "$failures" -ne 0 ]]; then
  printf 'FAIL: %s test case(s) failed\n' "$failures" >&2
  exit 1
fi

exit 0
