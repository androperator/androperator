import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { renderMarkdown, publicUrl, publicMarkdown } from '../../sites/landing/render.mjs';
import worker from '../../sites/landing/out/_worker.js';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('README URLs retain queries and anchors on their public destinations', () => {
  assert.equal(publicUrl('docs/setup.md?view=plain#permissions'), 'https://docs.androperator.com/setup/?view=plain#permissions');
  assert.equal(publicUrl('docs/index.md'), 'https://docs.androperator.com/');
  assert.equal(publicUrl('docs/api/index.md'), 'https://docs.androperator.com/api/');
  assert.equal(publicUrl('docs/internal/design/operator-llm-playbook.md'), 'https://github.com/androperator/androperator/blob/main/docs/internal/design/operator-llm-playbook.md');
  assert.equal(publicUrl('assets/androperator-logo.png'), '/logo.png');
  assert.equal(publicUrl('assets/qa-verification.png'), '/qa-verification.png');
  assert.equal(publicUrl('#get-started'), '#get-started');
  assert.equal(publicUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(publicUrl('LICENSE'), 'https://github.com/androperator/androperator/blob/main/LICENSE');
});

test('HTML and Markdown resolve links and inline logo without altering fenced examples', () => {
  const source = '[Setup](docs/setup.md)\n<img src="assets/androperator-logo.png">\n```bash\n[example](docs/setup.md)\n```';
  const html = renderMarkdown(source);
  assert.match(html, /href="https:\/\/docs.androperator.com\/setup\/"/);
  assert.match(html, /src="\/logo.png"/);
  assert.match(renderMarkdown('## Get started\n## Get started'), /id="get-started"/);
  assert.match(renderMarkdown('## Get started\n## Get started'), /id="get-started-1"/);
  assert.match(html, /\[example\]\(docs\/setup.md\)/);
  assert.match(publicMarkdown(source), /\[Setup\]\(https:\/\/docs.androperator.com\/setup\/\)/);
  assert.match(publicMarkdown(source), /```bash\n\[example\]\(docs\/setup.md\)\n```/);
});

test('Mermaid diagrams retain accessible titles, escaped fallback, and native Markdown', () => {
  const source = '```mermaid\nflowchart LR\n    accTitle: Observe and verify\n    A[Agent] --> B[Android]\n```';
  const html = renderMarkdown(source);
  assert.match(html, /class="diagram" data-index="0"/);
  assert.match(html, /<figcaption>Observe and verify<\/figcaption>/);
  assert.match(html, /--&gt;/);
  assert.equal(publicMarkdown(source), source);
  assert.match(renderMarkdown('```mermaid\n<script>alert(1)</script>\n```'), /&lt;script&gt;/);
});

test('homepage can omit License without removing later sections or the README license', () => {
  const source = '# Project\n## License\nApache 2.0\n### Details\nTerms\n## More\nKept';
  const html = renderMarkdown(source, { omitSections: ['License'] });
  assert.doesNotMatch(html, /Apache|Terms|id="license"/);
  assert.match(html, /id="more"/);
  assert.match(renderMarkdown(source), /Apache 2.0/);
});

test('built homepage renders current README, useful footer, and visible agent guidance', async () => {
  const html = await read('sites/landing/out/index.html');
  assert.ok(html.includes(renderMarkdown(await read('README.md'), { omitSections: ['License'] })));
  for (const text of ['Written by clankers / engineered by', 'Action Launcher Pty Ltd', 'mailto:chris@actionlauncher.com', 'Release notes', 'commandId', 'taskId', '/skill.md', '/agents.md', '/llms-full.txt']) assert.ok(html.includes(text), text);
  assert.match(html, /<main[^>]*><article>/);
  assert.doesNotMatch(html, /id="license"/);
  assert.match(await read('sites/landing/out/index.md'), /## License/);
  assert.match(html, /<aside[^>]*aria-labelledby="agent-heading"/);
  assert.match(html, /<script type="module" src="\/scripts\/diagrams.js"><\/script>/);
  assert.equal((html.match(/class="diagram"/g) ?? []).length, 2);
  await access(new URL('sites/landing/out/scripts/diagrams.js', root));
  await access(new URL('sites/landing/out/scripts/navigation.js', root));
  assert.match(html, /data-section="why" href="\/#why">Why/);
  assert.match(html, /data-section="quick-start" href="\/#quick-start">Install/);
  assert.equal(await read('sites/landing/out/index.md'), publicMarkdown(await read('README.md')));
});

test('agent and download artifacts use current canonical sources', async () => {
  assert.equal(await read('sites/landing/out/install.sh'), await read('sites/androperator-public/install.sh'));
  assert.equal(await read('sites/landing/out/llms-full.txt'), await read('sites/androperator-public/llms-full.txt'));
  assert.equal(await read('sites/landing/out/llms.txt'), await read('sites/docs/static/llms.txt'));
  for (const file of ['agents.md', 'skill.md', 'robots.txt', '_headers', '_redirects', '404.html']) assert.ok((await read(`sites/landing/out/${file}`)).length > 0);
  const agents = await read('sites/landing/out/agents/index.html');
  assert.match(agents, /rel="canonical" href="https:\/\/androperator.com\/agents\/"/);
  assert.match(agents, /androperator doctor --device/);
  assert.match(await read('sites/landing/out/landing-sitemap.xml'), /https:\/\/androperator.com\/skill.md/);
});

test('homepage and agent HTML links resolve to built routes or repository files', async () => {
  for (const page of ['index.html', 'agents/index.html']) {
    const html = await read(`sites/landing/out/${page}`);
    for (const [, attribute, value] of html.matchAll(/\b(href|src)="([^"]+)"/g)) {
      const url = new URL(value, 'https://androperator.com/');
      if (url.hostname === 'docs.androperator.com') {
        const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
        await access(new URL(`sites/docs/site${path}`, root));
      } else if (url.hostname === 'androperator.com') {
        const path = url.pathname === '/' ? '/index.html' : url.pathname === '/agents' ? '/agents/index.html' : url.pathname;
        await access(new URL(`sites/landing/out${path}`, root));
      } else if (url.href.startsWith('https://github.com/androperator/androperator/blob/main/')) {
        await access(new URL(url.pathname.split('/blob/main/')[1], root));
      }
      if (attribute === 'href' && value.startsWith('#')) assert.ok(html.includes(`id="${url.hash.slice(1)}"`), value);
    }
  }
});

test('built Pages Worker delegates static files without fetching APK metadata', async () => {
  let called = false;
  const response = await worker.fetch(new Request('https://preview.pages.dev/skill.md'), { ASSETS: { fetch(request) { called = true; assert.equal(new URL(request.url).pathname, '/skill.md'); return new Response('setup'); } } });
  assert.equal(await response.text(), 'setup');
  assert.ok(called);
  assert.deepEqual(JSON.parse(await read('sites/landing/out/_routes.json')).include, ['/operator.apk', '/install.apk', '/apk']);
});

test('APK aliases resolve metadata for GET/HEAD and reject invalid metadata and methods', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'https://downloads.androperator.com/operator/latest.json');
      return Response.json({ apk_url: 'https://downloads.androperator.com/operator/v1.0.0/operator-v1.0.0.apk' });
    };
    for (const path of ['/operator.apk', '/install.apk', '/apk']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await worker.fetch(new Request(`https://preview.pages.dev${path}`, { method }), {});
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), 'https://downloads.androperator.com/operator/v1.0.0/operator-v1.0.0.apk');
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    assert.equal((await worker.fetch(new Request('https://preview.pages.dev/apk', { method: 'POST' }), {})).status, 405);
    globalThis.fetch = async () => Response.json({ apk_url: 'https://elsewhere.invalid/operator.apk' });
    assert.equal((await worker.fetch(new Request('https://preview.pages.dev/apk'), {})).status, 502);
    globalThis.fetch = async () => new Response('Unavailable', { status: 404 });
    assert.equal((await worker.fetch(new Request('https://preview.pages.dev/apk'), {})).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('README and homepage share the exact QA illustration', async () => {
  const readme = await read('README.md');
  assert.match(readme, /!\[GitHub PR[^\]]+\]\(assets\/qa-verification.png\)/);
  assert.match(await read('sites/landing/out/index.html'), /src="\/qa-verification.png"/);
  assert.match(await read('sites/landing/out/index.md'), /\(\/qa-verification.png\)/);
  const source = await readFile(new URL('assets/qa-verification.png', root));
  assert.deepEqual([...source.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(await readFile(new URL('sites/landing/out/qa-verification.png', root)), source);
});
