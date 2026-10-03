---
name: geo-crawl-browser-rendering
description: Audit Androperator site crawl coverage and rendered extraction through Cloudflare Browser Rendering.
---

# GEO Crawl Browser Rendering

Use this skill when an agent needs a Cloudflare Browser Rendering-based GEO
audit of the Androperator public web surfaces.

This skill complements `geo-verify-public-surfaces`. It does not replace the
live-edge header and route verification pass.

## What this skill covers

- Browser Rendering `/crawl` job creation and polling
- Browser Rendering `/markdown` extraction for critical public URLs
- Browser Rendering `/links` extraction for landing and docs entry pages
- comparison of static-friendly versus rendered extraction
- findings focused on agent-ingestibility, not generic SEO boilerplate
- landing-host crawl isolation using `https://androperator.com/landing-sitemap.xml`
  to avoid mixed-host sitemap-index noise

## Required environment

- `ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID`
- `ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN`

Optional overrides:

- `GEO_LANDING_BASE_URL`
- `GEO_DOCS_BASE_URL`

## Default targets

- landing: `https://androperator.com`
- docs: `https://docs.androperator.com`

## Workflow

1. Run the helper:
   - `python3 .agents/skills/geo-crawl-browser-rendering/scripts/browser_rendering_geo_audit.py`
   - optional rendered comparison:
     - `python3 .agents/skills/geo-crawl-browser-rendering/scripts/browser_rendering_geo_audit.py --include-rendered-comparison`
2. Let it attempt static crawl coverage first.
3. Let it run point probes even if crawl result lookup fails.
4. Read the summary and findings.
5. In the user-facing response:
   - lead with the overall GEO posture
   - call out only meaningful risks and tooling blockers
   - distinguish site findings from Cloudflare API anomalies
   - summarize recommended fixes, not raw payloads

## Notes

- This skill is intentionally opinionated toward static, obvious, agent-friendly
  publishing.
- Browser Rendering rate limits can end a run early. Treat that as a tooling
  blocker, not automatically as a site-quality failure.
- Cloudflare crawl jobs may not be readable immediately after creation.
  Observed behavior in this repo:
  - `POST /crawl` succeeds immediately
  - early `GET /crawl/<job_id>` calls can return `404 Crawl job not found`
  - the same job can become readable several seconds later
- Treat early `404 Crawl job not found` responses as eventual consistency, not
  immediate proof of a bad URL or bad site behavior.
- Only treat crawl lookup as a tooling blocker after a reasonable polling
  window is exhausted.
- For the landing host, use `https://androperator.com/landing-sitemap.xml` as
  the crawl entrypoint instead of the root host when testing sitemap-led
  landing coverage. The root host sitemap index also advertises the docs host,
  which causes noisy `skipped` and `cancelled` records in Cloudflare crawl
  results even though the landing pages themselves are fetchable.
- Prefer concise summaries over dumping large extracted markdown blobs.
