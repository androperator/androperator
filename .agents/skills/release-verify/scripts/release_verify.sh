#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'release-verify: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

json_field() {
  local json="$1"
  local field="$2"
  node -e 'const data = JSON.parse(process.argv[1]); const field = process.argv[2]; const value = data[field]; if (value === undefined || value === null) process.exit(2); if (typeof value === "object") { console.log(JSON.stringify(value)); } else { console.log(String(value)); }' "$json" "$field"
}

json_time_for_version() {
  local json="$1"
  local version="$2"
  node -e 'const data = JSON.parse(process.argv[1]); const version = process.argv[2]; const value = data.time?.[version]; if (value === undefined || value === null) process.exit(2); console.log(String(value));' "$json" "$version"
}

main() {
  require_cmd git
  require_cmd gh
  require_cmd curl
  require_cmd node
  require_cmd npm

  [[ $# -eq 1 ]] || die "usage: .agents/skills/release-verify/scripts/release_verify.sh <version>"

  local version="$1"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || die "version must look like semver"
  local tag_name="v${version}"
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  cd "$repo_root"

  local repo_slug
  repo_slug="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

  local remote_tag_sha
  remote_tag_sha="$(git ls-remote --tags origin "refs/tags/${tag_name}^{}" | awk '{print $1}')"
  if [[ -z "$remote_tag_sha" ]]; then
    remote_tag_sha="$(git ls-remote --tags origin "refs/tags/${tag_name}" | awk '{print $1}')"
  fi
  [[ -n "$remote_tag_sha" ]] || die "remote tag ${tag_name} not found on origin"
  printf 'tag=%s sha=%s\n' "$tag_name" "$remote_tag_sha"

  local publish_run_json
  publish_run_json="$(gh run list \
    --repo "$repo_slug" \
    --workflow "Publish npm Package" \
    --branch "$tag_name" \
    --commit "$remote_tag_sha" \
    --event push \
    --limit 1 \
    --json conclusion,status,url)"
  [[ "$publish_run_json" != "[]" ]] || die "Publish npm Package workflow run not found for ${tag_name}"
  local publish_run
  publish_run="$(node -e 'const items = JSON.parse(process.argv[1]); console.log(JSON.stringify(items[0]));' "$publish_run_json")"
  [[ "$(json_field "$publish_run" "status")" == "completed" ]] || die "Publish npm Package workflow not completed"
  [[ "$(json_field "$publish_run" "conclusion")" == "success" ]] || die "Publish npm Package workflow did not succeed"
  printf 'workflow=Publish npm Package conclusion=success url=%s\n' "$(json_field "$publish_run" "url")"

  local apk_run_json
  apk_run_json="$(gh run list \
    --repo "$repo_slug" \
    --workflow "Release APK" \
    --branch "$tag_name" \
    --commit "$remote_tag_sha" \
    --event push \
    --limit 1 \
    --json conclusion,status,url)"
  [[ "$apk_run_json" != "[]" ]] || die "Release APK workflow run not found for ${tag_name}"
  local apk_run
  apk_run="$(node -e 'const items = JSON.parse(process.argv[1]); console.log(JSON.stringify(items[0]));' "$apk_run_json")"
  [[ "$(json_field "$apk_run" "status")" == "completed" ]] || die "Release APK workflow not completed"
  [[ "$(json_field "$apk_run" "conclusion")" == "success" ]] || die "Release APK workflow did not succeed"
  printf 'workflow=Release APK conclusion=success url=%s\n' "$(json_field "$apk_run" "url")"

  local release_json
  release_json="$(gh api "repos/${repo_slug}/releases/tags/${tag_name}")" || die "GitHub Release ${tag_name} not found"
  local release_url
  release_url="$(json_field "$release_json" "html_url")"
  local release_assets
  release_assets="$(node -e 'const data = JSON.parse(process.argv[1]); const names = Array.isArray(data.assets) ? data.assets.map(asset => asset.name) : []; if (names.length === 0) process.exit(2); console.log(names.join(","));' "$release_json")" || die "GitHub Release has no assets yet"
  [[ ",$release_assets," == *",operator-${tag_name}.apk,"* ]] || die "GitHub Release is missing operator-${tag_name}.apk"
  [[ ",$release_assets," == *",operator-${tag_name}.apk.sha256,"* ]] || die "GitHub Release is missing operator-${tag_name}.apk.sha256"
  printf 'github_release=%s assets=%s\n' "$release_url" "$release_assets"

  local npm_json
  npm_json="$(npm view "androperator@${version}" version time --json)" || die "npm package androperator@${version} not found"
  [[ "$(json_field "$npm_json" "version")" == "$version" ]] || die "npm returned unexpected version for androperator@${version}"
  printf 'npm_version=%s published_at=%s\n' \
    "$(json_field "$npm_json" "version")" \
    "$(json_time_for_version "$npm_json" "$version")"

  local latest_json
  latest_json="$(curl -fsSL https://downloads.androperator.com/operator/latest.json)" || die "failed to fetch latest.json"
  [[ "$(json_field "$latest_json" "version")" == "$version" ]] || die "latest.json version does not match ${version}"
  local latest_apk_url latest_sha_url latest_sha
  latest_apk_url="$(json_field "$latest_json" "apk_url")"
  latest_sha_url="$(json_field "$latest_json" "sha256_url")"
  latest_sha="$(json_field "$latest_json" "sha256")"
  printf 'latest_json_version=%s apk_url=%s sha256=%s\n' "$version" "$latest_apk_url" "$latest_sha"

  local expected_apk_url expected_sha_url
  expected_apk_url="https://downloads.androperator.com/operator/${tag_name}/operator-${tag_name}.apk"
  expected_sha_url="${expected_apk_url}.sha256"
  [[ "$latest_apk_url" == "$expected_apk_url" ]] || die "latest.json apk_url does not match ${expected_apk_url}"
  [[ "$latest_sha_url" == "$expected_sha_url" ]] || die "latest.json sha256_url does not match ${expected_sha_url}"

  local apk_headers
  apk_headers="$(curl -fsSI "$expected_apk_url")" || die "immutable APK URL is not reachable"
  printf 'apk_url_status=ok content_length=%s\n' "$(printf '%s\n' "$apk_headers" | awk 'BEGIN{IGNORECASE=1}/^content-length:/{print $2}' | tr -d '\r')"

  local sha_text
  sha_text="$(curl -fsSL "$expected_sha_url" | tr -d '\r\n')" || die "immutable checksum URL is not reachable"
  [[ "$sha_text" == "$latest_sha" ]] || die "checksum file does not match latest.json"
  printf 'checksum_match=ok value=%s\n' "$sha_text"

  local redirect_headers redirect_location
  redirect_headers="$(curl -fsSI https://androperator.com/operator.apk)" || die "stable redirect is not reachable"
  redirect_location="$(printf '%s\n' "$redirect_headers" | awk 'BEGIN{IGNORECASE=1}/^location:/{print $2}' | tr -d '\r')"
  [[ "$redirect_location" == "$expected_apk_url" ]] || die "stable redirect points to ${redirect_location}, expected ${expected_apk_url}"
  printf 'stable_redirect=%s\n' "$redirect_location"
}

main "$@"
