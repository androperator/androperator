#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
INSTALL_SCRIPT="$REPO_ROOT/sites/androperator-public/install.sh"
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

    cat > "$stale_dir/androperator" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' '0.6.0'
  exit 0
fi
exit 99
EOF
    chmod +x "$stale_dir/androperator"

    cat > "$npm_prefix/bin/androperator" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' '0.7.4'
  exit 0
fi
exit 0
EOF
    chmod +x "$npm_prefix/bin/androperator"

    HOME="$TMP_DIR/home-$label" \
    OS=Linux \
    PATH="$stale_dir:$PATH" \
    MOCK_NPM_PREFIX="$npm_prefix" \
    bash -c '
        source "$1" >/dev/null 2>&1
        trap - ERR

        npm() {
            if [ "$1" = "install" ] && [ "$2" = "-g" ] && [ "$3" = "@androperator/cli@latest" ]; then
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
          printf "bin=%s\n" "$ANDROPERATOR_BIN_PATH"
          printf "exported=%s\n" "${ANDROPERATOR_BIN_PATH:+yes}"
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
assert_contains "$CLI_RESOLUTION_OUT" "Androperator CLI installed." "cli-resolution output"
assert_contains "$CLI_RESOLUTION_VALUES" "bin=$TMP_DIR/npm-prefix-cli-resolution/bin/androperator" "cli-resolution values"
assert_contains "$CLI_RESOLUTION_VALUES" "exported=yes" "cli-resolution values"
assert_not_contains "$CLI_RESOLUTION_VALUES" "$TMP_DIR/stale-bin-cli-resolution/androperator" "cli-resolution values"

echo "=== install.sh CLI bootstrap harness passed ==="

printf '\n=== Scoped migration: remove former package before installing, and stop on uninstall failure ===\n'
for uninstall_status in 0 1; do
    prefix="$TMP_DIR/migration-$uninstall_status"
    mkdir -p "$prefix/lib/node_modules/androperator"
    printf '{"name":"androperator"}\n' > "$prefix/lib/node_modules/androperator/package.json"
    log="$prefix/npm.log"
    set +e
    MOCK_NPM_PREFIX="$prefix" MOCK_LOG="$log" MOCK_UNINSTALL_STATUS="$uninstall_status" bash -c '
        source "$1" >/dev/null 2>&1
        trap - ERR
        npm() {
            printf "%s\n" "$*" >> "$MOCK_LOG"
            case "$1" in
                config) printf "%s\n" "$MOCK_NPM_PREFIX" ;;
                uninstall) return "$MOCK_UNINSTALL_STATUS" ;;
                install) return 1 ;;
                *) return 99 ;;
            esac
        }
        install_cli
    ' _ "$INSTALL_SCRIPT" > "$prefix/output" 2>&1
    status=$?
    set -e
    assert_equals 1 "$status" "migration failure status"
    assert_contains "$log" "uninstall -g androperator" "former package removal"
    if [ "$uninstall_status" = 0 ]; then
        assert_contains "$log" "install -g @androperator/cli@latest" "scoped install after removal"
    else
        assert_not_contains "$log" "install -g @androperator/cli@latest" "blocked scoped install"
    fi
done

printf '\n=== Homebrew ownership: linked CLI, npm CLI, and upgrade failures ===\n'
for scenario in linked npm-active upgrade-failed missing-executable unavailable-formula; do
    case_dir="$TMP_DIR/homebrew-$scenario"
    mkdir -p "$case_dir/path" "$case_dir/brew/bin" "$case_dir/npm/bin"
    for owner in brew npm; do
        cat > "$case_dir/$owner/bin/androperator" <<'EOF'
#!/usr/bin/env bash
printf 'cli %s\n' "$*" >> "$MOCK_LOG"
EOF
        chmod +x "$case_dir/$owner/bin/androperator"
    done
    if [ "$scenario" = npm-active ]; then
        ln -s "$case_dir/npm/bin/androperator" "$case_dir/path/androperator"
    else
        ln -s "$case_dir/brew/bin/androperator" "$case_dir/path/androperator"
    fi
    MOCK_CASE_DIR="$case_dir" MOCK_SCENARIO="$scenario" MOCK_LOG="$case_dir/calls" \
    PATH="$case_dir/path:$PATH" bash -c '
        source "$1" >/dev/null 2>&1
        trap - ERR
        brew() {
            printf "brew %s\n" "$*" >> "$MOCK_LOG"
            case "$*" in
                "--prefix androperator/tap/cli")
                    [ "$MOCK_SCENARIO" != unavailable-formula ] || return 1
                    printf "%s/brew\n" "$MOCK_CASE_DIR" ;;
                "upgrade androperator/tap/cli")
                    [ "$MOCK_SCENARIO" != upgrade-failed ] || return 1
                    if [ "$MOCK_SCENARIO" = missing-executable ]; then
                        rm "$MOCK_CASE_DIR/brew/bin/androperator"
                    fi ;;
                *) return 99 ;;
            esac
        }
        npm() {
            printf "npm %s\n" "$*" >> "$MOCK_LOG"
            case "$*" in
                "config get prefix") printf "%s/npm\n" "$MOCK_CASE_DIR" ;;
                "install -g @androperator/cli@latest") return 0 ;;
                *) return 99 ;;
            esac
        }
        set +e
        install_cli > "$MOCK_CASE_DIR/output" 2>&1
        result=$?
        printf "%s\n" "$result" > "$MOCK_CASE_DIR/status"
        if [ "$result" = 0 ]; then
            printf "%s\n" "$ANDROPERATOR_BIN_PATH" > "$MOCK_CASE_DIR/bin"
            run_post_bootstrap_install >> "$MOCK_CASE_DIR/output" 2>&1 || exit 1
        fi
    ' _ "$INSTALL_SCRIPT"
    case "$scenario" in
        linked)
            assert_equals 0 "$(cat "$case_dir/status")" "$scenario status"
            assert_equals "$case_dir/brew/bin/androperator" "$(cat "$case_dir/bin")" "$scenario binary"
            assert_contains "$case_dir/calls" 'brew upgrade androperator/tap/cli' "$scenario upgrade"
            assert_not_contains "$case_dir/calls" 'npm ' "$scenario preserves ownership"
            assert_contains "$case_dir/calls" 'cli install --output pretty --operator-package' "$scenario delegation" ;;
        npm-active|unavailable-formula)
            assert_equals 0 "$(cat "$case_dir/status")" "$scenario status"
            assert_equals "$case_dir/npm/bin/androperator" "$(cat "$case_dir/bin")" "$scenario binary"
            assert_contains "$case_dir/calls" 'npm install -g @androperator/cli@latest' "$scenario npm install"
            assert_not_contains "$case_dir/calls" 'brew upgrade' "$scenario prevents takeover" ;;
        *)
            assert_equals 1 "$(cat "$case_dir/status")" "$scenario status"
            assert_not_contains "$case_dir/calls" 'npm ' "$scenario prevents fallback"
            assert_not_contains "$case_dir/calls" 'cli install' "$scenario stops delegation" ;;
    esac
done
