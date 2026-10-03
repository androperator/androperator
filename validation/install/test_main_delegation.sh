#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
INSTALL_SCRIPT="$REPO_ROOT/sites/androperator-public/install.sh"
SYSTEM_PATH_BASE="$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin:/sbin"
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

assert_exit_code() {
    local actual="$1"
    local expected="$2"
    local label="$3"
    if [ "$actual" -ne "$expected" ]; then
        echo "ERROR: $label expected exit code $expected, got $actual" >&2
        return 1
    fi
}

setup_mock_androperator() {
    local mock_dir="$1"
    local scenario="$2"
    local log_file="$3"

    mkdir -p "$mock_dir"
    cat > "$mock_dir/androperator" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "$log_file"

case "$scenario:\$*" in
  success:install\ --output\ pretty\ --operator-package\ com.androperator.operator)
    cat <<'OUT'
Androperator install: OK
Install complete.
OUT
    exit 0
    ;;
  warn:install\ --output\ pretty\ --operator-package\ com.androperator.operator.dev)
    cat <<'OUT'
Androperator install: WARN
Install completed with warnings: multiple connected devices are ready; future commands must use --device.
Follow-up:
- Verify one device explicitly with: androperator doctor --device <device_id> --output pretty --operator-package com.androperator.operator.dev
OUT
    exit 0
    ;;
  fail:install\ --output\ pretty\ --operator-package\ com.androperator.operator)
    cat <<'OUT'
Androperator install: FAILED
Host install completed, but some connected devices still need remediation.
Follow-up:
- Rerun remediation after resolving device issues: androperator operator remediate --operator-package com.androperator.operator
OUT
    exit 1
    ;;
esac

printf '%s\n' "unexpected mock androperator invocation: \$*" >&2
exit 99
EOF
    chmod +x "$mock_dir/androperator"
}

run_main_case() {
    local label="$1"
    local scenario="$2"
    local expected_exit="$3"
    local stdout_file="$4"
    local stderr_file="$5"
    local trace_file="$6"
    local cli_log_file="$7"
    local operator_package="${8:-}"
    local failing_check="${9:-}"
    local install_cli_status="${10:-0}"
    local keep_err_trap="${11:-0}"
    local mock_dir="$TMP_DIR/mock-$label"

    setup_mock_androperator "$mock_dir" "$scenario" "$cli_log_file"
    : > "$cli_log_file"
    : > "$trace_file"

    if [ -n "$operator_package" ]; then
        export ANDROPERATOR_OPERATOR_PACKAGE="$operator_package"
    else
        unset ANDROPERATOR_OPERATOR_PACKAGE
    fi

    HOME="$TMP_DIR/home-$label" \
    OS=Linux \
    SHELL=/bin/bash \
    PATH="$mock_dir:$SYSTEM_PATH_BASE" \
    bash -c '
        source "$1" >/dev/null 2>&1
        if [ "$8" != "1" ]; then
            trap - ERR
        fi

        trace() {
            printf "%s\n" "$1" >> "$2"
        }

        maybe_fail() {
            local name="$1"
            trace "$name" "$TRACE_FILE"
            if [ "${FAIL_CHECK:-}" = "$name" ]; then
                printf "%s\n" "$name failed" >&2
                return 1
            fi
            return 0
        }

        validate_os() { maybe_fail validate_os; }
        check_java() { maybe_fail check_java; }
        check_node() { maybe_fail check_node; }
        check_curl() { maybe_fail check_curl; }
        check_adb() { maybe_fail check_adb; }
        check_git() { maybe_fail check_git; }
        install_cli() {
            trace install_cli "$TRACE_FILE"
            export ANDROPERATOR_BIN_PATH="$MOCK_ANDROPERATOR_BIN"
            return "$INSTALL_CLI_STATUS"
        }
        show_star_hint() { trace show_star_hint "$TRACE_FILE"; return 0; }

        export TRACE_FILE="$2"
        export MOCK_ANDROPERATOR_BIN="$3"
        export FAIL_CHECK="${4:-}"
        export INSTALL_CLI_STATUS="$5"

        set +e
        ( main ) > "$6" 2> "$7"
        status="$?"
        set -e

        printf "%s\n" "$status"
    ' _ "$INSTALL_SCRIPT" "$trace_file" "$mock_dir/androperator" "$failing_check" "$install_cli_status" "$stdout_file" "$stderr_file" "$keep_err_trap" > "$TMP_DIR/$label.status"

    local actual_exit
    actual_exit="$(cat "$TMP_DIR/$label.status")"
    assert_exit_code "$actual_exit" "$expected_exit" "$label"
}

run_stdin_entrypoint_case() {
    local stdout_file="$1"
    local stderr_file="$2"
    local status_file="$3"

    set +e
    cat "$INSTALL_SCRIPT" | OS=Plan9 bash >"$stdout_file" 2>"$stderr_file"
    local actual_exit=$?
    set -e

    printf '%s\n' "$actual_exit" > "$status_file"
}

echo "=== Scenario 1: main delegates successful post-bootstrap flow to androperator install ==="
SUCCESS_STDOUT="$TMP_DIR/main-success.stdout"
SUCCESS_STDERR="$TMP_DIR/main-success.stderr"
SUCCESS_TRACE="$TMP_DIR/main-success.trace"
SUCCESS_CLI_LOG="$TMP_DIR/main-success.cli.log"
run_main_case \
    main-success \
    success \
    0 \
    "$SUCCESS_STDOUT" \
    "$SUCCESS_STDERR" \
    "$SUCCESS_TRACE" \
    "$SUCCESS_CLI_LOG"

