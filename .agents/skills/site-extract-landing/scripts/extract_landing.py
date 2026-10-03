#!/usr/bin/env python3

import json
import os
import sys
import urllib.request
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Extract androperator.com landing page as markdown.')
    parser.add_argument('--output', help='Output file path')
    parser.add_argument('--url', default='https://androperator.com', help='URL to extract (default: https://androperator.com)')
    args = parser.parse_args()

    # Determine paths
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parents[3]
    
    output_path = args.output
    if not output_path:
        output_path = repo_root / "sites/landing-clawperator" / "export" / "landing-export-cloudflare.md"
    else:
        output_path = Path(output_path)

    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    account_id = os.environ.get('ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID')
    token = os.environ.get('ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN')

    if not account_id or not token:
        print("Error: Missing required environment variables:")
        if not account_id:
            print("- ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID")
        if not token:
            print("- ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN")
        sys.exit(1)

    api_url = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/markdown'
    payload = json.dumps({'url': args.url}).encode()
    
    req = urllib.request.Request(
        api_url, 
        data=payload, 
        method='POST', 
        headers={
            'Authorization': f'Bearer {token}', 
            'Content-Type': 'application/json'
        }
    )

    try:
        print(f"Requesting markdown for {args.url} from Cloudflare...")
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
            if body.get('success'):
                markdown = body.get('result')
                if markdown:
                    with open(output_path, 'w', encoding='utf-8') as f:
                        f.write(markdown)
                    print(f"SUCCESS: Saved {output_path}")
                else:
                    print("ERROR: No markdown in result")
                    sys.exit(1)
            else:
                print(f"ERROR: API failed: {body}")
                sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
