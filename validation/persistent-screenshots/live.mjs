// Explicit opt-in. Evidence remains in the caller's private output directory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { getDefaultRuntimeConfig } from '../../apps/node/dist/adapters/android-bridge/runtimeConfig.js';
import { captureWithHelper, closeCaptureHelpers } from '../../apps/node/dist/domain/observe/captureHelper.js';
import { captureScreenshot } from '../../apps/node/dist/domain/observe/captureScreenshot.js';
import { verifyScreenshot } from '../../apps/node/dist/domain/observe/screenshotMetadata.js';
import { observeScreenshot } from '../../apps/node/dist/domain/observe/screenshot.js';
const run = promisify(execFile);
const [deviceId, output, ocr, mode = 'backend'] = process.argv.slice(2);
if (!deviceId || !output || !isAbsolute(output) || !ocr || !['backend','api','cli'].includes(mode)) throw Error('Usage: node live.mjs <device> <absolute-private-output> <OCR executable> [backend|api|cli]');
await mkdir(output, { recursive: true });
const cli = resolve('apps/node/dist/cli/index.js');
const common = ['--device', deviceId, '--operator-package', 'com.androperator.operator.dev'];
const config = getDefaultRuntimeConfig({ deviceId, operatorPackage: 'com.androperator.operator.dev' });
const rows = [];
const command = async args => {
  const { stdout } = await run(process.execPath, [cli, ...args, ...common], { timeout: 45000, env: { ...process.env, ANDROPERATOR_LOG_DIR: output + '/logs' } });
  const result = JSON.parse(stdout);
  if (result.envelope?.status !== 'success') throw Error(stdout);
  return result;
};
try {
  for (let trial = 0; trial < 4; trial++) {
    for (const scale of [100, 50, 25, undefined]) {
      const marker = `FRAME ${String(rows.length + 10).padStart(2, '0')}`;
      await command(['on-screen-log','set','--text',marker,'--font-size-sp','24','--width-dp','300','--text-color','#FFFFFF','--background-color','#000000']);
      const file = `${output}/${mode}-${trial}-${scale ?? 'stock'}.png`;
      if (trial === 0 && scale !== undefined && mode !== "cli") closeCaptureHelpers();
      const started = performance.now();
      let buffer, metadata;
      if (mode === 'backend') {
        const capture = scale === undefined ? { buffer: await captureScreenshot(config, { timeoutMs: 30000 }), metadata: { captureMethod: 'adb_screencap' } }
          : await captureWithHelper(config, { scale, timeoutMs: 30000 });
        buffer = capture.buffer; metadata = capture.metadata;
        verifyScreenshot(buffer);
        await writeFile(file, buffer);
      } else {
        const result = mode === 'api' ? await observeScreenshot({ deviceId, operatorPackage: config.operatorPackage, path: file, ...(scale === undefined ? {} : { scale }) })
          : await command(['screenshot', '--path', file, ...(scale === undefined ? [] : ['--scale', String(scale)])]);
        if (!result.envelope || result.envelope.status !== 'success') throw Error(JSON.stringify(result));
        metadata = result.envelope.stepResults[0].data;
      }
      const totalMs = performance.now() - started;
      buffer ??= await readFile(file);
      const image = verifyScreenshot(buffer);
      const { stdout: text } = await run(ocr, [file], { timeout: 20000 });
      const fresh = JSON.parse(text).some(row => row.text === marker);
      const row = { trial, scale: scale ?? 'stock', cold: metadata.captureSequence === "1", totalMs, bytes: buffer.length, ...image, ...metadata, marker, fresh,
        sha256: createHash('sha256').update(buffer).digest('hex') };
      rows.push(row);
      await writeFile(`${output}/${mode}.json`, JSON.stringify(rows, null, 2));
      console.log(JSON.stringify({ trial, scale: scale ?? 'stock', totalMs, fresh }));
      if (!fresh) throw Error(`Fresh marker not visible: ${marker}. Evidence preserved.`);
    }
  }
} finally {
  closeCaptureHelpers();
  await command(['on-screen-log', 'clear']);
}
