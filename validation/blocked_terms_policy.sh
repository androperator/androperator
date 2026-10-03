#!/usr/bin/env bash

# Shared blocked-terms helpers used by the local Git hooks.

blocked_terms_policy_prepare() {
  if [[ -n "${ANDROPERATOR_BLOCKED_TERMS_FILE:-}" ]]; then
    BLOCKED_TERMS_POLICY_FILE="$ANDROPERATOR_BLOCKED_TERMS_FILE"
  elif [[ -n "${HOME:-}" ]]; then
    BLOCKED_TERMS_POLICY_FILE="${HOME}/.androperator/blocked-terms.txt"
    # Migration-only fallback: never silently disable an existing privacy policy.
    if [[ ! -e "$BLOCKED_TERMS_POLICY_FILE" && -e "${HOME}/.clawperator/blocked-terms.txt" ]]; then
      BLOCKED_TERMS_POLICY_FILE="${HOME}/.clawperator/blocked-terms.txt"
    fi
  else
    BLOCKED_TERMS_POLICY_FILE=""
  fi

  if [[ -z "$BLOCKED_TERMS_POLICY_FILE" || ! -e "$BLOCKED_TERMS_POLICY_FILE" ]]; then
    return 10
  fi

  if [[ ! -f "$BLOCKED_TERMS_POLICY_FILE" || ! -r "$BLOCKED_TERMS_POLICY_FILE" ]]; then
    echo "[blocked-terms] terms file is not a readable regular file: $BLOCKED_TERMS_POLICY_FILE" >&2
    return 1
  fi

  return 0
}

blocked_terms_policy_list_terms() {
  awk '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line != "" && line !~ /^#/) {
        print line
      }
    }
  ' "$BLOCKED_TERMS_POLICY_FILE"
}

blocked_terms_policy_escape_ere() {
  printf '%s' "$1" | sed -e 's/[].[^$*+?(){}|\\]/\\&/g'
}

blocked_terms_policy_file_matches_term() {
  local term="$1"
  local file_path="$2"
  local status=0

  if [[ "$term" =~ ^[[:alpha:]][[:alnum:]_-]*$ ]]; then
    local escaped_term
    escaped_term="$(blocked_terms_policy_escape_ere "$term")"
    if LC_ALL=C grep -E -i -q "(^|[^[:alnum:]_])${escaped_term}([^[:alnum:]_]|$)" "$file_path"; then
      status=0
    else
      status=$?
    fi
  elif LC_ALL=C grep -F -i -q -- "$term" "$file_path"; then
    status=0
  else
    status=$?
  fi

  if [[ $status -eq 0 ]]; then
    return 0
  fi

  if [[ $status -gt 1 ]]; then
    echo "[blocked-terms] unable to scan $file_path" >&2
    return "$status"
  fi

  return 1
}

blocked_terms_policy_scan_file() {
  local display_path="$1"
  local file_path="$2"
  local term
  local match_status=0
  local violations=0

  while IFS= read -r term; do
    if blocked_terms_policy_file_matches_term "$term" "$file_path"; then
      echo "[blocked-terms] blocked term '$term' found in $display_path" >&2
      violations=1
    else
      match_status=$?
      if [[ $match_status -ne 1 ]]; then
        violations=1
      fi
    fi
  done < <(blocked_terms_policy_list_terms)

  if [[ $violations -ne 0 ]]; then
    return 1
  fi

  return 0
}

blocked_terms_policy_scan_commit_message() {
  local message_file="$1"
  local preparation_status=0

  if blocked_terms_policy_prepare; then
    blocked_terms_policy_scan_file "the commit message" "$message_file"
    return $?
  else
    preparation_status=$?
  fi

  if [[ $preparation_status -eq 10 ]]; then
    return 0
  fi

  return "$preparation_status"
}

# With no revisions, inspect Git's effective identities, including environment
# overrides and --author. Otherwise scan raw identities and messages in history.
blocked_terms_policy_scan_identities() {
  local preparation_status=0
  local identity_file
  local status=0

  if blocked_terms_policy_prepare; then
    :
  else
    preparation_status=$?
    if [[ $preparation_status -eq 10 ]]; then
      return 0
    fi
    return "$preparation_status"
  fi

  identity_file="$(mktemp "${TMPDIR:-/tmp}/androperator-identities.XXXXXX")" || return 1
  if [[ $# -eq 0 ]]; then
    if ! git var GIT_AUTHOR_IDENT > "$identity_file" ||
       ! git var GIT_COMMITTER_IDENT >> "$identity_file"; then
      status=1
    fi
  elif ! git log --format='%an <%ae>%n%cn <%ce>%n%B' "$@" -- > "$identity_file"; then
    status=1
  fi

  if [[ $status -eq 0 ]]; then
    blocked_terms_policy_scan_file "commit identities or history" "$identity_file" || status=$?
  fi
  rm -f "$identity_file"
  return "$status"
}

blocked_terms_policy_scan_staged_content() {
  local staged_file
  local path
  local change
  local change_status
  local preparation_status=0
  local violations=0

  if blocked_terms_policy_prepare; then
    :
  else
    preparation_status=$?
    if [[ $preparation_status -eq 10 ]]; then
      return 0
    fi
    return "$preparation_status"
  fi

  staged_file="$(mktemp "${TMPDIR:-/tmp}/androperator-blocked-terms.XXXXXX")" || {
    echo "[blocked-terms] unable to create a temporary staged-content file" >&2
    return 1
  }

  while IFS= read -r -d '' change; do
    change_status="${change##* }"
    IFS= read -r -d '' path || { violations=1; break; }
    if [[ "$change_status" == R* || "$change_status" == C* ]]; then
      IFS= read -r -d '' path || { violations=1; break; }
      # Exact renames reuse the existing blob. Only exempt binary blobs; text,
      # copies, and modified renames still receive the full content scan.
      if [[ "$change_status" == R100 ]] &&
         [[ "$(git diff --cached --numstat --no-renames -- "$path")" == $'-\t-'* ]]; then
        continue
      fi
    fi
    if ! git show ":$path" > "$staged_file"; then
      echo "[blocked-terms] unable to read staged content for $path" >&2
      violations=1
      continue
    fi

    # App catalog definitions intentionally contain third-party product names.
    case "${path##*/}" in
      KnownAppsRepository*) continue ;;
    esac
    # PNG and WebP payloads are compressed bytes, not searchable prose. Verify
    # format signatures so text disguised with an image extension is scanned.
    case "$path" in
      *.png|*.PNG)
        if [[ "$(od -An -tx1 -N8 "$staged_file" | tr -d ' \n')" == "89504e470d0a1a0a" ]]; then
          continue
        fi
        ;;
      *.webp|*.WEBP)
        if [[ "$(od -An -tx1 -N4 "$staged_file" | tr -d ' \n')" == "52494646" ]] &&
           [[ "$(od -An -tx1 -j8 -N4 "$staged_file" | tr -d ' \n')" == "57454250" ]]; then
          continue
        fi
        ;;
    esac

    if ! blocked_terms_policy_scan_file "$path" "$staged_file"; then
      violations=1
    fi
  done < <(git diff --cached --raw --no-abbrev --find-renames=100% --diff-filter=ACMR -z)

  rm -f "$staged_file"

  if [[ $violations -ne 0 ]]; then
    echo "[blocked-terms] commit blocked. Remove the term or update the local terms file." >&2
    return 1
  fi

  return 0
}
