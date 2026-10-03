#!/usr/bin/env bash

# site_run_local_clawperator.sh
# Build and run the Clawperator landing page locally on port 8080.
# Opens the browser automatically.

set -euo pipefail

# Get absolute path of script and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LANDING_DIR="$REPO_ROOT/sites/landing-clawperator"
OUT_DIR="$LANDING_DIR/out"

echo "--- Building latest landing site before serving ---"
"$SCRIPT_DIR/site_build_clawperator.sh"

cd "$OUT_DIR"

# Open the browser in the background after a slight delay
# Using 'open' for macOS (Darwin), 'xdg-open' for Linux
if [[ "$OSTYPE" == "darwin"* ]]; then
    (sleep 1 && open "http://localhost:8080") &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    (sleep 1 && xdg-open "http://localhost:8080") &
else
    echo "Please open http://localhost:8080 in your browser."
fi

echo "--- Starting local server at http://localhost:8080 ---"
echo "Serving from: $OUT_DIR"
echo "Press Ctrl+C to stop the server."

python3 - <<'PY'
import http.server

PORT = 8080

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

with http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Serving HTTP on :: port {PORT} (http://[::]:{PORT}/) ...")
    httpd.serve_forever()
PY
