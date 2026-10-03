#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <device_serial> <agent> <model> [both|local-dev|published]" >&2
  exit 2
fi

DEVICE_SERIAL="$1"
AGENT="$2"
MODEL="$3"
RUNTIME_MODE="${4:-both}"

ROOT="$(git rev-parse --show-toplevel)"
DEBUG_APK="$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
LOCAL_CLI="$ROOT/apps/node/dist/cli/index.js"
DOWNLOAD_DIR="${HOME}/.androperator/evals-downloads"

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  echo "missing sha256 tool: install sha256sum or shasum" >&2
  exit 3
}

run_eval() {
  local runtime="$1"
  uv run --project "$ROOT/evals" --extra dev python "$ROOT/evals/run_eval.py" android-version \
    --agent "$AGENT" \
    --model "$MODEL" \
    --runtime "$runtime" \
    --mode public-surface \
    --device "$DEVICE_SERIAL"
}

setup_local_dev() {
  npm --prefix "$ROOT/apps/node" run build
  "$ROOT/gradlew" :app:assembleDebug
  ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev \
    node "$LOCAL_CLI" operator setup \
      --apk "$DEBUG_APK" \
      --device "$DEVICE_SERIAL"
}

setup_published() {
  local published_version apk_url sha_url apk_path sha_path
  published_version="$(androperator version --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["cliVersion"])')"
  apk_url="https://downloads.androperator.com/operator/v${published_version}/operator-v${published_version}.apk"
  sha_url="${apk_url}.sha256"
  apk_path="${DOWNLOAD_DIR}/operator-v${published_version}.apk"
  sha_path="${apk_path}.sha256"
  mkdir -p "$DOWNLOAD_DIR"
  curl --retry 3 --retry-delay 2 --retry-all-errors --retry-connrefused -fsSLo "$apk_path" "$apk_url"
  curl --retry 3 --retry-delay 2 --retry-all-errors --retry-connrefused -fsSLo "$sha_path" "$sha_url"
  expected_sha="$(awk 'NR == 1 { print $1 }' "$sha_path")"
  actual_sha="$(sha256_file "$apk_path")"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "checksum mismatch for $apk_path" >&2
    echo "expected: $expected_sha" >&2
    echo "actual:   $actual_sha" >&2
    exit 3
  fi
  ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator \
    androperator operator setup \
      --apk "$apk_path" \
      --device "$DEVICE_SERIAL"
}

case "$RUNTIME_MODE" in
  both)
    setup_local_dev
    run_eval local-dev
    setup_published
    run_eval published
    ;;
  local-dev)
    setup_local_dev
    run_eval local-dev
    ;;
  published)
    setup_published
    run_eval published
    ;;
  *)
    echo "unknown runtime mode: $RUNTIME_MODE" >&2
    exit 2
    ;;
esac
