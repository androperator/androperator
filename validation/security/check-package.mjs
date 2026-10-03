import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../apps/node/', import.meta.url));

export function checkPackageFiles(files, readFile) {
  assert(files.some(file => file.path === 'dist/cli/index.js'), 'Build the Node package before checking its contents.');
  for (const file of files) {
    assert(!/(?:^|\/)(?:validation\/security|semgrep[^/]*|reviewdog[^/]*|\.venv)(?:\/|$)/i.test(file.path),
      `Repository security tooling must not ship: ${file.path}`);
    const content = readFile(file.path).toString('utf8');
    // Rule-specific nosemgrep source comments are allowed; tool integrations are not.
    assert(!/\b(?:semgrep|reviewdog)\b|validation\/security/i.test(content),
      `Scanner integration or rules reference in npm package: ${file.path}`);
    assert(!(/^rules:\s*$/m.test(content) && /^\s+languages:\s*/m.test(content) && /^\s+pattern(?:s|-either)?:/m.test(content)),
      `Possible bundled scanner rules in npm package: ${file.path}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot, encoding: 'utf8',
  }));
  checkPackageFiles(pack.files, filename => readFileSync(path.join(packageRoot, filename)));
  console.log(`npm package boundary passed (${pack.files.length} files): no repository scanner tooling or rule references.`);
}
