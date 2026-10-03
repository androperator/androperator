#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

run_node_install_validation() {
    env \
        -u ANDROPERATOR_DEFAULT_ANDROID_DEVICE_ID \
        -u ANDROPERATOR_OPERATOR_PACKAGE \
        -u ANDROPERATOR_BUNDLED_SKILLS \
        -u ANDROPERATOR_BIN \
        -u ANDROPERATOR_LOG_DIR \
        "$@"
}

ensure_node_build() {
    if [ ! -f "apps/node/dist/cli/index.js" ]; then
        echo "=== Building Node package for validation harnesses ==="
        run_node_install_validation npm --prefix apps/node run build
    fi
}

if [ "${ANDROPERATOR_INSTALL_SKIP_NODE_TESTS:-0}" != "1" ]; then
    if [ ! -d "apps/node/node_modules" ]; then
        echo "ERROR: apps/node dependencies are not installed." >&2
        echo "Run: npm --prefix apps/node ci" >&2
        exit 1
    fi

    echo "=== Building Node package for install-related tests ==="
    run_node_install_validation npm --prefix apps/node run build

    echo "=== Running Node test suite for installer-facing CLI contracts ==="
    run_node_install_validation npm --prefix apps/node run test
else
    echo "=== Skipping Node build/tests (ANDROPERATOR_INSTALL_SKIP_NODE_TESTS=1) ==="
    ensure_node_build
fi

echo "=== Running install-related validation harnesses (including shared agent bridge coverage) ==="
bash validation/install/test_skill_md.sh
bash validation/install/test_operator_package_env.sh
# test_doctor.sh has a PATH-poisoned missing-adb scenario. Clear ADB_PATH so
# caller-local adb configuration cannot bypass that scenario.
env -u ADB_PATH bash validation/test_doctor.sh
bash validation/install/test_java.sh
bash validation/install/test_nvm_verification.sh
bash validation/install/test_cli_bootstrap.sh
bash validation/install/test_main_delegation.sh

echo "=== install-related test suite passed ==="
