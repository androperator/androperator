# GEO Audit Findings

Historical research migrated from the former planning area. Observations and
proposals below apply to the recorded revision/date, not a claim of current
behavior. Reconcile against current code before acting. Task plans and unresolved
work live in the project notebook; durable evidence remains here.

Created: 2026-03-12

## Summary

This task did not uncover evidence that `androperator.com` or
`docs.androperator.com` are broadly hostile to bots or agent crawlers.

The main discoveries were about:

- Cloudflare Browser Rendering API behavior
- how to interpret crawl results correctly
- how to choose the right crawl entrypoint for each host

After adjusting the helper to account for these behaviors, the Browser
Rendering GEO audit reached `PASS`.

## Confirmed strengths

- Landing and docs machine-facing routes are publicly fetchable.
- `robots.txt`, `llms.txt`, `llms-full.txt`, `index.md`, and sitemap surfaces
  are exposed and reachable.
- Browser Rendering `/markdown` successfully extracts the landing homepage,
  `index.md`, Node API docs, and CLI reference.
- Browser Rendering `/links` successfully finds the high-signal links on both
  the landing homepage and the docs homepage.
- The docs site is a strong canonical technical surface for agents.

## Gaps discovered

### 0. Sitemap best-practice gaps are concentrated on the landing host

Compared against Cloudflare's Browser Rendering guidance on February 25, 2026:

- both `robots.txt` files already reference their sitemap surfaces correctly
- the landing host correctly uses a sitemap index
- live sitemap responses already include cache validators via `ETag`

The remaining gaps are mostly about sitemap metadata quality, not discoverability
breakage.

Observed gaps at the time of review (historical):

The preserved landing site now belongs to
[clawperator/clawperator.com](https://github.com/clawperator/clawperator.com);
its former paths below describe the original audit, not current local inputs.

- `sites/landing-clawperator/public/landing-sitemap.xml` includes only `<loc>` entries
  without `<lastmod>`
- `sites/landing-clawperator/public/landing-sitemap.xml` does not include `<priority>` for
  important landing routes
- `sites/landing-clawperator/public/sitemap.xml` is a sitemap index without `<lastmod>` on
  its child sitemap entries
- the docs sitemap includes `<lastmod>` but does not include `<priority>`

Impact:

- crawlers can still discover the URLs, but they get less signal about freshness
  and relative importance than Cloudflare recommends
- landing-host incremental crawl decisions are less informed than they could be
- the docs sitemap is in better shape than the landing sitemap, but it still
  omits optional importance hints

Implemented follow-up:

- added a generator that derives landing and docs sitemap metadata from
  source-of-truth files using each file's last git commit time
- landing sitemap entries now include ISO 8601 `<lastmod>` and `<priority>`
- root sitemap index entries now include `<lastmod>`
- docs sitemap patching now adds git-derived `<lastmod>` and explicit
  `<priority>` values after MkDocs build

Current status:

- these sitemap metadata gaps are addressed in the repo
- the remaining expectation is to keep using the generator in normal build and
  release workflows rather than editing sitemap metadata by hand

Not a gap:

- live sitemap responses already serve `ETag`, which satisfies Cloudflare's
  caching-header recommendation
- the public sitemap files are tiny, so gzip and 50k/50 MB concerns do not
  apply here

### 1. Cloudflare crawl-job visibility is eventually consistent

Observed behavior:

- `POST /browser-rendering/crawl` can succeed immediately
- early `GET /browser-rendering/crawl/<job_id>` requests can return
  `404 Crawl job not found`
- the same job can become readable several seconds later

This was reproduced both on Androperator URLs and on Cloudflare's own docs URLs,
so it is a Cloudflare service behavior, not an Androperator site defect.

Impact:

- agents can misdiagnose a healthy crawl as broken if they do not poll long
  enough
- naive tooling can report false blockers

Required practice:

- treat early `404 Crawl job not found` as eventual consistency
- poll for a reasonable window before declaring failure

### 2. The root sitemap index is not the best landing-site audit entrypoint

Observed behavior:

- `https://androperator.com/sitemap.xml` is a sitemap index that advertises both
  the landing sitemap and the docs sitemap
- using the root host with `source: "sitemaps"` caused Cloudflare crawl results
  to contain noisy `skipped` and `cancelled` statuses for otherwise healthy
  landing routes
- using `https://androperator.com/landing-sitemap.xml` directly produced clean
  landing-host crawl results

Impact:

- landing-only audit runs can produce misleading failures when started from the
  mixed-host sitemap index

Required practice:

- use `https://androperator.com/landing-sitemap.xml` for landing-surface
  sitemap-led audits
- keep `https://androperator.com/sitemap.xml` as the public discovery surface

### 3. Crawl coverage and machine-artifact fetchability are different checks

Observed behavior:

- machine-facing artifacts such as `robots.txt`, `llms.txt`, and `llms-full.txt`
  are directly fetchable and healthy
- those same artifacts are not always the right things to expect in `/crawl`
  records

Impact:

- a simplistic audit can incorrectly treat “not present in crawl records” as
  “not bot friendly”

Required practice:

- use `/crawl` to evaluate page discovery and crawl flow
- use direct Browser Rendering probes and live-edge checks to evaluate
  machine-facing artifacts

### 4. Browser Rendering `/links` may return relative URLs

Observed behavior:

- the docs homepage `/links` response included relative paths such as
  `ai-agents/node-api-for-agents/`

Impact:

- tool-side evaluation can produce false missing-link warnings if it expects
  only absolute URLs

Required practice:

- normalize relative links against the page URL before evaluating expected link
  presence

### 5. Browser Rendering rate limits materially affect workflow design

Observed behavior:

- before upgrading to Workers Paid, Browser Rendering hit `429 Rate limit
  exceeded` quickly
- after the paid upgrade, `/markdown`, `/links`, and `/crawl` became usable for
  this audit workflow

Impact:

- free-plan assumptions make this style of GEO audit unreliable and noisy

Required practice:

- prefer Workers Paid for repeatable Browser Rendering-based GEO audits
- keep request pacing and timeout handling in the helper even on paid plans

## Remaining watch items

- The landing homepage markdown extraction is usable, but it contains some noisy
  formatting around inline agent-routing links. It is not a blocker, but it is
  worth monitoring if landing copy changes.
- Browser Rendering crawl records can still include host-mixed `skipped`
  entries when the crawl source intentionally spans multiple sitemap surfaces.
  This should be interpreted carefully rather than treated as an automatic
  regression.

## Practical conclusion

The websites are in good shape for bots and agents.

The main work uncovered by this task was not “fix blocked bot access,” but
instead:

- make the GEO audit tooling smarter
- encode Cloudflare-specific behavior in docs and skills
- choose crawl entrypoints that match the audit question

That knowledge is now part of the repo-local GEO workflow.
