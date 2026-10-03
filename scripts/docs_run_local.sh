#!/usr/bin/env bash

# docs_run_local.sh
# Build (if needed) and run the Androperator documentation site locally on port 8000.
# Uses MkDocs dev server for live reload.

set -euo pipefail

# Get absolute path of script and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/sites/docs"
VENV_DIR="$DOCS_DIR/.venv"

echo "--- Running Androperator Documentation Site Locally ---"
echo "Repository Root: $REPO_ROOT"
echo "Docs Directory: $DOCS_DIR"

if [ ! -d "$DOCS_DIR" ]; then
    echo "Error: Docs directory not found at $DOCS_DIR"
    exit 1
fi

# Build first so local server always runs against current docs output.
"$SCRIPT_DIR/docs_build.sh"

cd "$DOCS_DIR"
source "$VENV_DIR/bin/activate"

echo "--- Starting MkDocs dev server at http://localhost:8000 ---"
echo "Press Ctrl+C to stop the server."

mkdocs serve
