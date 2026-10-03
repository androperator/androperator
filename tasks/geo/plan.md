# Task: Cloudflare Browser Rendering GEO Audit

Created: 2026-03-12

## Goal

Add a repo-local workflow that lets an agent use Cloudflare Browser Rendering
to audit `https://androperator.com` and `https://docs.androperator.com` for SEO
and Generative Engine Optimization (GEO) readiness.

The output should answer the real product question:

- can agents discover the important public surfaces
- can agents fetch them without JS or anti-bot breakage
- can agents extract useful technical truth from them
- can we identify concrete fixes when the sites are not maximally
  agent-friendly

This work should complement the existing live-edge verification skill. It
should not replace it.

---

## Constraints and principles

- Treat Androperator as intentionally public and maximally crawlable.
- Prefer deterministic, inspectable REST calls over opaque automation first.
- Start with Cloudflare Browser Rendering REST `/crawl`.
- Keep secrets out of the repo and out of committed task logs.
- Produce concise summaries for humans and structured output for agents.
- Commit logically as progress is made. Do not wait until the end to create one
  large commit.

---

## Step 0: User setup and credential validation

This step is for the human operator before implementation starts.

### What you need to configure

You need a Cloudflare API token with Browser Rendering access for the account
that owns the Browser Rendering feature you want to use.

Create or confirm:

- a Cloudflare account ID
- a custom API token with `Browser Rendering - Edit`

Use local environment variables, not committed files:

```sh
export ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID="<account_id>"
export ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN="<api_token>"
```

Optional local convenience variables:

```sh
export GEO_LANDING_BASE_URL="https://androperator.com"
export GEO_DOCS_BASE_URL="https://docs.androperator.com"
```

### What must not be committed

- API tokens
- copied curl commands containing bearer tokens
- shell history dumps with secrets
- `.env` files unless they are explicitly ignored and already part of the repo
  convention

### How to test that the API token works

First test a minimal crawl creation request:

```sh
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl" \
  -H "Authorization: Bearer ${ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://androperator.com",
    "limit": 1,
    "depth": 1,
    "formats": ["markdown"],
    "render": false
  }'
```

Expected result:

- HTTP success response
- JSON body with `"success": true`
- a crawl job ID in `result`

Then poll the created job:

```sh
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID}/browser-rendering/crawl/<job_id>?limit=1" \
  -H "Authorization: Bearer ${ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN}"
```

Expected result:

- `result.status` eventually becomes `completed`
- at least one record appears or the status clearly explains why nothing was
  crawled

### If the token test fails

Check these in order:

- the token has `Browser Rendering - Edit`
- the account ID matches the token's Cloudflare account
- Browser Rendering is enabled for that account
- the token is being sent exactly as a Bearer token

### Definition of done for Step 0

Before implementation begins, the user should be able to prove:

- a crawl job can be created
- a crawl job can be fetched
- results can be read from the API without using the dashboard

No code changes should start until this is true.

Commit guidance:

- no repo commit is expected for Step 0 unless documentation or ignored local
  setup guidance is added intentionally

---

## Phase 1: Design the audit contract

Define the minimal product contract for the new GEO audit skill or helper.

Deliverables:

- a task-focused design note under `tasks/geo/` describing:
  - audit goals
  - scope of URLs and host coverage
  - required inputs from environment variables
  - output contract for humans and for machine consumers
  - pass/fail and severity criteria
- decision to use REST `/crawl` first, with no Playwright dependency in v1

Required audit dimensions:

- discoverability
- fetchability
- extractability
- canonical-source clarity
- anti-bot interference
- JS dependency risk

Output shape should include:

- executive summary
- findings by severity
- crawl run metadata
- coverage summary
- missing or skipped critical URLs
- recommended fixes
- machine-readable JSON result block

Commit guidance:

- create a narrow commit after this phase
- commit should contain only the design and plan artifacts for the GEO crawl
  workflow

---

## Phase 2: Build a low-level Cloudflare crawl helper

Implement a small repo-local helper that talks to the Browser Rendering REST
API.

Suggested location:

- `.agents/skills/geo-crawl-browser-rendering/scripts/`

Suggested helper behavior:

- read `ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID`
- read `ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN`
- create crawl jobs
- poll for completion
- paginate through results when a cursor is returned
- emit concise terminal output plus a final JSON object

Minimum supported crawl modes:

- landing host static audit:
  - `render: false`
  - `formats: ["markdown"]`
  - `source: "sitemaps"`
- docs host static audit:
  - `render: false`
  - `formats: ["markdown"]`
  - `source: "sitemaps"`
- comparison sample:
  - `render: true`
  - limited page count
  - used only to detect JS-only deltas

Minimum safety and ergonomics:

- fail clearly when env vars are missing
- redact token values from output
- support configurable host URLs
- support `limit`, `depth`, include/exclude patterns, and `render`
- keep polling lightweight with `?limit=1` during status checks

Commit guidance:

