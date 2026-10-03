---
name: geo-verify-public-surfaces
description: Verify live Androperator machine-facing routes, headers, redirects, and bot access after deployment.
---

# GEO Verify Public Surfaces

This skill validates the live machine-facing surfaces for Androperator and
produces a concise summary that an agent can relay without asking a human to
scan raw headers.

It also probes for Cloudflare anti-agent behavior, since default bot-mitigation
settings can silently break machine-facing routes even when source files are
present.

## What this skill covers

- `https://androperator.com/robots.txt`
- `https://androperator.com/llms.txt`
- `https://androperator.com/llms-full.txt`
- `https://androperator.com/index.md`
- `https://androperator.com/agents`
- `https://androperator.com/sitemap.xml`
- alias redirects such as `/agent.md`, `/agents.md`, and `/for-agents`
- `https://docs.androperator.com/robots.txt`
- `https://docs.androperator.com/llms.txt`
- `https://docs.androperator.com/llms-full.txt`
- `https://docs.androperator.com/sitemap.xml`
- key docs entrypoints such as the Node API guide and CLI reference
- Cloudflare behavior for named bot user agents such as `GPTBot`,
  `ChatGPT-User`, `ClaudeBot`, `PerplexityBot`, and `Googlebot`
- challenge pages, mitigation headers, AI-blocking headers, and suspicious
  fallback bodies on machine-facing routes

## Workflow

1. Run the helper script:
   - production defaults:
     - `.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py`
   - custom preview hosts:
     - `.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py --landing-base-url <landing_url> --docs-base-url <docs_url> --allow-noindex`
   - branch-alias preview defaults:
     - `.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py --preview`
     - or `.agents/skills/geo-verify-public-surfaces/scripts/verify_public_surfaces.py --preview --branch-name <branch>`
2. Let the script complete even if one or more checks fail.
3. Read the final summary section and any failing checks.
4. In your user-facing response:
   - lead with whether the live GEO surface passes or fails overall
   - call out only the failing or suspicious routes
   - mention notable edge behavior such as relative redirect `Location` headers,
     `X-Robots-Tag`, `cf-mitigated`, challenge pages, or bot-specific failures
   - do not dump all headers unless the user asked for raw output

## Targeting rules

- If no flags are provided, the helper checks production:
  - `https://androperator.com`
  - `https://docs.androperator.com`
- If `--preview` is provided and no explicit base URLs are set, the helper uses
  Cloudflare branch aliases:
  - `https://<branch>.androperator.pages.dev`
  - `https://<branch>.androperator-docs.pages.dev`
- The branch defaults to the current git branch name when available.
- For preview validation, pass both preview hosts explicitly.
- For preview validation, usually also pass `--allow-noindex` because branch
  previews often carry `X-Robots-Tag: noindex` by design.
- Use preview URLs from Cloudflare check runs or PR comments when available.

## Output contract

The helper prints:

- one line per check with `PASS` or `FAIL`
- a short summary block with totals
- a JSON object at the end under `RESULT_JSON:` for machine consumption

Use the summary as the main basis for your answer. Use the JSON block if you
need to count failures or quote exact reasons.

## Notes

- This is a live-edge check, not a source-file lint.
- Cloudflare behavior is part of the result. If live behavior differs from the
  repo, report the live result.
- Do not ask the user to inspect header output manually. Summarize the result
  yourself.
