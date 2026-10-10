import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const digest = path => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
test('packaged DEX matches maintained source and the shipped manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('apps/node/capture-helper/manifest.json', root)));
  assert.equal(manifest.protocol, 1);
  assert.equal(manifest.sha256, digest('apps/node/capture-helper/capture.dex'));
  assert.equal(manifest.sourceSha256, digest('apps/capture-helper/CaptureHelper.java'));
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', '/tmp/androperator-capture-npm-cache'], { cwd: new URL('apps/node/', root), encoding: 'utf8' }));
  for (const path of ['capture-helper/capture.dex', 'capture-helper/manifest.json', 'dist/domain/observe/captureHelper.js']) {
    assert.ok(pack.files.some(file => file.path === path), path);
  }
});
test('CLI rejects invalid local scales and unsupported pre-command placement as structured failures', () => {
  for (const value of ['0', '1', '0.25', '75', 'NaN', '']) {
    for (const args of [['screenshot', '--scale', value], ['--scale', value, 'screenshot']]) {
      let failure;
      try { execFileSync('node', ['apps/node/dist/cli/index.js', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) { failure = error; }
      assert.ok(failure, JSON.stringify(args));
      assert.ok(failure.status > 0);
      const output = JSON.parse(failure.stdout);
      assert.ok(output.code); assert.match(output.message, /scale|value/i);
    }
  }
  let missing;
  try { execFileSync('node', ['apps/node/dist/cli/index.js', 'screenshot', '--scale'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { missing = error; }
  assert.ok(missing); assert.match(JSON.parse(missing.stdout).message, /100.*50.*25|value/);
});
