#!/usr/bin/env bash

# docs_build.sh
# Build the Androperator documentation site (MkDocs).
# Works from any directory.

set -euo pipefail

# Get absolute path of script and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/sites/docs"
VENV_DIR="$DOCS_DIR/.venv"
REQUIREMENTS_FILE="$DOCS_DIR/requirements.txt"

echo "--- Building Androperator Documentation Site ---"
echo "Repository Root: $REPO_ROOT"
echo "Docs Directory: $DOCS_DIR"

if [ ! -d "$DOCS_DIR" ]; then
    echo "Error: Docs directory not found at $DOCS_DIR"
    exit 1
fi

cd "$DOCS_DIR"

# Install dependencies if not already installed
if [ ! -d "$VENV_DIR" ]; then
    echo "Setting up Python virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo "Error: requirements file not found at $REQUIREMENTS_FILE"
    exit 1
fi

echo "Installing MkDocs dependencies..."
pip install -r "$REQUIREMENTS_FILE"

echo "Building Node package for docs generation..."
npm --prefix "$REPO_ROOT/apps/node" ci
npm --prefix "$REPO_ROOT/apps/node" run build

echo "Assembling docs staging directory..."
"$VENV_DIR/bin/python" "$REPO_ROOT/.agents/skills/docs-build/scripts/assemble.py"

# Run the build
echo "Running MkDocs build..."
mkdocs build

echo "Generating llms-full.txt..."
"$VENV_DIR/bin/python" "$REPO_ROOT/.agents/skills/docs-build/scripts/generate_llms_full.py"

STATIC_DIR="$DOCS_DIR/static"
if [ -d "$STATIC_DIR" ]; then
    echo "Copying static root files..."
    cp -R "$STATIC_DIR"/. "$DOCS_DIR/site/"
fi

echo "Validating docs routes and machine-facing files..."
"$VENV_DIR/bin/python" "$REPO_ROOT/scripts/validate_docs_routes.py" \
  --site-dir "$DOCS_DIR/site" \
  --generated-docs-dir "$DOCS_DIR/.build" \
  --llms-txt "$DOCS_DIR/static/llms.txt" \
  --mkdocs-yml "$DOCS_DIR/mkdocs.yml"

echo "Running warning-only docs organization checks..."
"$VENV_DIR/bin/python" "$REPO_ROOT/.agents/skills/docs-build/scripts/validate_docs_organization.py"

# Verify build output
if [ -d "site" ] && [ -f "site/index.html" ]; then
    echo "--- Successfully built documentation site to $DOCS_DIR/site ---"
    echo "Artifacts ready for deployment."
else
    echo "Error: Build output (site/ or site/index.html) missing."
    exit 1
fi