- commit once the helper can successfully create, poll, and fetch a crawl job
- do not bundle scoring logic or docs changes into this commit

---

## Phase 3: Add GEO scoring and analysis rules

Teach the helper or wrapper to interpret raw crawl data into GEO findings.

Required logic:

- identify critical URLs for each host
- verify whether they were discovered and completed
- surface `skipped`, `disallowed`, `errored`, and missing records distinctly
- compare static crawl coverage vs rendered crawl coverage
- flag content that appears to require JS when it should not
- flag weak extracted markdown for critical entrypoints

Critical URLs should include at minimum:

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

Severity examples:

- high:
  - core machine-facing routes not discovered
  - core technical docs disallowed, skipped, or errored
  - crawl only works with JS rendering where static should suffice
- medium:
  - sitemap coverage incomplete
  - extracted markdown is thin or noisy on critical pages
  - docs are reachable but not clearly positioned as canonical
- low:
  - redirect alias inconsistencies
  - missing helpful cross-links for agents

Commit guidance:

- create a separate commit for scoring and findings logic
- this commit should make the tool useful even before the full skill wrapper is
  added

---

## Phase 4: Wrap the helper as a repo skill

Add a new repo-local skill for agents to run this audit consistently.

Suggested name:

- `geo-crawl-browser-rendering`

Skill responsibilities:

- explain when to use it
- explain required env vars
- define default production targets
- describe optional preview-host usage
- instruct the agent to summarize findings, not dump raw API payloads
- tell the agent to highlight failures and suspicious edge behavior first

The skill should prefer:

- a static crawl pass first
- a rendered comparison pass second
- concise report output for humans
- JSON result output for follow-on automation

Commit guidance:

- commit the skill wrapper and usage docs separately from the raw helper if
  possible
- if the wrapper depends tightly on the helper, it is acceptable to include both
  in one narrowly scoped commit

---

## Phase 5: Document the operator workflow

Document how a maintainer or agent should run the new GEO crawl audit.

Likely doc surfaces:

- `docs/design/generative-engine-optimization.md`
- optional task docs under `tasks/geo/`

Document:

- required environment variables
- how to verify credentials
- how to run the skill or helper against production
- how to run it against preview hosts
- how to interpret common findings
- when to run it:
  - after crawl-surface changes
  - before release if public web surfaces changed
  - after Cloudflare config changes

Commit guidance:

- commit documentation updates in their own commit unless they are inseparable
  from code changes

---

## Phase 6: Validate end to end

Run the full workflow against the live sites.

At minimum, validate:

- existing `geo-verify-public-surfaces` still passes
- new Browser Rendering audit can create and complete crawl jobs
- production targets produce a readable report
- static crawl mode surfaces the important pages
- rendered comparison mode does not reveal unexpected JS-only dependencies

If preview support is implemented, also validate:

- branch preview hosts
- expected `noindex` behavior where relevant

Commit guidance:

- if validation requires fixes, commit those fixes logically by area
- do not hide validation-driven fixes inside unrelated commits

---

## Phase 7: Draft the reusable agent prompt

Once the skill and helper are working, add a reusable prompt template for an
agent to perform a GEO audit and return actionable recommendations.

The prompt should instruct the agent to:

- use Cloudflare Browser Rendering crawl APIs
- audit both hosts
- compare static and rendered accessibility
- identify agent-ingestibility risks
- recommend fixes ranked by impact
- avoid generic SEO boilerplate
- focus on discoverability, extraction quality, technical clarity, and
  anti-bot issues

Suggested artifact:

- `tasks/geo/agent-prompt.md`

Commit guidance:

- commit the prompt template separately after the implementation is proven

---

## Commit discipline for the implementing agent

The implementing agent must commit logically as progress is made.

Rules:

- do not accumulate all phases into one large commit
- create a local commit whenever a phase reaches a coherent stopping point
- keep commits narrow and reviewable
- use Conventional Commits
- do not push unless the active workflow or user explicitly asks for it

Suggested commit sequence:

1. `docs(geo): add browser rendering audit implementation plan`
2. `feat(geo): add cloudflare browser rendering crawl helper`
3. `feat(geo): score crawl results for agent-ingestibility findings`
4. `feat(geo): add browser rendering geo audit skill`
5. `docs(geo): document browser rendering audit workflow`
6. `docs(geo): add reusable agent geo audit prompt`

These are examples, not mandatory exact messages.

---

## Out of scope for v1

- Playwright or Puppeteer bindings
- dashboard-only workflows
- automatic remediation
- CI integration before the local workflow is proven
- broad traditional SEO ranking analysis unrelated to agent accessibility

---

## Definition of done

This task is done when all of the following are true:

- a user can configure Cloudflare credentials locally and verify them
- a repo-local helper can create, poll, and read Browser Rendering crawl jobs
- an agent can run a repeatable GEO audit against both public hosts
- the audit produces actionable findings, not just raw crawl data
- the workflow is documented
- the implementing agent has committed work in logical phases
