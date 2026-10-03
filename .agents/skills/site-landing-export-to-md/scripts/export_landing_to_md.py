#!/usr/bin/env python3

import os
import sys
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Export local landing page build to markdown.')
    parser.add_argument('--input', help='Path to index.html (default: sites/landing/out/index.html)')
    parser.add_argument('--output', help='Output MD file')
    parser.add_argument('--site', choices=['androperator', 'clawperator'], default='androperator', help='Site to inspect (default: androperator)')
    args = parser.parse_args()
    site_dir = 'sites/landing' if args.site == 'androperator' else 'sites/landing-clawperator'

    # Determine paths
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parents[3]
    
    output_path = args.output
    if not output_path:
        output_path = repo_root / site_dir / "export" / "landing-export-local.md"
    else:
        output_path = Path(output_path)

    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    html_path = args.input
    if not html_path:
        html_path = repo_root / site_dir / "out" / "index.html"
    else:
        html_path = Path(html_path)

    if not html_path.exists():
        print(f"Error: Landing page build not found at {html_path}")
        print("Please run ./scripts/site_build.sh first." if args.site == "androperator" else "Please run ./scripts/site_build_clawperator.sh first.")
        sys.exit(1)

    try:
        from bs4 import BeautifulSoup
        from markdownify import markdownify as md
    except ImportError:
        print("Error: Missing dependencies (beautifulsoup4, markdownify).")
        print(f"Please install them: pip install -r {script_dir.parent}/requirements.txt")
        sys.exit(1)

    print(f"Reading {html_path}...")
    with open(html_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f, 'html.parser')

    # Find the main content
    # Next.js usually wraps content in a main tag or a specific div
    main_content = soup.find('main')
    if not main_content:
        # Fallback to body if main not found
        main_content = soup.find('body')

    if not main_content:
        print("Error: Could not find main content in HTML.")
        sys.exit(1)

    # Basic cleanup
    # Remove script tags
    for s in main_content.select('script'):
        s.decompose()
    # Remove style tags
    for s in main_content.select('style'):
        s.decompose()

    # Convert to markdown
    # We want to keep some structure but remove complex layout divs
    content_md = md(str(main_content), heading_style="ATX")

    # Final cleanup of the markdown
    lines = content_md.splitlines()
    clean_lines = []
    for line in lines:
        # Remove lines that are just whitespace or very short noise from layout
        if line.strip() or not clean_lines or clean_lines[-1].strip():
            clean_lines.append(line)
    
    final_md = "\n".join(clean_lines).strip()

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_md)
    
    print(f"SUCCESS: Exported landing page to {output_path}")

if __name__ == "__main__":
    main()
