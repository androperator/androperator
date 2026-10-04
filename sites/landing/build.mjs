import { readFile, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { build } from 'esbuild';
import { renderMarkdown, publicMarkdown } from './render.mjs';

const site = dirname(fileURLToPath(import.meta.url));
const root = resolve(site, '../..');
const out = join(site, 'out');
const readme = await readFile(join(root, 'README.md'), 'utf8');
// Never publish a stale or missing full corpus; the wrapper builds docs first.
const fullDocs = await readFile(join(root, 'sites/androperator-public/llms-full.txt'), 'utf8');
const template = await readFile(join(site, 'template.html'), 'utf8');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(site, 'public'), out, { recursive: true });
await build({ entryPoints: [join(site, 'diagrams.mjs'), join(site, 'navigation.mjs')], outdir: join(out, 'scripts'), bundle: true, splitting: true, format: 'esm', minify: true });
await cp(join(root, 'assets/androperator-logo.png'), join(out, 'logo.png'));
await cp(join(root, 'assets/qa-verification.png'), join(out, 'qa-verification.png'));
await cp(join(root, 'sites/androperator-public/install.sh'), join(out, 'install.sh'));
await writeFile(join(out, 'index.html'), template.replace('<!-- README -->', renderMarkdown(readme, { omitSections: ['License'] })));
await writeFile(join(out, 'index.md'), publicMarkdown(readme));
await writeFile(join(out, 'llms-full.txt'), fullDocs);
await cp(join(root, 'sites/docs/static/llms.txt'), join(out, 'llms.txt'));
// Assemble one self-contained Pages Worker from the canonical APK implementation.
const apkWorker = await readFile(join(root, 'workers/operator-apk-redirect/src/index.js'), 'utf8');
const pageWorker = await readFile(join(site, 'worker.mjs'), 'utf8');
await writeFile(join(out, '_worker.js'), apkWorker.replace('export default', 'const apkRedirect =') + '\n' + pageWorker.replace(/^import apkRedirect.*\n/, ''));
await writeFile(join(out, '_routes.json'), JSON.stringify({ version: 1, include: ['/operator.apk', '/install.apk', '/apk'], exclude: [] }, null, 2) + '\n');
// A real 404 prevents static hosting from returning the homepage for missing files.
await writeFile(join(out, '404.html'), template.replace('<!-- README -->', '<h1>Page not found</h1><p><a href="/">Return to Androperator</a></p>'));
const agents = await readFile(join(site, 'public/agents.md'), 'utf8');
await mkdir(join(out, 'agents'), { recursive: true });
await writeFile(join(out, 'agents/index.html'), template.replace('<!-- README -->', renderMarkdown(agents)).replace('href="https://androperator.com/"', 'href="https://androperator.com/agents/"').replace('https://androperator.com/index.md', 'https://androperator.com/agents.md'));
const routes = [
  ['/', ['README.md', 'sites/landing/template.html']],
  ['/index.md', ['README.md']],
  ['/agents/', ['sites/landing/public/agents.md', 'sites/landing/template.html']],
  ['/agents.md', ['sites/landing/public/agents.md']],
  ['/skill.md', ['sites/landing/public/skill.md']],
  ['/install.sh', ['sites/androperator-public/install.sh']],
  ['/llms.txt', ['sites/docs/static/llms.txt']],
  ['/llms-full.txt', ['docs', 'apps/node/src', 'sites/docs/source-map.yaml']],
];
const entries = routes.map(([path, sources]) => {
  const lastModified = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...sources], { cwd: root, encoding: 'utf8' }).trim();
  return `  <url><loc>https://androperator.com${path}</loc>${lastModified ? `<lastmod>${lastModified}</lastmod>` : ''}</url>`;
});
await writeFile(join(out, 'landing-sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
await writeFile(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap><loc>https://androperator.com/landing-sitemap.xml</loc></sitemap>\n  <sitemap><loc>https://docs.androperator.com/sitemap.xml</loc></sitemap>\n</sitemapindex>\n');
console.log(`Built README and agent routes at ${out}`);
