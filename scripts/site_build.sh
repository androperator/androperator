#!/usr/bin/env bash
# Build the README-based Androperator site and its generated documentation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" != --dependencies-installed ]]; then
  npm --prefix sites/landing ci
fi
./scripts/docs_build.sh
node sites/landing/build.mjs
npm --prefix sites/landing test
