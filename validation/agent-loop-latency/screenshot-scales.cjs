const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {parseActiveDisplay} = require('../../apps/node/dist/domain/observe/activeDisplay.js');
const {verifyScreenshot} = require('../../apps/node/dist/domain/observe/screenshotMetadata.js');
const {startScaleSession} = require('./scale-session.cjs');

const remoteDex = '/data/local/tmp/androperator-scale-experiment.dex';

function experimentDisplay(dump) {
  const modern = parseActiveDisplay(dump);
  if (modern) return modern;
  // Explicit, narrow support for the API 26 emulator's default local display.
  const legacy = dump.match(/mDefaultViewport=DisplayViewport\{valid=true, displayId=0, uniqueId='null', orientation=([0-3]), logicalFrame=Rect\(0, 0 - (\d+), (\d+)\)/);
  if (!legacy || !dump.includes('uniqueId="local:0"')) throw Error('An explicit active display is required');
  return {physicalId: '0', width: Number(legacy[2]), height: Number(legacy[3]), rotation: Number(legacy[1])};
}

function capture(args) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let firstByteMs = null, bytes = 0, stopped = false;
    const stdout = [], stderr = [];
    const child = spawn('adb', args, {stdio: ['ignore', 'pipe', 'pipe']});
    const timer = setTimeout(() => { stopped = true; child.kill('SIGKILL'); }, 20000);
    child.stdout.on('data', chunk => {
      firstByteMs ??= performance.now() - start;
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) { stopped = true; child.kill('SIGKILL'); }
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({code, stopped, firstByteMs, captureMs: performance.now() - start,
        buffer: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString()});
    });
  });
}

function expectedSize(display, percent) {
  return {width: Math.max(1, Math.floor(display.width * percent / 100)),
    height: Math.max(1, Math.floor(display.height * percent / 100))};
}

function splitPacket(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('Missing PNG signature');
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + size + 12;
    if (end > buffer.length) throw Error('Truncated PNG packet');
    if (type === 'IEND') {
      if (size !== 0) throw Error('Invalid PNG terminator');
      const trailer = buffer.subarray(end).toString();
      const match = trailer.match(/^SCALE_TIMING (\{[^\n]+\})\r?\n$/);
      if (!match) throw Error('Missing or unexpected capture trailer');
      return {png: buffer.subarray(0, end), metrics: JSON.parse(match[1])};
    }
    offset = end;
  }
  throw Error('Missing PNG terminator');
}

function validateDirectMetrics(metrics, width, height, rotation, sequence) {
  if (metrics.bufferWidth !== width || metrics.bufferHeight !== height || metrics.rotation !== rotation
    || metrics.sequence !== sequence || typeof metrics.containsHdrLayers !== 'boolean') {
    throw Error('Direct buffer geometry or request sequence mismatch');
  }
  for (const name of ['deviceCaptureMs', 'readbackMs', 'encodeAndWriteMs']) {
    if (!Number.isFinite(metrics[name]) || metrics[name] < 0) throw Error('Invalid device timing');
  }
}

function aggregate(rows) {
  const result = {};
  for (const variant of ['stock', '100', '50', '25']) {
    const samples = rows.filter(row => row.variant === variant && !row.warmup && row.success);
    if (!samples.length) continue;
    const summary = {count: samples.length, width: samples[0].width, height: samples[0].height};
    for (const key of ['captureMs', 'firstByteMs', 'verifyMs', 'persistMs', 'totalMs', 'bytes',
      'rawCaptureAndBitmapMs', 'scaleMs', 'deviceCaptureMs', 'readbackMs', 'encodeAndWriteMs']) {
      const values = samples.map(row => row[key]).filter(Number.isFinite).sort((a,b) => a-b);
      if (!values.length) continue;
      const middle = Math.floor(values.length / 2);
      summary[key] = {mean: values.reduce((a,b) => a+b, 0) / values.length,
        median: values.length % 2 ? values[middle] : (values[middle-1] + values[middle]) / 2,
        min: values[0], max: values.at(-1), p95: values[Math.ceil(values.length * .95)-1]};
    }
    result[variant] = summary;
  }
  return result;
}

