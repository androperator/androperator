# Cloudflare Browser Rendering GEO Audit Design

Created: 2026-03-12

## Goal

Add a repo-local agent workflow that uses Cloudflare Browser Rendering APIs to
audit `https://androperator.com` and `https://docs.androperator.com` for
agent-ingestibility, not generic SEO vanity metrics.

The audit should answer:

- can agents discover the important routes
- can agents fetch them without JS
- can agents extract meaningful markdown from them
- do the landing and docs surfaces clearly route agents to the canonical
  technical truth

## Why a second GEO skill exists

The existing `geo-verify-public-surfaces` skill checks the live edge for
headers, root artifacts, redirects, and anti-bot behavior.

This new workflow adds Cloudflare Browser Rendering as an external crawler-like
observer so we can answer:

- what Cloudflare's own rendering and crawl products can actually discover
- what markdown those APIs extract from the public surfaces
- whether the sites are robust for non-browser and low-JS agent pipelines

## Scope

Hosts:

- `https://androperator.com`
- `https://docs.androperator.com`

Critical URLs:

- landing:
  - `/robots.txt`
  - `/llms.txt`
  - `/llms-full.txt`
  - `/index.md`
  - `/agents`
  - `/sitemap.xml`
- docs:
  - `/robots.txt`
  - `/llms.txt`
  - `/llms-full.txt`
  - `/sitemap.xml`
  - `/ai-agents/node-api-for-agents/`
  - `/reference/cli-reference/`

## API strategy

Use Cloudflare Browser Rendering REST APIs only in v1.

Primary API:

- `/crawl`

Supporting APIs:

- `/markdown`
- `/links`

Rationale:

- `/crawl` is the best fit for discovery, skip/disallow status, and sitemap or
  link-following coverage
- `/markdown` gives direct extractability checks for critical routes
- `/links` helps verify whether the landing and docs entry pages expose obvious
  crawl paths for agents

## Real-world caveat observed during implementation

With the currently configured repo credentials:

- `POST /browser-rendering/crawl` succeeds and returns a job ID
- `GET /browser-rendering/crawl/<job_id>` currently returns `404 Crawl job not
  found`

The helper should therefore:

- attempt the documented crawl lifecycle first
- retry polling for a bounded interval
- report a tooling/API issue clearly if job lookup never becomes available
- continue with point probes so the GEO audit still produces useful findings

This is an implementation reality, not a reason to abandon the Cloudflare
Browser Rendering path.

## Inputs

Environment:

- `ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID`
- `ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN`

Optional:

- `GEO_LANDING_BASE_URL`
- `GEO_DOCS_BASE_URL`

CLI flags should allow explicit override of URLs, limits, and render mode
thresholds for preview or focused checks.

## Audit phases

### 1. Crawl attempt

Run a crawl job per host with:

- `render: false`
- `formats: ["markdown"]`
- `source: "sitemaps"`
- host-specific include patterns

Goal:

- test sitemap-led discovery
- collect `completed`, `skipped`, `disallowed`, and `errored` states when
  available

### 2. Rendered comparison sample

Run a small crawl or probe sample with:

- `render: true`

Goal:

- detect cases where meaningful content only appears after JS execution

### 3. Point probes

For every critical URL:

- fetch extracted markdown through Browser Rendering
- measure whether content is non-empty and high-signal

For landing and docs homepages:

- fetch extracted links through Browser Rendering
- confirm important cross-links are visible to an agent

## Output contract

Human-facing output:

- concise `PASS` / `WARN` / `FAIL` lines for major checks
- executive summary
- findings grouped by severity
- recommended fixes

Machine-facing output:

- final JSON object under `RESULT_JSON:`
- includes run metadata, crawl status, point-probe summaries, and findings

## Finding categories

- discoverability
- fetchability
- extractability
- canonical-source clarity
- JS dependency risk
- Cloudflare API/tooling blockers

## Severity guidance

High:

- critical machine-facing routes not discoverable
- core docs pages not extractable
- meaningful content only available with JS when it should be static

Medium:

- weak landing-to-docs routing for agents
- markdown extraction is thin, noisy, or ambiguous
- crawl coverage is partial

Low:

- missing helpful link surfaces
- alias or route affordance gaps

Tooling blocker:

- Cloudflare crawl result lookup fails after successful job creation

This should be reported clearly but separated from site-behavior findings so we
do not confuse a Cloudflare API issue with an Androperator GEO issue.
