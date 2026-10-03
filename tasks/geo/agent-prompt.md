# Agent Prompt: Cloudflare Browser Rendering GEO Audit

Created: 2026-03-12

Use Cloudflare Browser Rendering REST APIs to audit the public agent-facing
accessibility of:

- `https://androperator.com`
- `https://docs.androperator.com`

This is a GEO audit, not a generic SEO audit.

## Goal

Determine whether the sites are maximally friendly to AI agents, crawlers, RAG
systems, and retrieval pipelines.

Treat the websites as intentionally public. There are no user logins or private
areas that need to be hidden from agents.

## Required approach

1. Use Cloudflare Browser Rendering APIs as the primary audit mechanism.
2. Attempt `/crawl` first for sitemap-led discovery and crawl coverage.
3. Use `/markdown` to inspect extracted content for critical pages.
4. Use `/links` to inspect whether the landing and docs entrypoints expose
   obvious high-signal crawl paths.
5. Distinguish site findings from Cloudflare API/tooling blockers such as rate
   limits or missing crawl-job lookup results.
6. Prefer concise findings and recommendations over raw payload dumps.

Important Cloudflare API quirk:

- After a successful `POST /crawl`, early `GET /crawl/<job_id>` calls may return
  `404 Crawl job not found`.
- This has been observed both on Androperator URLs and on Cloudflare's own docs
  URLs.
- Treat this as eventual consistency in the Cloudflare service.
- Poll for a reasonable window before concluding that crawl lookup is truly
  broken.

## What to evaluate

### Discoverability

- Are the important public routes discoverable through sitemap-first crawling?
- Are the machine-facing routes obvious and easy to find?
- Do the landing pages visibly route agents to the canonical docs pages?

### Fetchability

- Are important routes accessible without JS?
- Does crawling hit `skipped`, `disallowed`, `errored`, or missing statuses?
- Is Cloudflare or bot-related behavior interfering with fetches?

### Extractability

- Does `/markdown` return substantial, useful content for important pages?
- Is the extracted content clean and specific enough for an agent to summarize
  accurately?

### Canonical-source clarity

- Does the landing site clearly route agents to the docs site as the canonical
  technical source?
- Are the Node API and CLI docs easy to discover and identify as authoritative?

### JS dependency risk

- Does meaningful content appear only when rendering is enabled?
- Are the public pages still legible to low-JS or non-browser agent pipelines?

## Critical URLs

- `https://androperator.com/robots.txt`
- `https://androperator.com/llms.txt`
- `https://androperator.com/llms-full.txt`
- `https://androperator.com/index.md`
- `https://androperator.com/agents`
- `https://androperator.com/sitemap.xml`
- `https://docs.androperator.com/robots.txt`
- `https://docs.androperator.com/llms.txt`
- `https://docs.androperator.com/llms-full.txt`
- `https://docs.androperator.com/sitemap.xml`
- `https://docs.androperator.com/ai-agents/node-api-for-agents/`
- `https://docs.androperator.com/reference/cli-reference/`

## Output format

Return:

1. Executive summary
2. Findings by severity
3. Crawl coverage summary
4. Extractability summary
5. Cloudflare API/tooling blockers
6. Recommended fixes ranked by impact

## Important constraints

- Do not give generic SEO advice unless it materially improves agent
  discoverability or extractability.
- Do not confuse Cloudflare Browser Rendering API problems with website GEO
  problems.
- If Cloudflare returns rate limits or cannot return crawl job results, report
  that explicitly and continue with whatever Browser Rendering evidence is still
  available.
