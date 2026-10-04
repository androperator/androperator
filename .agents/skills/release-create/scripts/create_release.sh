#!/usr/bin/env bash

set -euo pipefail

WORKFLOW_APPEAR_ATTEMPTS=30
WORKFLOW_COMPLETION_ATTEMPTS=360
WORKFLOW_POLL_INTERVAL_SECONDS=10
PUBLISHED_VERSION_UPDATE_ATTEMPTS=12
PUBLISHED_VERSION_UPDATE_INTERVAL_SECONDS=10

die() {
  printf 'release-create: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

request_homebrew_update() {
  # The tap validates and commits its own formula changes. Its hourly schedule
  # retries after propagation or Homebrew's dependency release-age restriction.
  if gh workflow run update.yml --repo androperator/homebrew-tap --ref main; then
    printf 'homebrew_update=requested verification=pending url=https://github.com/androperator/homebrew-tap/actions/workflows/update.yml\n'
  else
    printf 'homebrew_update=deferred reason=dispatch_failed retry=hourly_schedule\n' >&2
  fi
}

current_branch() {
  git branch --show-current
}

cleanup_worktree() {
  if [[ -n "${TEMP_WORKTREE_DIR:-}" && -d "${TEMP_WORKTREE_DIR}" ]]; then
    git worktree remove --force "$TEMP_WORKTREE_DIR" >/dev/null 2>&1 || true
  fi
}

validate_changelog_entry() {
  local version="$1"

  python3 - "$version" "$target_sha" <<'PY'
import re
import sys
import subprocess

version = sys.argv[1]
if not re.match(r"^\d+\.\d+\.\d+$", version):
    print(f"Error: version '{version}' is not in 0.0.0 format; cannot match CHANGELOG entry.", file=sys.stderr)
    sys.exit(1)

try:
    content = subprocess.check_output(["git", "show", f"{sys.argv[2]}:CHANGELOG.md"], text=True)
except subprocess.CalledProcessError:
    print("Error: CHANGELOG.md not found. Run release-notes-author before tagging.", file=sys.stderr)
    sys.exit(1)

pattern = rf'(##\s*\[{re.escape(version)}\][ \t].*?)(?=\n##\s|\Z)'
matches = re.findall(pattern, content, re.DOTALL | re.MULTILINE)
if len(matches) == 0:
    print(f"Error: No CHANGELOG entry found for {version}. Run release-notes-author before tagging.", file=sys.stderr)
    sys.exit(1)
if len(matches) > 1:
    print(f"Error: Duplicate CHANGELOG entries found for {version}. Fix CHANGELOG.md before tagging.", file=sys.stderr)
    sys.exit(1)
PY
}

json_version_field() {
  node -e 'const data = JSON.parse(process.argv[1]); const value = data.version; if (typeof value !== "string" || value.length === 0) process.exit(2); console.log(value);' "$1"
}

json_field() {
  local json="$1"
  local field="$2"
  node -e 'const data = JSON.parse(process.argv[1]); const field = process.argv[2]; const value = data[field]; if (value === undefined || value === null) process.exit(2); if (typeof value === "object") { console.log(JSON.stringify(value)); } else { console.log(String(value)); }' "$json" "$field"
}

run_published_version_update() {
  local script_path="$1"
  local version="$2"
  local attempts="$PUBLISHED_VERSION_UPDATE_ATTEMPTS"
  local sleep_seconds="$PUBLISHED_VERSION_UPDATE_INTERVAL_SECONDS"
  local output=""

  for ((i = 1; i <= attempts; i++)); do
    if output="$(python3 "$script_path" "$version" 2>&1)"; then
      printf '%s\n' "$output"
      return 0
    fi

    if printf '%s\n' "$output" | grep -qE 'release not found|npm does not report|is not the current npm release'; then
      sleep "$sleep_seconds"
      continue
    fi

    die "$output"
  done

  printf 'published_version_update=skipped reason=not_live_yet detail=%s\n' "$output"
}

await_workflow() {
  local workflow_name="$1"
  local tag_name="$2"
  local target_sha="$3"
  local repo="$4"
  local attempts="$WORKFLOW_APPEAR_ATTEMPTS"
  local completion_attempts="$WORKFLOW_COMPLETION_ATTEMPTS"
  local sleep_seconds="$WORKFLOW_POLL_INTERVAL_SECONDS"
  local run_json=""
  local run_lookup_output=""
  local status=""

  for ((i = 1; i <= attempts; i++)); do
    if run_lookup_output="$(gh run list \
      --repo "$repo" \
      --workflow "$workflow_name" \
      --branch "$tag_name" \
      --commit "$target_sha" \
      --event push \
      --limit 1 \
      --json databaseId,workflowName,headBranch,headSha,status,conclusion,url 2>&1)"; then
      run_json="$run_lookup_output"
    else
      run_json=""
    fi

    if [[ "$run_json" != "[]" && -n "$run_json" ]]; then
      break
    fi

    sleep "$sleep_seconds"
  done

  if [[ "$run_json" == "[]" || -z "$run_json" ]]; then
    if [[ -n "$run_lookup_output" && "$run_lookup_output" != "[]" ]]; then
      die "workflow $workflow_name for tag $tag_name in repo $repo was not found after polling; last gh error: $run_lookup_output"
    fi
    die "workflow $workflow_name for tag $tag_name in repo $repo not found after polling"
  fi

  local item_json
  item_json="$(node -e 'const items = JSON.parse(process.argv[1]); if (!Array.isArray(items) || items.length === 0) process.exit(2); console.log(JSON.stringify(items[0]));' "$run_json")"

  status="$(json_field "$item_json" "status" || true)"

  local poll_count=0
  while [[ "$status" != "completed" ]]; do
    poll_count=$((poll_count + 1))
    if (( poll_count > completion_attempts )); then
      die "workflow $workflow_name for tag $tag_name in repo $repo did not complete after $((completion_attempts * sleep_seconds)) seconds"
    fi
    sleep "$sleep_seconds"
    item_json="$(gh run list \
      --repo "$repo" \
      --workflow "$workflow_name" \
      --branch "$tag_name" \
      --commit "$target_sha" \
      --event push \
      --limit 1 \
      --json databaseId,workflowName,headBranch,headSha,status,conclusion,url \
      --jq '.[0]')"
    [[ -n "$item_json" && "$item_json" != "null" ]] || die "workflow lookup for $workflow_name became unavailable"
    status="$(json_field "$item_json" "status" || true)"
  done

  local final_status
  local conclusion
  local url
  final_status="$(json_field "$item_json" "status")"
  conclusion="$(json_field "$item_json" "conclusion")"
  url="$(json_field "$item_json" "url")"

  if [[ "$conclusion" != "success" ]]; then
    printf 'workflow=%s status=%s conclusion=%s url=%s\n' \
      "$workflow_name" \
      "$final_status" \
      "$conclusion" \
      "$url"
    die "workflow $workflow_name for tag $tag_name in repo $repo completed with conclusion '$conclusion' (expected 'success'); see $url"
  fi

  printf 'workflow=%s status=%s conclusion=%s url=%s\n' \
    "$workflow_name" \
    "$final_status" \
    "$conclusion" \
    "$url"
}

main() {
  require_cmd git
  require_cmd npm
  require_cmd node
  require_cmd gh
  require_cmd python3

  local bootstrap=false
  if [[ "${1:-}" == "--bootstrap-existing-npm" ]]; then
    bootstrap=true
    shift
  fi
  [[ $# -ge 1 && $# -le 2 ]] || die "usage: .agents/skills/release-create/scripts/create_release.sh [--bootstrap-existing-npm] <version> [sha]"

  local version="$1"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || die "version must look like semver"
  if [[ "$version" == "1.1.0" ]]; then
    [[ "$bootstrap" == true ]] || die "1.1.0 requires the manual npm bootstrap; use --bootstrap-existing-npm after publication"
  elif [[ "$bootstrap" == true ]]; then
    die "--bootstrap-existing-npm is only valid for 1.1.0"
  fi
  local target_ref="${2:-HEAD}"
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  cd "$repo_root"

  local tag_name="v${version}"
  local repo_slug
  repo_slug="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
  local target_sha
  target_sha="$(git rev-parse --verify "${target_ref}^{commit}")"
  local git_status
  git_status="$(git status --porcelain)"
  [[ -z "$git_status" ]] || die "working tree has uncommitted or untracked changes"

  local package_name
  package_name="$(json_field "$(git show "${target_sha}:apps/node/package.json")" name)"
  [[ "$package_name" == "@androperator/cli" ]] || die "target package must be @androperator/cli"

  local package_version
  package_version="$(json_version_field "$(git show "${target_sha}:apps/node/package.json")")"
  [[ "$package_version" == "$version" ]] || die "apps/node/package.json is $package_version, expected $version"

  local lock_version
  lock_version="$(json_version_field "$(git show "${target_sha}:apps/node/package-lock.json")")"
  [[ "$lock_version" == "$version" ]] || die "apps/node/package-lock.json is $lock_version, expected $version"

  validate_changelog_entry "$version"

  local npm_view_output
  if npm_view_output="$(npm view "@androperator/cli@${version}" version 2>&1)"; then
    [[ "$bootstrap" == true ]] || die "npm already has @androperator/cli@$version"
  elif [[ "$bootstrap" == true ]]; then
    die "bootstrap package is not available: $npm_view_output"
  elif ! printf '%s\n' "$npm_view_output" | grep -qiE 'E404|404 Not Found'; then
    die "failed to check npm for @androperator/cli@$version: $npm_view_output"
  fi

  if gh release view "$tag_name" --repo "$repo_slug" >/dev/null 2>&1; then
    die "GitHub Release $tag_name already exists"
  fi

  if git rev-parse -q --verify "refs/tags/$tag_name" >/dev/null; then
    die "local tag $tag_name already exists"
  fi

  if git ls-remote --exit-code --tags origin "refs/tags/$tag_name" >/dev/null 2>&1; then
    die "remote tag $tag_name already exists on origin"
  fi

  printf 'release_version=%s\n' "$version"
  printf 'tag=%s\n' "$tag_name"
  printf 'target_sha=%s\n' "$target_sha"
  printf 'repo=%s\n' "$repo_slug"

  TEMP_WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/release-create.XXXXXX")"
  trap cleanup_worktree EXIT
  git worktree add --detach "$TEMP_WORKTREE_DIR" "$target_sha" >/dev/null
  local validation_root="$TEMP_WORKTREE_DIR"

  npm --prefix "$validation_root/apps/node" ci
  npm --prefix "$validation_root/apps/node" run build
  npm --prefix "$validation_root/apps/node" run test

  if [[ "$bootstrap" == true ]]; then
    python3 "$validation_root/validation/npm-release/pack.py" --version "$version" --output "$validation_root/bootstrap.tgz"
    python3 "$validation_root/validation/npm-release/verify_bootstrap.py" --archive "$validation_root/bootstrap.tgz" --commit "$target_sha"
  fi

  git tag -a "$tag_name" "$target_sha" -m "Release $tag_name"
  git push origin "refs/tags/$tag_name"

  printf 'tag_push=ok\n'

  await_workflow "Publish npm Package" "$tag_name" "$target_sha" "$repo_slug"
  await_workflow "Release APK" "$tag_name" "$target_sha" "$repo_slug"

  request_homebrew_update

  local published_version_script
  published_version_script="$repo_root/.agents/skills/release-update-published-version/scripts/update_published_version.py"
  if [[ ! -f "$published_version_script" ]]; then
    die "published-version update script is missing: $published_version_script"
  fi

  local branch_name
  branch_name="$(current_branch)"
  if [[ -z "$branch_name" ]]; then
    printf 'published_version_update=skipped reason=detached_head\n'
    return 0
  fi

  run_published_version_update "$published_version_script" "$version"
  printf 'published_version_update=finished branch=%s\n' "$branch_name"
}

main "$@"
