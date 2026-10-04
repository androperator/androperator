---
name: site-extract-landing
description: Extract a live landing page through Cloudflare Browser Rendering, with Androperator export defaults.
---

# Site Extract Landing

Use after deployment to inspect the rendered site as an agent would read it.
Requires `ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID` and
`ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN` with Browser Rendering Edit.

```bash
python3 .agents/skills/site-extract-landing/scripts/extract_landing.py
```

Defaults: `https://androperator.com` and
`sites/landing/export/landing-export-cloudflare.md`. Inspect content, resolved
links, footer attribution, and visible agent guidance.

`--url` and `--output` override the defaults; use them for an authorized
preview URL. Keep credentials out of output and committed files.

This uses `/browser-rendering/markdown`, which renders the page before
extracting Markdown. It does not prove APK downloads or runtime readiness.
