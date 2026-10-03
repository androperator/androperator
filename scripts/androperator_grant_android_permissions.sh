#!/usr/bin/env bash

set -euo pipefail

DEFAULT_DEBUG_PKG="com.androperator.operator.dev"
DEFAULT_RELEASE_PKG="com.androperator.operator"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_DIR="$REPO_ROOT/apps/node"
NODE_CLI_DIST="$NODE_DIR/dist/cli/index.js"

print_usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Grant Androperator Operator permissions via the repo-local Node CLI.

Options:
  -p, --package PACKAGE    Specify package name
  -d, --debug              Use debug package name ($DEFAULT_DEBUG_PKG)
  -r, --release            Use release package name ($DEFAULT_RELEASE_PKG)
  -s, --serial SERIAL      Target specific device by serial number
  -l, --list-devices       List connected devices
  -h, --help               Show this help message

Examples:
  $0
  $0 -d
  $0 -p com.custom.pkg
  $0 -s <device_serial>
EOF
}

require_cmd() {
    local cmd=$1
    local install_hint=$2
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Error: required command not found: $cmd"
        echo "$install_hint"
        exit 1
    fi
}

require_node_major() {
    local minimum_major=$1
    local version
    local major

    version="$(node -p "process.versions.node" 2>/dev/null || true)"
    if [ -z "$version" ]; then
        echo "Error: unable to determine the installed Node.js version"
        echo "Install Node.js ${minimum_major}+ to build and run the local CLI."
        exit 1
    fi

    major="${version%%.*}"
    if [ -z "$major" ] || ! [[ "$major" =~ ^[0-9]+$ ]]; then
        echo "Error: unable to parse the installed Node.js version: $version"
        echo "Install Node.js ${minimum_major}+ to build and run the local CLI."
        exit 1
    fi

    if [ "$major" -lt "$minimum_major" ]; then
        echo "Error: Node.js $version is too old"
        echo "Install Node.js ${minimum_major}+ to build and run the local CLI."
        exit 1
    fi
}

ensure_node_cli_built() {
    if [ ! -d "$NODE_DIR" ]; then
        echo "Error: apps/node not found at $NODE_DIR"
        exit 1
    fi

    if [ ! -f "$NODE_DIR/package.json" ] || [ ! -f "$NODE_DIR/package-lock.json" ]; then
        echo "Error: apps/node is missing required package metadata"
        exit 1
    fi

    if [ ! -d "$NODE_DIR/node_modules" ]; then
        echo "Error: apps/node dependencies are not installed"
        echo "Run: npm --prefix \"$NODE_DIR\" ci"
        exit 1
    fi

    npm --prefix "$NODE_DIR" run build >/dev/null

    if [ ! -f "$NODE_CLI_DIST" ]; then
        echo "Error: expected built CLI at $NODE_CLI_DIST"
        exit 1
    fi
}

PACKAGE=""
DEVICE_SERIAL=""
USE_DEBUG=false
USE_RELEASE=false
LIST_DEVICES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--package)
            PACKAGE="${2:-}"
            if [ -z "$PACKAGE" ]; then
                echo "Error: --package requires a value"
                exit 1
            fi
            shift 2
            ;;
        -d|--debug)
            USE_DEBUG=true
            shift
            ;;
        -r|--release)
            USE_RELEASE=true
            shift
            ;;
        -s|--serial)
            DEVICE_SERIAL="${2:-}"
            if [ -z "$DEVICE_SERIAL" ]; then
                echo "Error: --serial requires a value"
                exit 1
            fi
            shift 2
            ;;
        -l|--list-devices)
            LIST_DEVICES=true
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo "Error: unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

if [ "$USE_DEBUG" = true ] && [ "$USE_RELEASE" = true ]; then
    echo "Error: --debug and --release are mutually exclusive"
    exit 1
fi

if [ -n "$PACKAGE" ] && { [ "$USE_DEBUG" = true ] || [ "$USE_RELEASE" = true ]; }; then
    echo "Error: --package cannot be combined with --debug or --release"
    exit 1
fi

require_cmd node "Install Node.js 24+ to build and run the local CLI."
require_cmd npm "Install npm so the repo-local apps/node CLI can be built."
require_node_major 24

ensure_node_cli_built

CLI_ARGS=()
if [ "$LIST_DEVICES" = true ]; then
    CLI_ARGS+=("devices" "--output" "pretty")
else
    CLI_ARGS+=("grant-device-permissions" "--output" "pretty")
fi

if [ -n "$DEVICE_SERIAL" ]; then
    CLI_ARGS+=("--device" "$DEVICE_SERIAL")
fi

if [ -n "$PACKAGE" ]; then
    CLI_ARGS+=("--operator-package" "$PACKAGE")
elif [ "$USE_DEBUG" = true ]; then
    CLI_ARGS+=("--operator-package" "$DEFAULT_DEBUG_PKG")
elif [ "$USE_RELEASE" = true ]; then
    CLI_ARGS+=("--operator-package" "$DEFAULT_RELEASE_PKG")
fi

exec node "$NODE_CLI_DIST" "${CLI_ARGS[@]}"
