// Explicit opt-in, first-party fixture only. Never download or display real DRM content.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { observeScreenshot } from '../../apps/node/dist/domain/observe/screenshot.js';
import { closeCaptureHelpers } from '../../apps/node/dist/domain/observe/captureHelper.js';
import { verifyScreenshot } from '../../apps/node/dist/domain/observe/screenshotMetadata.js';
const [deviceId, output] = process.argv.slice(2);
if (!deviceId || !output || !isAbsolute(output)) throw Error('Usage: node protection.mjs <device> <new-absolute-evidence-directory>');
await mkdir(output); // Do not mix a new run with existing artifacts.
const run = promisify(execFile);
const common = ['--device', deviceId, '--operator-package', 'com.androperator.operator.dev'];
const cli = resolve('apps/node/dist/cli/index.js');
const rows = [];
let commandNumber = 0;
async function command(args) {
  const { stdout } = await run(process.execPath, [cli, ...args, ...common], {
    timeout: 30000, env: { ...process.env, ANDROPERATOR_LOG_DIR: output + '/logs' },
  });
  await writeFile(`${output}/command-${++commandNumber}.json`, stdout);
  const result = JSON.parse(stdout);
  assert.equal(result.envelope.status, 'success', stdout);
  return result;
}
async function visible(marker) {
  const snapshot = await command(['snapshot']);
  const data = snapshot.envelope.stepResults[0].data;
  assert.equal(data.foreground_package, 'com.androperator.capturefixture', 'Fixture left foreground; discard this run');
  assert.ok(Object.values(data).some(value => typeof value === 'string' && value.includes(marker)), `Missing fixture marker: ${marker}`);
}
async function capture(name, scale, rejection) {
  const path = `${output}/${name}-${scale}.png`;
  const result = await observeScreenshot({ deviceId, operatorPackage: 'com.androperator.operator.dev', scale, path });
  await writeFile(`${output}/${name}-${scale}.json`, JSON.stringify(result, null, 2));
  const step = result.envelope.stepResults[0];
  if (rejection) {
    assert.equal(result.envelope.status, 'failed');
    assert.equal(step.data.captureFailureReason, 'rejected');
    assert.equal(step.data.fallbackAttempted, 'false');
    assert.ok(step.data.message.includes(rejection), step.data.message);
    assert.equal(step.data.protectedContent, name === 'protected' ? 'present' : 'unknown');
    await assert.rejects(access(path), { code: 'ENOENT' });
  } else {
    assert.equal(result.envelope.status, 'success', JSON.stringify(result));
    const image = verifyScreenshot(await readFile(path));
    assert.equal(image.captureWidthPx, Math.floor(Number(step.data.nativeWidthPx) * scale / 100));
    assert.equal(image.captureHeightPx, Math.floor(Number(step.data.nativeHeightPx) * scale / 100));
  }
  rows.push({ name, scale, rejected: Boolean(rejection), ...step.data });
  await writeFile(output + '/results.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ name, scale, rejected: Boolean(rejection) }));
}
try {
  await command(['open', 'com.androperator.capturefixture']);
  await command(['click', '--text', 'REMOVE PROTECTED BUFFER']);
  await command(['click', '--text', 'DISABLE SECURE WINDOW']);
  await visible('ORDINARY WINDOW RESTORED');
  for (const scale of [100, 50, 25]) await capture('ordinary', scale);
  await command(['click', '--text', 'SHOW PROTECTED BUFFER']);
  // Preparation only; failure does not replay navigation or any capture.
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const scale of [100, 50, 25]) {
    await visible('PROTECTED BUFFER PRESENTED');
    await capture('protected', scale, 'Protected buffer rejected before pixel readback');
  }
  await command(['click', '--text', 'REMOVE PROTECTED BUFFER']);
  await visible('PROTECTED BUFFER REMOVED');
  await capture('after-protected', 25);
  await command(['click', '--text', 'ENABLE SECURE WINDOW']);
  for (const scale of [100, 50, 25]) {
    await visible('SECURE WINDOW ACTIVE');
    await capture('secure', scale, 'Secure window rejected before pixel readback');
  }
  await command(['click', '--text', 'DISABLE SECURE WINDOW']);
  await visible('ORDINARY WINDOW RESTORED');
  await capture('after-secure', 25);
} finally {
  closeCaptureHelpers();
  // Do not reopen the fixture if another controller changed foreground state.
  const snapshot = await command(['snapshot']);
  if (snapshot.envelope.stepResults[0].data.foreground_package === 'com.androperator.capturefixture') {
    await command(['click', '--text', 'REMOVE PROTECTED BUFFER']);
    await command(['click', '--text', 'DISABLE SECURE WINDOW']);
  }
}