assert_contains "$SUCCESS_STDOUT" "Androperator install: OK" "main-success stdout"
assert_contains "$SUCCESS_STDOUT" "Install complete." "main-success stdout"
assert_contains "$SUCCESS_STDOUT" "Activate Androperator in your current terminal:" "main-success stdout"
assert_contains "$SUCCESS_STDOUT" "source ~/.bash_profile" "main-success stdout"
assert_contains "$SUCCESS_STDOUT" "Docs: " "main-success stdout"
assert_contains "$SUCCESS_TRACE" "validate_os" "main-success trace"
assert_contains "$SUCCESS_TRACE" "check_git" "main-success trace"
assert_contains "$SUCCESS_TRACE" "install_cli" "main-success trace"
assert_contains "$SUCCESS_TRACE" "show_star_hint" "main-success trace"
assert_contains "$SUCCESS_CLI_LOG" "install --output pretty --operator-package com.androperator.operator" "main-success cli log"
assert_equals "" "$(cat "$SUCCESS_STDERR")" "main-success stderr"

echo "=== Scenario 2: warning output still passes through and keeps activation guidance ==="
WARN_STDOUT="$TMP_DIR/main-warn.stdout"
WARN_STDERR="$TMP_DIR/main-warn.stderr"
WARN_TRACE="$TMP_DIR/main-warn.trace"
WARN_CLI_LOG="$TMP_DIR/main-warn.cli.log"
run_main_case \
    main-warn \
    warn \
    0 \
    "$WARN_STDOUT" \
    "$WARN_STDERR" \
    "$WARN_TRACE" \
    "$WARN_CLI_LOG" \
    "com.androperator.operator.dev"

assert_contains "$WARN_STDOUT" "Androperator install: WARN" "main-warn stdout"
assert_contains "$WARN_STDOUT" "Verify one device explicitly with: androperator doctor --device <device_id> --output pretty --operator-package com.androperator.operator.dev" "main-warn stdout"
assert_contains "$WARN_STDOUT" "Activate Androperator in your current terminal:" "main-warn stdout"
assert_contains "$WARN_CLI_LOG" "install --output pretty --operator-package com.androperator.operator.dev" "main-warn cli log"
assert_equals "" "$(cat "$WARN_STDERR")" "main-warn stderr"

echo "=== Scenario 3: failed delegated install propagates exit code and top-level messaging ==="
FAIL_STDOUT="$TMP_DIR/main-fail.stdout"
FAIL_STDERR="$TMP_DIR/main-fail.stderr"
FAIL_TRACE="$TMP_DIR/main-fail.trace"
FAIL_CLI_LOG="$TMP_DIR/main-fail.cli.log"
run_main_case \
    main-fail \
    fail \
    1 \
    "$FAIL_STDOUT" \
    "$FAIL_STDERR" \
    "$FAIL_TRACE" \
    "$FAIL_CLI_LOG" \
    "" \
    "" \
    0 \
    1

assert_contains "$FAIL_STDOUT" "Androperator install: FAILED" "main-fail stdout"
assert_contains "$FAIL_STDOUT" "Rerun remediation after resolving device issues: androperator operator remediate --operator-package com.androperator.operator" "main-fail stdout"
assert_not_contains "$FAIL_STDOUT" "Activate Androperator in your current terminal:" "main-fail stdout"
assert_not_contains "$FAIL_STDOUT" "Installation failed" "main-fail stdout"
assert_not_contains "$FAIL_STDOUT" "https://androperator.com/install.sh" "main-fail stdout"
assert_contains "$FAIL_CLI_LOG" "install --output pretty --operator-package com.androperator.operator" "main-fail cli log"
assert_equals "" "$(cat "$FAIL_STDERR")" "main-fail stderr"

echo "=== Scenario 4: bootstrap failures stop before install_cli delegation ==="
GATE_STDOUT="$TMP_DIR/main-gate.stdout"
GATE_STDERR="$TMP_DIR/main-gate.stderr"
GATE_TRACE="$TMP_DIR/main-gate.trace"
GATE_CLI_LOG="$TMP_DIR/main-gate.cli.log"
run_main_case \
    main-gate \
    success \
    1 \
    "$GATE_STDOUT" \
    "$GATE_STDERR" \
    "$GATE_TRACE" \
    "$GATE_CLI_LOG" \
    "" \
    "check_git"

assert_contains "$GATE_STDERR" "check_git failed" "main-gate stderr"
assert_not_contains "$GATE_TRACE" "install_cli" "main-gate trace"
assert_equals "" "$(cat "$GATE_CLI_LOG")" "main-gate cli log"

echo "=== Scenario 5: stdin entrypoint runs without BASH_SOURCE errors ==="
STDIN_STDOUT="$TMP_DIR/stdin.stdout"
STDIN_STDERR="$TMP_DIR/stdin.stderr"
STDIN_STATUS="$TMP_DIR/stdin.status"
run_stdin_entrypoint_case \
    "$STDIN_STDOUT" \
    "$STDIN_STDERR" \
    "$STDIN_STATUS"

assert_exit_code "$(cat "$STDIN_STATUS")" 1 "stdin-entrypoint"
assert_contains "$STDIN_STDOUT" "Unsupported OS: Plan9" "stdin-entrypoint stdout"
assert_not_contains "$STDIN_STDERR" "BASH_SOURCE[0]: unbound variable" "stdin-entrypoint stderr"

echo "=== install.sh main delegation harness passed ==="
