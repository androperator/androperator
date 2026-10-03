# Site Hosting

This note captures the current hosting setup for the public Androperator sites.

## Docs site build requirement

The docs site cannot be built in Cloudflare Pages with plain `mkdocs build`.

The Pages project for `docs.androperator.com` must use the repo build script:

```sh
../../scripts/docs_build.sh
```

Why:

- `mkdocs build` alone does not publish the required root text assets
- the build script also generates `llms-full.txt`
- the build script also copies `sites/docs/static/` into `sites/docs/site/`
- the build script now validates expected docs routes and machine-facing files
  before declaring the build successful

Without that script, the deployed docs site will miss root files such as:

- `robots.txt`
- `llms.txt`
- `llms-full.txt`

The build script also acts as the local reachability guardrail for the docs
repair work done in this branch:

- it checks the built site contains every page declared in
  `sites/docs/source-map.yaml`
- it checks key docs-home links still resolve to built pages
- it checks docs-host URLs listed in `sites/docs/static/llms.txt` map to real
  build artifacts

## Current Cloudflare split

The current Cloudflare setup is split across two roles/accounts:

- DNS account
  - owns the live `androperator.com` zone and active DNS
  - controls zone-level features such as AI Crawl Control
- Pages account
  - currently owns the Cloudflare Pages projects for:
    - `androperator`
    - `androperator-docs`

This is messy and should be treated as operational debt.

Practical consequence:

- Pages deployment fixes for `docs.androperator.com` must currently be made in
  the Pages account
- zone-level overrides such as managed `robots.txt` behavior must currently be
  managed in the DNS account

## Recommendation

Keep the current setup stable until the sites are healthy, then plan a
deliberate migration so DNS and Pages live in the same Cloudflare account.
