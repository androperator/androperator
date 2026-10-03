#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/gather_prs.sh"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$REPO_ROOT" ]]; then
  printf 'FAIL: not inside a git repository\n' >&2
  exit 1
fi

cd "$REPO_ROOT"

failures=0

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
  if [[ "$first_line" == 'Pull requests:' ]]; then
    printf 'PASS: gather_prs.sh emits a pull requests header first\n'
  else
    printf 'FAIL: gather_prs.sh first non-empty line was: %s\n' "$first_line"
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_prs.sh v0.5.0 v0.5.1 exited non-zero\n'
  failures=$((failures + 1))
fi
rm -f "$case1_out" "$case1_err"

case2_out="$(mktemp)"
case2_err="$(mktemp)"
if run_script "$case2_out" "$case2_err" v0.5.0 v0.5.1; then
  expected_numbers=(118 119 120 121 122 123 124 125 126 127)
  expected_count="${#expected_numbers[@]}"
  actual_count="$(grep -c '^-' "$case2_out" || true)"
  if [[ "$actual_count" -eq "$expected_count" ]]; then
    printf 'PASS: gather_prs.sh emits the expected number of PR bullets for v0.5.0..v0.5.1\n'
  else
    printf 'FAIL: expected %s PR bullets but saw %s\n' "$expected_count" "$actual_count"
    failures=$((failures + 1))
  fi
  line_index=0
  while IFS= read -r line; do
    [[ "$line" == Pull\ requests:* ]] && continue
    [[ -z "$line" ]] && continue
    pr_number="${expected_numbers[$line_index]}"
    if [[ "$line" != *"/pull/${pr_number})"* ]]; then
      printf 'FAIL: PR bullet %s did not appear in expected order: %s\n' "$pr_number" "$line"
      failures=$((failures + 1))
      break
    fi
    line_index=$((line_index + 1))
  done < "$case2_out"
else
  printf 'FAIL: gather_prs.sh v0.5.0 v0.5.1 exited non-zero for order check\n'
  failures=$((failures + 1))
fi
rm -f "$case2_out" "$case2_err"

case3_out="$(mktemp)"
case3_err="$(mktemp)"
if run_script "$case3_out" "$case3_err" v0.1.1 v0.1.2; then
  if grep -q '^None found$' "$case3_out"; then
    printf 'PASS: gather_prs.sh emits None found when no PR-linked commits land in the range\n'
  else
    printf 'FAIL: expected None found for a PR-less range\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: gather_prs.sh v0.1.1 v0.1.2 exited non-zero for empty-range check\n'
  failures=$((failures + 1))
fi
rm -f "$case3_out" "$case3_err"

case4_out="$(mktemp)"
case4_err="$(mktemp)"
if run_script "$case4_out" "$case4_err"; then
  printf 'FAIL: gather_prs.sh with no args unexpectedly succeeded\n'
  failures=$((failures + 1))
else
  if grep -q '^usage: \.agents/skills/release-notes-author/scripts/gather_prs.sh <start-tag> <end-ref>$' "$case4_err"; then
    printf 'PASS: gather_prs.sh with no args exits non-zero and prints usage\n'
  else
    printf 'FAIL: gather_prs.sh with no args did not print the expected usage line\n'
    failures=$((failures + 1))
  fi
fi
rm -f "$case4_out" "$case4_err"

case5_out="$(mktemp)"
case5_err="$(mktemp)"
if run_script "$case5_out" "$case5_err" invalid-tag v0.5.1; then
  printf 'FAIL: gather_prs.sh with invalid tag unexpectedly succeeded\n'
  failures=$((failures + 1))
else
  printf 'PASS: gather_prs.sh with an invalid tag exits non-zero\n'
fi
rm -f "$case5_out" "$case5_err"

fixture_repo="$(mktemp -d)"
fixture_gh="$(mktemp -d)"
fixture_out="$(mktemp)"
fixture_err="$(mktemp)"

cat >"$fixture_gh/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1 $2" in
  "repo view")
    if [[ "${3:-}" == "--json" && "${4:-}" == "nameWithOwner" && "${5:-}" == "--jq" && "${6:-}" == ".nameWithOwner" ]]; then
      # Match the real helper invocation so the fixture fails if the output contract changes.
      printf 'androperator/androperator\n'
    else
      printf 'unexpected repo view invocation: %s\n' "$*" >&2
      exit 1
    fi
    ;;
  "pr list")
    printf '%s\t42\n' "${FIXTURE_MERGE_SHA_1:-}"
    printf '%s\t42\n' "${FIXTURE_MERGE_SHA_2:-}"
    ;;
  "pr view")
    if [[ "$3" == "42" ]]; then
      printf 'Example title\thttps://example.com/pr/42\n'
    else
      printf 'unexpected PR number: %s\n' "$3" >&2
      exit 1
    fi
    ;;
  *)
    printf 'unexpected gh invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$fixture_gh/gh"

(
  cd "$fixture_repo" || exit 1
  git init -q
  git config user.name "Release Notes Test"
  git config user.email "release-notes-test@example.com"
  mkdir -p src
  printf 'base\n' > src/base.txt
  git add src/base.txt
  git commit -q -m "chore: baseline"
  git tag v0.0.9
  mkdir -p src
  printf 'one\n' > src/one.txt
  git add src/one.txt
  git commit -q -m "feat: first commit (#42)"
  printf 'two\n' > src/two.txt
  git add src/two.txt
  git commit -q -m "feat: second commit (#42)"
)

fixture_merge_sha_1="$(git -C "$fixture_repo" rev-list --first-parent --reverse HEAD | sed -n '2p')"
fixture_merge_sha_2="$(git -C "$fixture_repo" rev-list --first-parent --reverse HEAD | sed -n '3p')"

( 
  cd "$fixture_repo" || exit 1
  FIXTURE_MERGE_SHA_1="$fixture_merge_sha_1" FIXTURE_MERGE_SHA_2="$fixture_merge_sha_2" PATH="$fixture_gh:$PATH" bash "$SCRIPT" v0.0.9 HEAD >"$fixture_out" 2>"$fixture_err"
) && fixture_status=0 || fixture_status=$?

if [[ "$fixture_status" -eq 0 ]]; then
  if [[ "$(grep -c '^-' "$fixture_out" || true)" -eq 1 ]]; then
    printf 'PASS: gather_prs.sh deduplicates repeated PR numbers\n'
  else
    printf 'FAIL: expected exactly one bullet for duplicated PR commits\n'
    failures=$((failures + 1))
  fi
else
  printf 'FAIL: synthetic duplicate PR fixture invocation failed\n'
  failures=$((failures + 1))
fi

rm -rf "$fixture_repo" "$fixture_gh"
rm -f "$fixture_out" "$fixture_err"

if [[ "$failures" -ne 0 ]]; then
  printf 'FAILURES: %s\n' "$failures" >&2
  exit 1
fi

printf 'PASS: gather_prs.sh checks passed\n'
