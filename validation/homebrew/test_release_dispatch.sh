#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Load the actual helper functions without invoking the tag-publishing entrypoint.
helper_file="$(mktemp)"
trap 'rm -f "$helper_file"' EXIT
sed '$d' .agents/skills/release-create/scripts/create_release.sh > "$helper_file"
source "$helper_file"

for dispatch_status in 0 1; do
    gh() {
        [[ "$*" == 'workflow run update.yml --repo androperator/homebrew-tap --ref main' ]] || exit 99
        return "$dispatch_status"
    }
    output="$(request_homebrew_update 2>&1)"
    if [[ "$dispatch_status" == 0 ]]; then
        [[ "$output" == *'homebrew_update=requested verification=pending'* ]]
    else
        [[ "$output" == *'homebrew_update=deferred reason=dispatch_failed retry=hourly_schedule'* ]]
    fi
done
echo 'Homebrew release dispatch checks passed.'
