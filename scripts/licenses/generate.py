#!/usr/bin/env python3
"""Render an offline APK license inventory from reviewed runtime coordinates."""
import argparse
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def render(coordinates, metadata, texts_dir, source_notices=""):
    coordinates = sorted(set(coordinates))
    unknown = set(coordinates) - metadata['modules'].keys()
    if unknown:
        raise ValueError('Review license metadata for: ' + ', '.join(sorted(unknown)))
    escape = html.escape
    rows = []
    texts = set()
    for coordinate in coordinates:
        entry = metadata['modules'][coordinate]
        links = []
        for filename in entry['texts']:
            if Path(filename).name != filename:
                raise ValueError('License text must be a local filename')
            if not (texts_dir / filename).read_text().strip():
                raise ValueError('Empty license text: ' + filename)
            texts.add(filename)
            title = metadata['texts'][filename]['name']
            links.append(f'<a href="#{escape(filename)}">{escape(title)}</a>')
        rows.append(f'<li><h2>{escape(entry["name"])}</h2><p>{escape(coordinate)}</p>{" · ".join(links)}</li>')
    licenses = []
    for filename in sorted(texts):
        title = metadata['texts'][filename]['name']
        licenses.append(f'<section id="{escape(filename)}"><h2>{escape(title)}</h2><pre>{escape((texts_dir / filename).read_text())}</pre></section>')
    return '''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Open source licenses</title><style>
body {font:16px/1.5 sans-serif; color:#19251c; background:#f7f9f4; margin:0; padding:24px; overflow-wrap:anywhere;}
h1 {font-size:24px;} h2 {font-size:17px; margin:0;} p {margin:8px 0;}
ul {list-style:none; padding:0;} li {padding:16px 0; border-bottom:1px solid #d5ddd2;}
a {color:#285c32; display:inline-block; padding:8px 0;} pre {white-space:pre-wrap; font:14px/1.5 monospace;}
section {padding-top:24px;} </style></head><body>
<p>Androperator is built with the projects below. Their license text and notices are bundled for offline reading.</p>
<p>Google Play Services is proprietary and is listed under Android SDK terms.</p>
''' + f'<p>{len(coordinates)} dependency entries.</p><ul>' + '\n'.join(rows) + '</ul>' + '''
<h1>Artwork</h1><p>The GitHub Invertocat is a trademark of GitHub, Inc., used to link to this project on GitHub. <a href="https://github.com/logos">GitHub logo usage terms (online)</a>.</p>
<h1>License text and notices</h1>
''' + '\n'.join(licenses) + '<h1>Source code notices</h1><pre>' + escape(source_notices) + '</pre></body></html>\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dependencies', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    args = parser.parse_args()
    metadata = json.loads((ROOT / 'metadata.json').read_text())
    notices = []
    for source in sorted(args.source_root.rglob('src/main/**/*.kt')):
        for comment in re.findall(r'/\*.*?\*/', source.read_text(), re.DOTALL):
            if 'copyright' in comment.lower() and 'license' in comment.lower():
                notices.append(str(source.relative_to(args.source_root)) + '\n' + comment)
    content = render(args.dependencies.read_text().splitlines(), metadata, ROOT / 'texts', '\n\n'.join(notices))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding='utf-8')


if __name__ == '__main__':
    main()
