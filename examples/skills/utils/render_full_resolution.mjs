// Runnable full-resolution adapter example. No navigation, OCR, or experimental capture.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRenderVerifier, RenderAdapterError} from '../../../apps/node/dist/renderVerification.js';
import {parseActiveDisplay} from '../../../apps/node/dist/domain/observe/activeDisplay.js';
const execute = promisify(execFile);
const usage = 'Usage: node render_full_resolution.mjs <device_serial> <absolute_action_json> <absolute_verifier_mjs> <new_absolute_private_directory> <condition_id>';
const cli = fileURLToPath(new URL('../../../apps/node/dist/cli/index.js', import.meta.url));

function context(snapshot) {
  const step = snapshot.envelope?.stepResults?.find(s => s.actionType === 'snapshot' && s.success);
  const compact = snapshot.compact;
  if (snapshot.envelope?.status !== 'success' || !step || compact?.truncated !== false
      || !Array.isArray(compact.nodes) || compact.commandId !== snapshot.envelope.commandId
      || compact.taskId !== snapshot.envelope.taskId || step.data?.has_overlay !== 'false'
      || typeof step.data.foreground_package !== 'string' || !step.data.foreground_package.trim()
      || compact.nodes.some(n => n.textTruncated || n.contentDescriptionTruncated)) {
    throw new RenderAdapterError('unsafe_observation');
  }
  // Conservative example: any node change rejects the frame. Dynamic apps should
  // explicitly narrow this to condition-relevant evidence, never just omit checks.
  return createHash('sha256').update(JSON.stringify([
    step.data.foreground_package, step.data.window_count, compact.nodes,
  ])).digest('hex');
}

export function createFullResolutionAcquirer({directory, operatorPackage = 'com.androperator.operator.dev', run = execute}) {
  if (!path.isAbsolute(directory) || !operatorPackage.trim()) throw Error('Absolute private directory and nonblank operatorPackage required');
  return async request => {
    if (request.scale !== 1) throw new RenderAdapterError('capture_unavailable');
    const start = performance.now();
    const command = async (program, args) => {
      const remaining = Math.floor(request.timeoutMs - (performance.now() - start));
      if (remaining <= 0 || request.signal.aborted) throw new RenderAdapterError('capture_unavailable');
      const result = await run(program, args, {timeout: remaining, signal: request.signal, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024});
      return result.stdout.toString();
    };
    const call = async args => JSON.parse(await command(process.execPath, [cli, ...args,
      '--device', request.deviceId, '--operator-package', operatorPackage, '--no-daemon', '--output', 'json']));
    const ready = async () => {
      try {
        const report = await call(['doctor']);
        if (report.criticalOk !== true || report.checks?.find(check => check.id === 'readiness.device.interactive')?.status !== 'pass') throw Error('not ready');
      } catch { throw new RenderAdapterError('device_not_ready'); }
    };
    const display = async () => {
      const value = parseActiveDisplay(await command('adb', ['-s', request.deviceId, 'shell', 'dumpsys', 'display']));
      if (!value) throw new RenderAdapterError('unsafe_observation');
      return {width: value.width, height: value.height, rotation: value.rotation, displayId: value.physicalId};
    };
    try {
      await ready();
      const before = await call(['snapshot', '--compact', '--max-nodes', '200', '--max-text-chars', '1024']);
      const beforeKey = context(before), source = await display();
      const filename = path.join(directory, request.captureId + '.png');
      const screenshot = await call(['screenshot', '--path', filename]);
      if (screenshot.envelope?.status !== 'success' || !screenshot.envelope.stepResults.every(s => s.success)) throw new RenderAdapterError('capture_unavailable');
      const png = await fs.readFile(filename);
      const afterSource = await display();
      const after = await call(['snapshot', '--compact', '--max-nodes', '200', '--max-text-chars', '1024']);
      const afterKey = context(after);
      await ready();
      if (JSON.stringify(afterSource) !== JSON.stringify(source)) throw new RenderAdapterError('unsafe_observation');
      return {captureId: request.captureId, deviceId: request.deviceId, png, backend: 'canonical-cli',
        source, beforeKey, afterKey, evidence: {before, after}};
    } catch (error) {
      if (error instanceof RenderAdapterError) throw error;
      throw new RenderAdapterError('capture_unavailable');
    }
  };
}

// The action file is a real completed CLI response, obtained on this same device.
// The verifier module exports async verify(frame, conditionId, budget), examining
// frame.png AND frame.evidence. It must honor cancellation and never navigate.
async function main(args) {
  if (args.length !== 5 || args.some(v => !v.trim()) || !args.slice(1, 4).every(path.isAbsolute)) {
    throw Error(usage);
  }
  const [deviceId, actionFile, verifierFile, directory, conditionId] = args;
  const action = JSON.parse(await fs.readFile(actionFile, 'utf8')).envelope;
  const {verify} = await import(pathToFileURL(verifierFile).href);
  const run = createRenderVerifier({acquire: createFullResolutionAcquirer({directory}), verify});
  await fs.mkdir(directory, {mode: 0o700});
  const result = await run({action, deviceId, conditionId, timeoutMs: 60000, reducedAttempts: 0});
  const manifest = JSON.stringify(result, (key, value) => key === 'png' ? undefined : value, 2);
  await fs.writeFile(path.join(directory, 'result.json'), manifest, {mode: 0o600});
  console.log(manifest);
  if (result.status !== 'verified') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // Raw subprocess/provider errors can contain credentials or private screen text.
    console.error(usage);
    console.error('Rendering example failed. Check arguments, readiness and your private adapter diagnostics; no navigation was replayed.');
    process.exitCode = 1;
  });
}
