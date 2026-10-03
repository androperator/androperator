---
name: sitemaps-generate
description: Regenerate Clawperator sitemap metadata from source-file commit timestamps.
---

# Sitemaps Generate

Use this skill when sitemap metadata needs to be regenerated from source-of-truth
files rather than edited by hand.

This skill is for repo maintenance. It is not a live GEO audit.

## What this skill covers

- landing sitemap generation from a deterministic manifest
- sitemap index `<lastmod>` values based on child sitemap source changes
- docs sitemap `<lastmod>` and `<priority>` patching after MkDocs build
- git-based timestamps using each source file's own last commit time
- pre-commit freshness for locally modified source files

## Workflow

1. Regenerate landing sitemap source files:
   - `python3 .agents/skills/sitemaps-generate/scripts/generate_sitemap_metadata.py landing --repo-root .`
2. Build the landing site if needed:
   - `./scripts/site_build_clawperator.sh`
3. Build the docs site:
   - `./scripts/docs_build.sh`
4. Validate the resulting sitemap XML and live GEO expectations.
5. Commit source and generated changes together when appropriate.

## Notes

- Do not use the most recent repo commit as a blanket timestamp.
- Each sitemap entry should use the last git commit time of the file or files
  that actually define that URL.
- If a source file has local uncommitted changes, treat it as changed now and
  use the current UTC time for that file's sitemap freshness signal.
- For docs pages, use the source files listed in `sites/docs/source-map.yaml`,
  not the generated files under `sites/docs/site/`.
