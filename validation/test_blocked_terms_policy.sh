#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/androperator-blocked-terms-test.XXXXXX")"
test_repo="$test_root/repo"
terms_file="$test_root/blocked-terms.txt"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$test_repo/.githooks" "$test_repo/validation"
cp "$repo_root/.githooks/pre-commit" "$test_repo/.githooks/pre-commit"
cp "$repo_root/.githooks/commit-msg" "$test_repo/.githooks/commit-msg"
cp "$repo_root/.githooks/pre-push" "$test_repo/.githooks/pre-push"
cp "$repo_root/validation/blocked_terms_policy.sh" "$test_repo/validation/blocked_terms_policy.sh"
cp "$repo_root/validation/commit_message_policy.sh" "$test_repo/validation/commit_message_policy.sh"
chmod +x "$test_repo/.githooks/"*

git -C "$test_repo" init --quiet
git -C "$test_repo" config user.name "Blocked Terms Test"
git -C "$test_repo" config user.email "blocked-terms-test@example.invalid"
git -C "$test_repo" config core.hooksPath .githooks
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" git -C "$test_repo" commit --allow-empty -m "test: fixture" --quiet
blocked_lower="$(printf '%s%s' 'bra' 've')"
blocked_upper="$(printf '%s' "$blocked_lower" | tr '[:lower:]' '[:upper:]')"
blocked_mixed="$(printf '%s%s' 'bRa' 'Ve')"
printf '%s\n' "$blocked_mixed" > "$terms_file"
export ANDROPERATOR_BLOCKED_TERMS_FILE="$terms_file"

assert_rejected() {
  if "$@"; then
    echo "Expected blocked-terms hook to reject: $*" >&2
    exit 1
  fi
}

assert_rejected git -C "$test_repo" commit --allow-empty -m "test: $blocked_lower"
assert_rejected git -C "$test_repo" commit --allow-empty -m "test: $blocked_upper"
assert_rejected git -C "$test_repo" commit --allow-empty -m "test: $blocked_mixed"

git -C "$test_repo" commit --allow-empty -m "test: allowed message" --quiet
git -C "$test_repo" rev-parse --verify HEAD >/dev/null

printf 'const blocked = "%s";\n' "$blocked_lower" > "$test_repo/blocked-content.js"
git -C "$test_repo" add blocked-content.js
assert_rejected git -C "$test_repo" commit -m "test: staged content"
git -C "$test_repo" reset --quiet -- blocked-content.js
rm "$test_repo/blocked-content.js"

assert_rejected env GIT_COMMITTER_EMAIL="person@${blocked_upper}.invalid" git -C "$test_repo" commit --allow-empty -m "test: committer override"
assert_rejected env GIT_AUTHOR_EMAIL="person@${blocked_lower}.invalid" git -C "$test_repo" commit --allow-empty -m "test: author override"
assert_rejected git -C "$test_repo" commit --allow-empty --author="Test <person@${blocked_mixed}.invalid>" -m "test: explicit author"
assert_rejected env GIT_COMMITTER_NAME="$blocked_lower" git -C "$test_repo" commit --allow-empty -m "test: committer name"

git -C "$test_repo" init --bare --quiet "$test_root/remote.git"
git -C "$test_repo" remote add origin "$test_root/remote.git"
git -C "$test_repo" push --quiet origin HEAD:refs/heads/clean
clean_head="$(git -C "$test_repo" rev-parse HEAD)"

# Simulate a commit created before the local terms were configured.
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" GIT_COMMITTER_EMAIL="person@${blocked_lower}.invalid" \
  git -C "$test_repo" commit --allow-empty -m "test: imported history" --quiet
git -C "$test_repo" commit --allow-empty -m "test: clean tip" --quiet
assert_rejected git -C "$test_repo" push origin HEAD:refs/heads/clean
assert_rejected git -C "$test_repo" push origin HEAD:refs/heads/new
git -C "$test_repo" tag -a fixture-tag -m "test: tag"
assert_rejected git -C "$test_repo" push origin refs/tags/fixture-tag
git -C "$test_repo" push --quiet origin :refs/heads/clean
git -C "$test_repo" reset --hard --quiet "$clean_head"

