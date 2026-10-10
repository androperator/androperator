// Explicit opt-in. Real CLI captures plus a setup-failure injection exercising the
// complete Node stock/resize path. No public force-backend flag is introduced.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { NodeProcessRunner } from '../../apps/node/dist/adapters/android-bridge/processRunner.js';
import { observeScreenshot } from '../../apps/node/dist/domain/observe/screenshot.js';
import { closeCaptureHelpers } from '../../apps/node/dist/domain/observe/captureHelper.js';
import { verifyScreenshot } from '../../apps/node/dist/domain/observe/screenshotMetadata.js';
const [deviceId, output, ocr] = process.argv.slice(2);
if (!deviceId || !isAbsolute(output ?? '') || !ocr) throw Error('Usage: node compatibility.mjs <device> <new-absolute-evidence-directory> <ocr-executable>');
await mkdir(output);
const run = promisify(execFile), cli = resolve('apps/node/dist/cli/index.js');
const common = ['--device', deviceId, '--operator-package', 'com.androperator.operator.dev'];
const command = async args => {
  const { stdout } = await run(process.execPath, [cli, ...args, ...common], { timeout: 45000 });
  const result = JSON.parse(stdout);
  assert.equal(result.envelope?.status, 'success', stdout);
  return result;
};
class SetupFailureRunner extends NodeProcessRunner {
  async run(command, args, options) {
    if (args.includes('push') && args.some(arg => arg.endsWith('/capture.dex'))) return { code: 1, stdout: '', stderr: 'Injected helper deployment failure' };
    return super.run(command, args, options);
  }
}
const runner = new SetupFailureRunner();
const prior = (await command(['snapshot'])).envelope.stepResults[0].data.foreground_package;
const rows = [];
try {
  await command(['open', 'com.android.settings']);
  for (const mode of ['direct-cold', 'direct-warm', 'fallback', 'stock']) {
    for (const scale of mode === 'stock' ? [100] : [100, 50, 25]) {
      const marker = `FRAME ${10 + rows.length}`;
      await command(['on-screen-log', 'set', '--text', marker, '--font-size-sp', '24', '--width-dp', '300', '--text-color', '#FFFFFF', '--background-color', '#000000']);
      await new Promise(resolve => setTimeout(resolve, 500)); // Lab presentation, not capture latency.
      const path = `${output}/${mode}-${scale}.png`, started = performance.now();
      const result = mode === 'fallback'
        ? await observeScreenshot({ deviceId, operatorPackage: 'com.androperator.operator.dev', runner, scale, path })
        : await command(['screenshot', '--path', path, ...(mode === 'stock' ? [] : ['--scale', String(scale)])]);
      const totalMs = performance.now() - started;
      await writeFile(`${output}/${mode}-${scale}.json`, JSON.stringify(result, null, 2));
      assert.equal(result.envelope.status, 'success', JSON.stringify(result));
      const data = result.envelope.stepResults[0].data, image = verifyScreenshot(await readFile(path));
      assert.equal(data.captureMethod, mode === 'fallback' ? 'adb_screencap_resize' : mode === 'stock' ? 'adb_screencap' : 'shell_hardware_buffer');
      assert.ok(['absent', 'unknown'].includes(data.protectedContent));
      if (mode === 'fallback' || mode === 'stock') assert.equal(data.protectedContent, 'unknown');
      if (mode !== 'stock') {
        assert.equal(image.captureWidthPx, Math.floor(Number(data.nativeWidthPx) * scale / 100));
        assert.equal(image.captureHeightPx, Math.floor(Number(data.nativeHeightPx) * scale / 100));
      }
      const { stdout } = await run(ocr, [path], { timeout: 20000 });
      assert.ok(JSON.parse(stdout).some(row => row.text === marker), `Current marker missing: ${marker}`);
      rows.push({ mode, scale, totalMs, marker, fresh: true, markerSettleMs: 500, ...data });
      await writeFile(output + '/results.json', JSON.stringify(rows, null, 2));
      console.log(JSON.stringify({ mode, scale, totalMs, protectedContent: data.protectedContent, fresh: true }));
    }
  }
} catch (error) {
  console.error("Capture validation failed:", error);
  throw error;
} finally {
  closeCaptureHelpers();
  await command(['on-screen-log', 'clear']);
  if (prior && prior !== 'com.android.settings') {
    if (prior.includes('launcher')) await command(['press', 'home']);
    else await command(['open', prior]);
  }
}
