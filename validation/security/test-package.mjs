import assert from 'node:assert/strict';
import { checkPackageFiles } from './check-package.mjs';

const entry = 'dist/cli/index.js';
function check(extraPath, content) {
  const files = [{ path: entry }, ...(extraPath === entry ? [] : [{ path: extraPath }])];
  checkPackageFiles(files, filename => Buffer.from(filename === extraPath ? content : 'export {};'));
}
check(entry, '// nosemgrep: reviewed-rule\nexport {};');
for (const [filename, content] of [
  ['validation/security/check.py', ''],
  ['bundled-skills/semgrep-rules/rule.yml', ''],
  ['dist/tool.js', 'spawn("semgrep", args)'],
  ['package.json', '{"scripts":{"postinstall":"python validation/security/check.py"}}'],
  ['bundled-skills/rule.yml', 'rules:\n  - id: example\n    languages: [python]\n    pattern: bad()'],
]) {
  assert.throws(() => check(filename, content), { name: 'AssertionError' });
}
assert.throws(() => checkPackageFiles([], () => Buffer.from('')), /Build the Node package/);
console.log('Package boundary fixtures passed.');
