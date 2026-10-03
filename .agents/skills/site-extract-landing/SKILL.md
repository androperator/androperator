---
name: site-extract-landing
description: Extract rendered Clawperator landing-page Markdown through Cloudflare Browser Rendering.
---

# Site Extract Landing

Extract the fully rendered markdown content of `https://clawperator.com` using Cloudflare's Browser Rendering API. This is useful for Generative Engine Optimization (GEO) audits and ensuring the site is correctly perceived by AI agents.

## Prerequisites

The following environment variables must be set:

- `CLAWPERATOR_CLOUDFLARE_ACCOUNT_ID`
- `CLAWPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN`

## Workflow

1.  **Run the extraction script**:
    -   To extract the default landing page (`https://clawperator.com`) to `sites/landing-clawperator/export/landing-export-cloudflare.md`:
        ```bash
        python3 .agents/skills/site-extract-landing/scripts/extract_landing.py
        ```
    -   To specify a different output file:
        ```bash
        python3 .agents/skills/site-extract-landing/scripts/extract_landing.py --output my-landing.md
        ```
    -   To extract a different URL (within the Cloudflare account's scope):
        ```bash
        python3 .agents/skills/site-extract-landing/scripts/extract_landing.py --url https://clawperator.com/agents --output agents.md
        ```

2.  **Verify the output**:
    -   Inspect the generated markdown file to ensure the content is complete and correctly formatted.

## Notes

-   This skill uses the Cloudflare `/browser-rendering/markdown` endpoint, which performs a full browser render (executing JavaScript) before converting the DOM to markdown.
-   Ensure the API token has the necessary permissions (`Browser Rendering - Edit`).
