# Generative Engine Optimization

This document defines the durable publishing rules that make Androperator easy
for LLM agents, crawlers, and retrieval systems to discover and ingest.

The goal is simple:

- a human should be able to discover Androperator from the homepage and docs
- an agent should be able to discover the same technical truth without JS
  execution, brittle scraping, or guessing hidden routes

## Why this matters

Androperator is an agent-facing product. If crawlers cannot reliably fetch the
public surface, then the product description and technical contracts are harder
for agents to learn, summarize, and recommend accurately.

This is publishing infrastructure, not marketing garnish.

## Canonical public surfaces

### Human-facing entrypoints

- `https://androperator.com/`
- `https://androperator.com/agents`
- `https://docs.androperator.com/`

### Machine-facing entrypoints

- `https://androperator.com/index.md`
- `https://androperator.com/llms.txt`
- `https://androperator.com/llms-full.txt`
- `https://docs.androperator.com/llms.txt`
- `https://androperator.com/sitemap.xml`
- `https://docs.androperator.com/sitemap.xml`

### Canonical technical source

The docs site is the canonical source for technical behavior:

- `https://docs.androperator.com/`
- `https://docs.androperator.com/api/overview/`
- `https://docs.androperator.com/design/operator-llm-playbook/`
- `https://docs.androperator.com/reference/cli-reference/`
- `https://docs.androperator.com/reference/api-overview/`

The landing site should route agents toward these pages, not duplicate them.

## Route and redirect policy

### Canonical markdown route

`/index.md` is the canonical markdown page on the landing site.

Do not introduce multiple canonical markdown entrypoints. Aliases should
redirect to `/index.md`.

Current alias intent:

- `/agent.md` -> `/index.md`
- `/agents.md` -> `/index.md`
- `/for-agents.md` -> `/index.md`

### Canonical low-noise HTML route

`/agents` is the canonical low-noise HTML routing page for humans and crawlers
that want a cleaner entrypoint than the main homepage.

Useful aliases may redirect to `/agents`, but `/agents` remains canonical.

## Content rules

Machine-facing pages and files should follow these rules:

- use absolute URLs
- keep copy factual and compact
- state clearly that Androperator is an actuator, not a planner
- state clearly that the docs site is the canonical technical source
- prefer stable route names over trendy naming

The landing page can be expressive. The machine-facing artifacts should be
deliberate and low-noise.

## Required artifacts

### `robots.txt`

Both public hosts must expose working `robots.txt` files with:

- `User-agent: *`
- explicit `Allow: /`
- sitemap references

Named AI crawler entries are acceptable when they clarify intent or reduce WAF
ambiguity.

### Sitemaps

The root host must advertise the docs host through sitemap plumbing.

Current model:

- root sitemap index on `androperator.com`
- landing sitemap for landing routes
- docs sitemap on `docs.androperator.com`

### `llms.txt`

Each host should expose a host-specific `llms.txt` file:

- landing host: routes agents into the docs surface and machine-facing landing
  routes
- docs host: routes agents directly to high-signal technical pages

### `llms-full.txt`

`llms-full.txt` is a convenience artifact for agents that want the technical
corpus in one fetch. It does not replace the docs site or normal crawl paths.

## Homepage requirements

The homepage should include:

- a visible route to `/agents`
- a visible route to `/index.md`
- early links to the Node API guide, Operator LLM playbook, CLI reference, and
  API overview
- a `<link rel="alternate" type="text/markdown">` pointing to `/index.md`

This is not because HTML comments or hidden hints are standards. It is because
some crawlers stop early and need obvious, durable paths in the initial HTML.

## Docs-site requirements

The docs site must:

- remain static and fetchable without JS execution
- expose a non-empty sitemap
- expose `llms.txt`
- keep technical contracts in authored docs and code-derived reference pages

Do not put the canonical API behavior only on the marketing site.

## GitHub as a crawl surface

Agents often land on GitHub before they land on the website.

`README.md` should therefore:

- define Androperator clearly in the first paragraph
- link to the Node API guide
- link to the Operator LLM playbook
- link to `llms.txt`
- link to `llms-full.txt`

Treat GitHub as part of GEO, not as an unrelated channel.

## Validation checklist

After changes to any of these surfaces, verify live behavior with plain fetches:

```sh
curl -I https://androperator.com/robots.txt
curl -I https://androperator.com/llms.txt
curl -I https://androperator.com/llms-full.txt
curl -I https://androperator.com/index.md
curl -I https://androperator.com/agents
curl -I https://androperator.com/sitemap.xml

curl -I https://docs.androperator.com/robots.txt
curl -I https://docs.androperator.com/llms.txt
curl -I https://docs.androperator.com/sitemap.xml
curl -I https://docs.androperator.com/api/overview/
curl -I https://docs.androperator.com/reference/cli-reference/
```

Also verify:

- no blocking `X-Robots-Tag` headers
- no accidental `noai`, `noimageai`, or `noindex` markers on intended public
  pages
- markdown routes return the intended content type

For a repeatable live pass, use the repo-local GEO verification skill:

```sh
.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py
```

The skill is preferred over a raw shell script because the agent should inspect
the findings and summarize failures instead of asking a human to scan header
output manually.

For a Cloudflare Browser Rendering-based pass, use the repo-local crawl helper:

```sh
python3 .agents/skills/geo-crawl-browser-rendering/scripts/browser_rendering_geo_audit.py
```

Required environment variables:

```sh
export ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID="<account_id>"
export ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN="<api_token>"
```

This helper uses Browser Rendering REST APIs to:

- attempt sitemap-led crawl coverage
- inspect extracted markdown for critical pages
- inspect extracted links for landing and docs entrypoints
- separate Cloudflare API blockers from site-behavior findings
- isolate landing-host sitemap crawl coverage via
  `https://androperator.com/landing-sitemap.xml`

Current implementation note:

- Browser Rendering rate limits may constrain how much of the audit can be
  completed in one run
- Browser Rendering crawl jobs may not be readable immediately after creation
- observed behavior with both Androperator URLs and Cloudflare's own docs URLs:
  - `POST /crawl` succeeds immediately
  - early `GET /crawl/<job_id>` calls can return `404 Crawl job not found`
  - the same job can become readable several seconds later
- agents should treat this as Cloudflare-side eventual consistency and poll for
  a reasonable window before declaring crawl lookup failure
- only after that polling window is exhausted should it be reported as a
  Cloudflare-side blocker rather than a site crawlability defect
- for the landing host, `source: "sitemaps"` against the root host can produce
  misleading `skipped` and `cancelled` records because the root sitemap index
  also advertises the docs host
- use `https://androperator.com/landing-sitemap.xml` when the goal is to audit
  landing-surface sitemap coverage specifically

## Cloudflare caveat

Source files are not the full truth once deployed.

If live behavior differs from repo content, investigate:

- edge redirects
- workers
- transforms
- WAF or bot controls
- stale cache behavior

Live verification matters more than local confidence.
