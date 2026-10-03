#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <device_serial> [runs] [label]" >&2
  exit 1
fi

device_serial="$1"
runs="${2:-1}"
label="${3:-manual}"

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"

cd "${repo_root}"

uv run --project "${repo_root}/evals" --extra dev \
  python "${repo_root}/evals/run_eval.py" solax-orchestrated-cold-start \
  --device "${device_serial}" \
  --operator-package com.androperator.operator.dev \
  --runs "${runs}" \
  --label "${label}"