async function main() {
  const [device, destination, mode] = process.argv.slice(2);
  if (!device || !destination || !path.isAbsolute(destination) || process.argv.length > 5
    || (mode !== undefined && !['--persistent', '--direct'].includes(mode))) {
    throw Error('Usage: node screenshot-scales.cjs <device> <new-absolute-output-directory> [--persistent|--direct]');
  }
  fs.mkdirSync(destination, {mode: 0o700});
  const readiness = spawnSync(process.execPath, [path.resolve(__dirname, '../../apps/node/dist/cli/index.js'),
    'doctor', '--device', device, '--operator-package', 'com.androperator.operator.dev'],
  {encoding:'utf8', timeout:20000, maxBuffer:8 * 1024 * 1024,
    env:{...process.env, ANDROPERATOR_LOG_DIR:path.join(destination, 'logs')}});
  fs.writeFileSync(path.join(destination, 'readiness.json'), readiness.stdout ?? '', {mode:0o600});
  fs.writeFileSync(path.join(destination, 'readiness.stderr'), readiness.stderr ?? '', {mode:0o600});
  if (readiness.status !== 0 || JSON.parse(readiness.stdout).ok !== true) {
    throw Error('Device readiness failed; no capture benchmark started');
  }
  const displayResult = await capture(['-s', device, 'shell', 'dumpsys', 'display']);
  if (displayResult.code !== 0 || displayResult.stopped) throw Error('Display selection failed');
  const display = experimentDisplay(displayResult.buffer.toString());
  if (!display) throw Error('An explicit active display is required');
  const rows = [];
  let session, completed = false, failure, sequence = 0;
  try {
    for (let round = -1; round < 8; round++) {
      const variants = ['stock', '100', '50', '25'];
      const offset = Math.max(0, round) % variants.length;
      const order = [...variants.slice(offset), ...variants.slice(0, offset)];
      for (const variant of order) {
        const id = `${round < 0 ? 'warmup' : String(round + 1).padStart(2, '0')}-${variant}`;
        const args = variant === 'stock'
          ? ['-s', device, 'exec-out', 'screencap', '-p', '-d', display.physicalId]
          : ['-s', device, 'exec-out', 'env', `CLASSPATH=${remoteDex}`, 'app_process',
            '/system/bin', 'ScaleCapture', variant, display.physicalId];
        if (mode && variant !== 'stock') session ??= startScaleSession(device, display.physicalId, remoteDex,
          mode === '--direct' ? display : undefined);
        let result;
        try {
          result = mode && variant !== 'stock' ? await session.capture(variant) : await capture(args);
        } catch (error) {
          const row = {id, variant, warmup:round < 0, success:false, error:error.message};
          rows.push(row);
          fs.appendFileSync(path.join(destination, 'samples.ndjson'), JSON.stringify(row) + '\n', {mode:0o600});
          throw error;
        }
        fs.writeFileSync(path.join(destination, `${id}.stderr`), result.stderr, {mode: 0o600});
        const row = {id, variant, warmup: round < 0, success: false, code: result.code,
          stopped: result.stopped, bytes: result.buffer.length, captureMs: result.captureMs,
          firstByteMs: result.firstByteMs};
        try {
          if (result.code !== 0 || result.stopped) throw Error('Capture failed or exceeded limits');
          // Frame the PNG and our timing trailer explicitly; adb exec-out also
          // merges remote stderr, which must never be silently ignored.
          const packet = variant === 'stock' ? {png: result.buffer} : splitPacket(result.buffer);
          row.wireBytes = result.buffer.length;
          row.bytes = packet.png.length;
          const verifyStart = performance.now();
          const image = verifyScreenshot(packet.png);
          row.verifyMs = performance.now() - verifyStart;
          const expected = expectedSize(display, variant === 'stock' ? 100 : Number(variant));
          row.width = image.captureWidthPx; row.height = image.captureHeightPx;
          if (row.width !== expected.width || row.height !== expected.height) throw Error('Capture geometry mismatch');
          if (variant !== 'stock') {
            const metrics = packet.metrics;
            if (metrics.sourceWidth !== display.width || metrics.sourceHeight !== display.height
              || metrics.width !== row.width || metrics.height !== row.height) throw Error('Device metadata mismatch');
            if (mode === '--direct') {
              validateDirectMetrics(metrics, row.width, row.height, display.rotation, ++sequence);
              row.bufferWidth = metrics.bufferWidth; row.bufferHeight = metrics.bufferHeight;
              row.sequence = metrics.sequence; row.containsHdrLayers = metrics.containsHdrLayers;
              row.rotation = metrics.rotation;
            }
            for (const name of mode === '--direct'
              ? ['deviceCaptureMs', 'readbackMs', 'encodeAndWriteMs']
              : ['rawCaptureAndBitmapMs', 'scaleMs', 'encodeAndWriteMs']) {
              if (!Number.isFinite(metrics[name]) || metrics[name] < 0) throw Error('Invalid device timing');
              row[name] = metrics[name];
            }
          }
          const persistStart = performance.now();
          fs.writeFileSync(path.join(destination, `${id}.png`), packet.png, {mode: 0o600});
          row.persistMs = performance.now() - persistStart;
          row.totalMs = row.captureMs + row.verifyMs + row.persistMs;
          row.success = true;
        } catch (error) {
          row.error = error.message;
          fs.writeFileSync(path.join(destination, `${id}.partial`), result.buffer, {mode: 0o600});
          throw error;
        } finally {
          rows.push(row);
          fs.appendFileSync(path.join(destination, 'samples.ndjson'), JSON.stringify(row) + '\n', {mode: 0o600});
        }
      }
    }
    const after = await capture(['-s', device, 'shell', 'dumpsys', 'display']);
    if (after.code !== 0 || after.stopped || JSON.stringify(experimentDisplay(after.buffer.toString())) !== JSON.stringify(display)) {
      throw Error('Display changed during benchmark; results require investigation');
    }
    completed = true;
  } catch (error) {
    failure = error.message;
    throw error;
  } finally {
    if (session) await session.close();
    fs.writeFileSync(path.join(destination, 'summary.json'), JSON.stringify({
      schemaVersion: 1, completed, backend: mode === '--direct' ? 'direct-buffer' : mode ? 'persistent-helper' : 'fresh-helper', sourceWidth: display.width, sourceHeight: display.height,
      failures: rows.filter(row => !row.success).length, failure, variants: aggregate(rows),
      note: 'Low-level capture benchmark. Excludes CLI readiness, display selection and agent/provider time. Device encodeAndWrite includes pipe backpressure. Only direct-buffer mode requests reduced capture buffers.'
    }, null, 2), {mode: 0o600});
  }
  console.log(JSON.stringify(aggregate(rows), null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {expectedSize, aggregate, experimentDisplay, splitPacket, validateDirectMetrics};
