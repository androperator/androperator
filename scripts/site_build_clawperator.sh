#!/usr/bin/env bash

# site_build_clawperator.sh
# Build the Clawperator landing page (Next.js static export).
# Works from any directory.

set -euo pipefail

# Get absolute path of script and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LANDING_DIR="$REPO_ROOT/sites/landing-clawperator"

echo "--- Building Clawperator Landing Page ---"
echo "Repository Root: $REPO_ROOT"
echo "Landing Directory: $LANDING_DIR"

if [ ! -d "$LANDING_DIR" ]; then
    echo "Error: Landing directory not found at $LANDING_DIR"
    exit 1
fi

"$REPO_ROOT/scripts/docs_build.sh"
cp "$REPO_ROOT/sites/docs/static/llms-full.txt" "$LANDING_DIR/public/llms-full.txt"

cd "$LANDING_DIR"

echo "Generating landing sitemap metadata..."
python3 "$REPO_ROOT/.agents/skills/sitemaps-generate/scripts/generate_sitemap_metadata.py" landing --repo-root "$REPO_ROOT"

# Install dependencies if node_modules is missing.
# Prefer npm ci for deterministic installs when lockfile exists.
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
fi

# Run the build
echo "Running Next.js build..."
npm run build

# Verify build output
if [ -d "out" ] && [ -f "out/install.sh" ]; then
    echo "--- Successfully built landing page to $LANDING_DIR/out ---"
    echo "Artifacts ready for deployment."
else
    echo "Error: Build output (out/ or out/install.sh) missing."
    exit 1
fi
