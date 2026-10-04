# Androperator landing site

The homepage renders the root `README.md` during the build, omitting its License
section because the website footer already provides that information. The
README and Markdown export retain the License section. Links to public
docs resolve to the docs host; internal design links resolve to GitHub. The
Markdown homepage uses the same source with resolved links. Authored agent
guidance lives in `public/`; installer and full docs are copied from their
canonical sources. Generated `out/` files are ignored.

Build from the repository root with Node.js 24+ and Python 3:

```bash
./scripts/site_build.sh
python3 -m http.server 8000 --directory sites/landing/out
```

Mermaid fences stay native in the GitHub README. The homepage renders them with
a locally bundled Mermaid module, using vertical flows on narrow screens.
Readable diagram source remains available if JavaScript is disabled or rendering
fails. Diagram explanations and examples share the same README sections.

The build installs the renderer, runs the docs build, renders HTML and
Markdown, generates sitemaps from route-specific source commit timestamps,
and runs `validation/landing/site.test.mjs`. The docs build also installs its
Python and Node dependencies. For renderer tests after a build:

```bash
npm --prefix sites/landing test
```

Cloudflare Pages project `androperator`: root `sites/landing`, build command
`npm ci && npm run build`, output `out`, environment `NODE_VERSION=24.14.1`.
Keep public domain activation coordinated with the 1.0.0 release.

`/operator.apk`, `/install.apk`, and `/apk` use a Pages Worker assembled from
`workers/operator-apk-redirect/src/index.js`. It resolves the current APK from
`https://downloads.androperator.com/operator/latest.json`; GET/HEAD redirect
with 302, unsupported methods return 405, and unavailable metadata returns
502. No pinned APK URL or credentials are embedded. `_routes.json` limits
Worker execution to these aliases, leaving static files and redirect rules
served by Pages. The separately prepared APK Worker can use the same canonical
implementation if routed during cutover.

A plain local HTTP server previews static files only; it does not emulate
Cloudflare `_headers`, `_redirects`, or the APK Worker. Validate those on Pages
before public cutover. Release downloads cannot succeed before publication.

The preserved site is maintained and deployed from
[clawperator/clawperator.com](https://github.com/clawperator/clawperator.com).
