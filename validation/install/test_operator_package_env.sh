#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
INSTALL_SCRIPT="$REPO_ROOT/sites/androperator-public/install.sh"

assert_equals() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [ "$expected" != "$actual" ]; then
        echo "ERROR: $label expected '$expected' but got '$actual'" >&2
        return 1
    fi
}

read_install_defaults() {
    ANDROPERATOR_OPERATOR_PACKAGE="$1" bash -c '
        set -euo pipefail
        source "$1" >/dev/null 2>&1
        printf "%s\n%s\n" "$DEFAULT_OPERATOR_PACKAGE" "$APK_FILE_BASENAME"
    ' _ "$INSTALL_SCRIPT"
}

assert_install_defaults() {
    local env_value="$1"
    local expected_package="$2"
    local expected_basename="$3"
    local output
    output="$(read_install_defaults "$env_value")"
    local resolved_package
    local resolved_basename
    resolved_package="$(printf '%s\n' "$output" | sed -n '1p')"
    resolved_basename="$(printf '%s\n' "$output" | sed -n '2p')"
    assert_equals "$expected_package" "$resolved_package" "DEFAULT_OPERATOR_PACKAGE"
    assert_equals "$expected_basename" "$resolved_basename" "APK_FILE_BASENAME"
}

assert_install_defaults "" "com.androperator.operator" "operator.apk"
assert_install_defaults "   " "com.androperator.operator" "operator.apk"
assert_install_defaults "com.androperator.operator.dev" "com.androperator.operator.dev" "operator-debug.apk"

echo "=== install.sh operator package normalization passed ==="
