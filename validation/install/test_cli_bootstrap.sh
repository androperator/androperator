#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
INSTALL_SCRIPT="$REPO_ROOT/sites/landing-clawperator/public/install.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

assert_contains() {
    local file="$1"
    local needle="$2"
    local label="$3"
    if ! grep -Fq -- "$needle" "$file"; then
        echo "ERROR: $label missing expected output: $needle" >&2
        echo "--- $file ---" >&2
        cat "$file" >&2
        echo "-------------" >&2
        return 1
    fi
}

assert_not_contains() {
    local file="$1"
    local needle="$2"
    local label="$3"
    if grep -Fq -- "$needle" "$file"; then
        echo "ERROR: $label unexpectedly contained: $needle" >&2
        echo "--- $file ---" >&2
        cat "$file" >&2
        echo "-------------" >&2
        return 1
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [ "$expected" != "$actual" ]; then
        echo "ERROR: $label expected '$expected' but got '$actual'" >&2
        return 1
    fi
}

run_install_cli_resolution_case() {
    local label="$1"
    local output_file="$2"
    local status_file="$3"
    local values_file="$4"
    local stale_dir="$TMP_DIR/stale-bin-$label"
    local npm_prefix="$TMP_DIR/npm-prefix-$label"

    mkdir -p "$stale_dir" "$npm_prefix/bin"

    cat > "$stale_dir/clawperator" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' '0.6.0'
  exit 0
fi
exit 99
EOF
    chmod +x "$stale_dir/clawperator"

    cat > "$npm_prefix/bin/clawperator" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' '0.7.4'
  exit 0
fi
exit 0
EOF
    chmod +x "$npm_prefix/bin/clawperator"

    HOME="$TMP_DIR/home-$label" \
    OS=Linux \
    PATH="$stale_dir:$PATH" \
    MOCK_NPM_PREFIX="$npm_prefix" \
    bash -c '
        source "$1" >/dev/null 2>&1
        trap - ERR

        npm() {
            if [ "$1" = "install" ] && [ "$2" = "-g" ] && [ "$3" = "clawperator@latest" ]; then
                return 0
            fi
            if [ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "prefix" ]; then
                printf "%s\n" "$MOCK_NPM_PREFIX"
                return 0
            fi
            printf "unexpected npm invocation: %s\n" "$*" >&2
            return 99
        }

        hash() {
            return 0
        }

        set +e
        install_cli > "$2"
        status="$?"
        set -e

        printf "%s\n" "$status" > "$3"
        {
          printf "bin=%s\n" "$CLAWPERATOR_BIN_PATH"
          printf "exported=%s\n" "${CLAWPERATOR_BIN_PATH:+yes}"
        } > "$4"
    ' _ "$INSTALL_SCRIPT" "$output_file" "$status_file" "$values_file"
}

echo "=== Scenario 1: install_cli prefers the freshly installed npm binary over a stale PATH entry ==="
CLI_RESOLUTION_OUT="$TMP_DIR/cli-resolution.out"
CLI_RESOLUTION_STATUS="$TMP_DIR/cli-resolution.status"
CLI_RESOLUTION_VALUES="$TMP_DIR/cli-resolution.values"
run_install_cli_resolution_case \
    cli-resolution \
    "$CLI_RESOLUTION_OUT" \
    "$CLI_RESOLUTION_STATUS" \
    "$CLI_RESOLUTION_VALUES"

assert_equals "0" "$(cat "$CLI_RESOLUTION_STATUS")" "cli-resolution status"
assert_contains "$CLI_RESOLUTION_OUT" "Clawperator CLI installed." "cli-resolution output"
assert_contains "$CLI_RESOLUTION_VALUES" "bin=$TMP_DIR/npm-prefix-cli-resolution/bin/clawperator" "cli-resolution values"
assert_contains "$CLI_RESOLUTION_VALUES" "exported=yes" "cli-resolution values"
assert_not_contains "$CLI_RESOLUTION_VALUES" "$TMP_DIR/stale-bin-cli-resolution/clawperator" "cli-resolution values"

echo "=== install.sh CLI bootstrap harness passed ==="
