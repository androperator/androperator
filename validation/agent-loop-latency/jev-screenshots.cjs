const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {startScaleSession} = require('./scale-session.cjs');
const {experimentDisplay, splitPacket, expectedSize, validateDirectMetrics} = require('./screenshot-scales.cjs');
const {verifyScreenshot} = require('../../apps/node/dist/domain/observe/screenshotMetadata.js');

function mayFallback(error) {
  // Unknown Android errors (including policy, lock and rotation failures) fail
  // closed. Only recognized transport/protocol failures qualify.
  return /^(Capture session closed|Capture session timed out|Invalid capture signature|Missing PNG signature|Missing or unexpected capture trailer|Truncated PNG packet|Missing PNG terminator|Direct buffer geometry or request sequence mismatch)$/.test(error.message);
}

function createRunner({mode, device, directory, startSession = startScaleSession, runCli, selectDisplay, percent = 25}) {
  if (!['control', 'quarter', 'quarter-fault', 'quarter-transition'].includes(mode)) throw Error('Unknown screenshot mode');
  if (![100, 50, 25].includes(percent)) throw Error('Unsupported capture percentage');
  let session, display, sequence = 0, count = 0, disabled = false, transition = false;
  const record = row => fs.appendFileSync(path.join(directory, 'screenshot-attempts.ndjson'), JSON.stringify(row) + '\n', {mode: 0o600});
  async function close() { if (session) await session.close(); session = undefined; }
  async function execute(args, options) {
    if (args[0] === '__close') { await close(); return {status: 0, stdout: '{}', signal: null}; }
    if (mode === 'control' || args[0] !== 'screenshot') {
      const result = runCli(args, options);
      if (mode === 'quarter-transition' && args[0] === 'click' && result.status === 0) transition = true;
      return result;
    }
    const started = performance.now();
    const remaining = () => Math.floor(options.timeout - (performance.now() - started) - 250);
    const output = args[args.indexOf('--path') + 1];
    if (args.length !== 3 || args[1] !== '--path' || !path.isAbsolute(output)) throw Error('Explicit screenshot path required');
    count++;
    // Unknown overlays always retain full-resolution evidence for human review.
    const full = path.basename(output).startsWith('overlay-');
    if (disabled || full || transition) {
      const backend = transition ? 'stock-transition' : full ? 'stock-overlay' : 'stock-disabled';
      transition = false;
      const result = runCli(args, {...options, timeout: remaining()});
      record({attempt: count, backend, success: result.status === 0, elapsedMs: performance.now() - started});
      return result;
    }
    try {
      if (!session) {
        display = selectDisplay(Math.min(3000, remaining()));
        session = startSession(device, display.physicalId, '/data/local/tmp/androperator-scale-experiment.dex', display);
      }
      if (mode === 'quarter-fault' && count === 2) await close();
      if (!session) throw Error('Capture session closed');
      const packet = splitPacket((await session.capture(percent, Math.min(5000, remaining()))).buffer);
      const image = verifyScreenshot(packet.png);
      const size = expectedSize(display, percent);
      if (image.captureWidthPx !== size.width || image.captureHeightPx !== size.height
        || packet.metrics.sourceWidth !== display.width || packet.metrics.sourceHeight !== display.height) throw Error('Capture source/output mismatch');
      validateDirectMetrics(packet.metrics, size.width, size.height, display.rotation, ++sequence);
      if (packet.metrics.containsHdrLayers) throw Error('HDR behavior is not validated');
      if (remaining() <= 0) throw Error('Screenshot deadline exhausted');
      const temporary = output + '.partial';
      fs.writeFileSync(temporary, packet.png, {mode: 0o600});
      fs.renameSync(temporary, output);
      const commandId = `experimental-capture-${randomUUID()}`;
      const data = {...image, sourceWidthPx: display.width, sourceHeightPx: display.height,
        rotation: display.rotation, backend: 'experimental-direct-buffer', path: output, sequence,
        requestedScale: percent / 100, captureSource: 'experimental-shell', persistedAt: new Date().toISOString()};
      record({attempt: count, backend: data.backend, success: true, bytes: packet.png.length,
        elapsedMs: performance.now() - started, ...packet.metrics});
      // This is explicitly experimental capture evidence, not an Operator result.
      return {status: 0, signal: null, stdout: JSON.stringify({envelope: {commandId, taskId: process.env.ANDROPERATOR_RUN_ID,
        status: 'success', stepResults: [{id: 'experimental-screenshot', actionType: 'take_screenshot', success: true, data}]}})};
    } catch (error) {
      record({attempt: count, backend: 'experimental-direct-buffer', success: false,
        elapsedMs: performance.now() - started, reason: error.message});
      await close();
      disabled = true;
      if (!mayFallback(error) || remaining() <= 0) throw error;
      const result = runCli(args, {...options, timeout: remaining()});
      record({attempt: count, backend: 'stock-full-fallback', success: result.status === 0,
        elapsedMs: performance.now() - started});
      return result;
    }
  }
  return {execute, close};
}

let runner;
async function execute(args, options) {
  if (!runner) {
    const cli = path.resolve(__dirname, '../../apps/node/dist/cli/index.js');
    const device = process.env.ANDROPERATOR_DEVICE_ID;
    runner = createRunner({mode: process.env.VERSION_SCREENSHOTS, device, directory: process.env.VERSION_RUN_DIR,
      runCli(command, settings) {
        if (settings.timeout <= 0) throw Error('Screenshot deadline exhausted');
        return spawnSync(process.execPath, [cli, ...command, '--device', device,
          '--operator-package', 'com.androperator.operator.dev', '--no-daemon', '--output', 'json'],
        {encoding: 'utf8', timeout: settings.timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
          env: {...process.env, ANDROPERATOR_LOG_DIR: settings.logDir}});
      },
      selectDisplay(timeout) {
        const child = spawnSync('adb', ['-s', device, 'shell', 'dumpsys', 'display'], {encoding: 'utf8', timeout});
        if (child.status !== 0) throw Error('Display selection failed');
        return experimentDisplay(child.stdout);
      },
    });
  }
  return runner.execute(args, options);
}
module.exports = {execute, createRunner, mayFallback};
