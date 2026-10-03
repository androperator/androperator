---
name: site-landing-export-to-md
description: Export a locally built landing page to Markdown, defaulting to Androperator with an explicit preserved-site option.
---

# Site Landing Export to MD

Build the new README-based site with `./scripts/site_build.sh`, then run:

```bash
python3 .agents/skills/site-landing-export-to-md/scripts/export_landing_to_md.py
```

The helper reads `sites/landing/out/index.html` and writes
`sites/landing/export/landing-export-local.md`. It extracts main content and
visible agent guidance. Inspect resolved links and setup examples. Dependencies
are in this skill's `requirements.txt` (BeautifulSoup and markdownify).

For the preserved site, build with `./scripts/site_build_clawperator.sh` and
pass `--site clawperator`; defaults then use `sites/landing-clawperator`.
Use `--input` or `--output` for explicit paths. Do not mix the two sites' exports.
