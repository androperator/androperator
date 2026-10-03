#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

SKILL_MD="sites/landing-clawperator/public/skill.md"
AGENTS_MD="sites/landing-clawperator/public/agents.md"
REDIRECTS="sites/landing-clawperator/public/_redirects"
LLMS_TXT="sites/landing-clawperator/public/llms.txt"
LANDING_SITEMAP="sites/landing-clawperator/public/landing-sitemap.xml"

assert_file_exists() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "ERROR: expected file to exist: $file" >&2
        return 1
    fi
}

assert_contains() {
    local file="$1"
    local needle="$2"
    if ! grep -Fq -- "$needle" "$file"; then
        echo "ERROR: $file missing expected text: $needle" >&2
        return 1
    fi
}

assert_not_contains() {
    local file="$1"
    local needle="$2"
    if grep -Fq -- "$needle" "$file"; then
        echo "ERROR: $file unexpectedly contained: $needle" >&2
        return 1
    fi
}

assert_no_em_dash() {
    local file="$1"
    if LC_ALL=C grep -n $'\u2014' "$file" >/dev/null; then
        echo "ERROR: $file contains an em dash" >&2
        LC_ALL=C grep -n $'\u2014' "$file" >&2
        return 1
    fi
}

assert_file_exists "$SKILL_MD"
assert_file_exists "$AGENTS_MD"

assert_contains "$SKILL_MD" "name: clawperator-setup"
assert_contains "$SKILL_MD" "description: Install, repair, verify, and orient Clawperator"
assert_contains "$SKILL_MD" "Read https://clawperator.com/skill.md and get me set up with Clawperator."
assert_contains "$SKILL_MD" "package: clawperator"
assert_contains "$SKILL_MD" "Node.js 24+"
assert_contains "$SKILL_MD" "Java 17 or 21"
assert_contains "$SKILL_MD" "curl -fsSL https://clawperator.com/install.sh | bash"
assert_contains "$SKILL_MD" "npm install -g clawperator@latest"
assert_contains "$SKILL_MD" "clawperator install"
assert_contains "$SKILL_MD" "clawperator doctor"
assert_contains "$SKILL_MD" "clawperator devices"
assert_contains "$SKILL_MD" "clawperator snapshot --device <device_serial>"
assert_contains "$SKILL_MD" "~/.clawperator/AGENTS.md"
assert_contains "$SKILL_MD" "~/.clawperator/install-state.json"
assert_contains "$SKILL_MD" "~/.clawperator/mcp-config-snippet.json"
assert_contains "$SKILL_MD" "clawperator mcp serve"

assert_not_contains "$SKILL_MD" "@clawperator/node"
assert_not_contains "$SKILL_MD" "Node.js 18"
assert_not_contains "$SKILL_MD" ".dev"
assert_not_contains "$SKILL_MD" ".codex-plugin"
assert_not_contains "$SKILL_MD" ".claude-plugin"
assert_not_contains "$SKILL_MD" "raw.githubusercontent.com"
assert_not_contains "$SKILL_MD" "/.well-known/skills"

assert_contains "$AGENTS_MD" "Read https://clawperator.com/skill.md and get me set up with Clawperator."
assert_contains "$AGENTS_MD" "curl -fsSL https://clawperator.com/install.sh | bash"
assert_contains "$AGENTS_MD" "https://clawperator.com/skill.md"
assert_contains "$AGENTS_MD" "https://clawperator.com/install.sh"
assert_contains "$AGENTS_MD" "https://docs.clawperator.com/"
assert_contains "$AGENTS_MD" "https://clawperator.com/llms.txt"
assert_contains "$AGENTS_MD" "https://clawperator.com/llms-full.txt"

assert_not_contains "$REDIRECTS" "/agents.md /index.md"
assert_not_contains "$REDIRECTS" "/agent.md /index.md"
assert_not_contains "$REDIRECTS" "/for-agents.md /index.md"
assert_contains "$REDIRECTS" "/agent.md /agents.md 308"
assert_contains "$REDIRECTS" "/for-agents.md /agents.md 308"

assert_contains "$LLMS_TXT" "https://clawperator.com/skill.md"
assert_contains "$LLMS_TXT" "https://clawperator.com/agents.md"
assert_contains "$LANDING_SITEMAP" "https://clawperator.com/skill.md"
assert_contains "$LANDING_SITEMAP" "https://clawperator.com/agents.md"

assert_no_em_dash "$SKILL_MD"
assert_no_em_dash "$AGENTS_MD"

echo "=== public skill.md contract validation passed ==="
