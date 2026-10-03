#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Get the absolute path of the script's directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_APP_DIR="$REPO_ROOT/apps/node"

echo "--- Publishing Androperator Node API ---"
echo "Repository Root: $REPO_ROOT"
echo "Node App Directory: $NODE_APP_DIR"

# Ensure we're in the node app directory.
cd "$NODE_APP_DIR"

# Verify dependencies are installed.
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Run the build.
echo "Building package..."
npm run build

# Extract the version from package.json for logging.
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"

# Publish with the alpha tag and public access.
echo "Publishing to npm..."
npm publish --access public --tag alpha

echo "--- Successfully published $VERSION to npm ---"
