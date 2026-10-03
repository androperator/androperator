---
name: site-landing-export-to-md
description: Export the locally built Androperator landing page to Markdown for pre-deployment inspection.
---

# Site Landing Export to MD

Generate a markdown representation of the `androperator.com` landing page from the local codebase. This skill builds the static export of the landing site and then converts the resulting HTML to markdown using Python.

## Prerequisites

-   Python 3
-   Node.js and npm (for building the landing page)
-   Python dependencies (install via `pip`):
    ```bash
    pip install beautifulsoup4 markdownify
    ```

## Workflow

1.  **Build the landing page**:
    Run the build script from the repository root to generate the static HTML:
    ```bash
    ./scripts/site_build_clawperator.sh
    ```

2.  **Export to Markdown**:
    Run the helper script to convert the local `index.html` to `sites/landing-clawperator/export/landing-export-local.md`:
    ```bash
    python3 .agents/skills/site-landing-export-to-md/scripts/export_landing_to_md.py
    ```

3.  **Specify output (optional)**:
    You can specify a custom output path:
    ```bash
    python3 .agents/skills/site-landing-export-to-md/scripts/export_landing_to_md.py --output custom-landing.md
    ```

## Notes

-   This skill is useful for validating how local changes to the landing page (`sites/landing-clawperator/app/page.js`) will be perceived by AI agents before they are deployed.
-   The conversion focuses on the `<main>` content of the page, stripping out navigation, scripts, and styles to provide a clean representation for LLMs.
-   Ensure you have run `./scripts/site_build_clawperator.sh` at least once before running the export script.