# Previously published history is not introduced by a new branch. A stale local
# remote-tracking ref must not hide an unpublished identity from the server check.
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" git -C "$test_repo" commit --allow-empty -m "test: historical $blocked_lower" --quiet
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" git -C "$test_repo" push --quiet origin HEAD:refs/heads/published
git -C "$test_repo" commit --allow-empty -m "test: new allowed branch" --quiet
git -C "$test_repo" push --quiet origin HEAD:refs/heads/allowed-branch
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" GIT_AUTHOR_EMAIL="person@${blocked_lower}.invalid" \
  git -C "$test_repo" commit --allow-empty -m "test: unpublished author" --quiet
git -C "$test_repo" update-ref refs/remotes/origin/stale HEAD
assert_rejected git -C "$test_repo" push origin HEAD:refs/heads/stale-check
git -C "$test_repo" reset --hard --quiet "$clean_head"

git -C "$test_repo" config user.email "person@${blocked_lower}.invalid"
assert_rejected git -C "$test_repo" commit --allow-empty -m "test: configured identity"
git -C "$test_repo" config user.email "blocked-terms-test@example.invalid"

# Both direct message checks and identity checks must fail closed for invalid files.
mkdir "$test_root/not-a-file"
printf 'test: allowed\n' > "$test_root/message"
assert_rejected env ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/not-a-file" bash "$test_repo/.githooks/commit-msg" "$test_root/message"
assert_rejected env ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/not-a-file" git -C "$test_repo" commit --allow-empty -m "test: invalid terms file"

# Binary content already present in HEAD is not newly introduced by an exact rename.
printf '\000%s\000' "$blocked_lower" > "$test_repo/existing binary.bin"
printf '%s\n' "$blocked_lower" > "$test_repo/existing-text.txt"
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" git -C "$test_repo" add .
ANDROPERATOR_BLOCKED_TERMS_FILE="$test_root/missing" git -C "$test_repo" commit -m "test: preexisting assets" --quiet
git -C "$test_repo" mv "existing binary.bin" "renamed binary.bin"
git -C "$test_repo" commit -m "test: exact binary rename" --quiet

git -C "$test_repo" mv existing-text.txt renamed-text.txt
assert_rejected git -C "$test_repo" commit -m "test: text rename still scanned"
git -C "$test_repo" reset --hard --quiet HEAD

cp "$test_repo/renamed binary.bin" "$test_repo/new-binary.bin"
git -C "$test_repo" add new-binary.bin
assert_rejected git -C "$test_repo" commit -m "test: binary copy still scanned"
git -C "$test_repo" reset --hard --quiet HEAD

git -C "$test_repo" mv "renamed binary.bin" "modified binary.bin"
printf 'changed' >> "$test_repo/modified binary.bin"
git -C "$test_repo" add "modified binary.bin"
assert_rejected git -C "$test_repo" commit -m "test: modified binary rename still scanned"
git -C "$test_repo" reset --hard --quiet HEAD

# PNG signatures exempt opaque payloads for additions and subsequent changes.
printf '\211PNG\r\n\032\n\000%s\000' "$blocked_lower" > "$test_repo/image.png"
git -C "$test_repo" add image.png
git -C "$test_repo" commit -m "test: new PNG payload" --quiet
printf '%s' "$blocked_upper" >> "$test_repo/image.png"
git -C "$test_repo" add image.png
git -C "$test_repo" commit -m "test: modified PNG payload" --quiet
printf '%s\n' "$blocked_lower" > "$test_repo/text.png"
git -C "$test_repo" add text.png
assert_rejected git -C "$test_repo" commit -m "test: PNG extension alone is not exempt"
git -C "$test_repo" reset --hard --quiet HEAD

# Exclude the app catalog file family, without exempting other Kotlin files.
for path in KnownAppsRepository.kt KnownAppsRepositoryDefault.kt; do
  printf '%s\n' "$blocked_lower" > "$test_repo/$path"
done
git -C "$test_repo" add KnownAppsRepository.kt KnownAppsRepositoryDefault.kt
git -C "$test_repo" commit -m "test: app catalog exclusions" --quiet
printf '%s\n' "$blocked_lower" > "$test_repo/OtherRepository.kt"
git -C "$test_repo" add OtherRepository.kt
assert_rejected git -C "$test_repo" commit -m "test: other Kotlin files still scanned"
git -C "$test_repo" reset --hard --quiet HEAD
assert_rejected git -C "$test_repo" commit --allow-empty -m "test: $blocked_lower"

echo "blocked-terms policy tests passed"
