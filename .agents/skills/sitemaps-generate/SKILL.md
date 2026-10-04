---
name: sitemaps-generate
description: Regenerate Androperator sitemap metadata from source-file commit timestamps.
---

# Sitemaps Generate

Use this skill when sitemap metadata needs to be regenerated from source-of-truth
files rather than edited by hand.

This skill is for repo maintenance. It is not a live GEO audit.

## What this skill covers

- new landing sitemap generation during `./scripts/site_build.sh`
- sitemap index `<lastmod>` values based on child sitemap source changes
- docs sitemap `<lastmod>` and `<priority>` patching after MkDocs build
- git-based timestamps using each source file's own last commit time
- pre-commit freshness for locally modified source files

## Workflow

For Androperator, run `./scripts/site_build.sh`. Its generated
`out/landing-sitemap.xml` uses route-specific source commit timestamps;
`out/sitemap.xml` indexes it and the docs sitemap. Do not commit these outputs.

For docs, run `./scripts/docs_build.sh`, then validate the resulting sitemap
XML. Commit source and tracked generated changes together when appropriate.

## Notes

- Do not use the most recent repo commit as a blanket timestamp.
- Each sitemap entry should use the last git commit time of the file or files
  that actually define that URL.
- If a source file has local uncommitted changes, treat it as changed now and
  use the current UTC time for that file's sitemap freshness signal.
- For docs pages, use the source files listed in `sites/docs/source-map.yaml`,
  not the generated files under `sites/docs/site/`.
