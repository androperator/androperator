const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createRunner} = require('./jev-screenshots.cjs');
const {experimentDisplay} = require('./screenshot-scales.cjs');

function rendered(rows, destination) {
  return rows.some(row => row.top > 0.05 && row.top < 0.18 && row.confidence >= 0.5
    && (destination === 'About phone' ? row.text === destination : (row.text === 'Settings' || /(?:^|\s)Search Settings$/.test(row.text))));
}
function createGate({capture, fullCapture, recognize, record}) {
  let destination = 'Settings';
  let disabled = false;
  return async function execute(args, options) {
    if (args[0] !== 'screenshot') {
      if (args[0] === 'click' && (args[1] !== '--text' || args[2] !== 'About phone')) throw Error('Unsupported destination in experimental render gate');
      const result = await capture(args, options);
      if (result.status === 0 && args[0] === 'open') destination = 'Settings';
      if (result.status === 0 && args[0] === 'click') {
        destination = 'About phone';
      }
      return result;
    }
    const start = performance.now();
    const remaining = () => Math.floor(options.timeout - (performance.now() - start));
    const output = args[2];
    // This full-resolution probe checks actual pixels before the selected-size capture.
    // The accepted capture is checked again; a successful tree update alone is insufficient.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const probe = output + `.render-probe-${attempt}.png`;
      if (remaining() < 3000) throw Error('Rendered destination deadline exhausted');
      const result = await fullCapture(['screenshot', '--path', probe], {...options, timeout: remaining()});
      if (result.status !== 0) return result;
      const rows = recognize(probe, remaining());
      const passed = rendered(rows, destination);
      record({kind: 'probe', destination, attempt, passed, elapsedMs: performance.now() - start});
      if (!passed) continue;
      const selected = await (disabled ? fullCapture : capture)(args, {...options, timeout: remaining()});
      if (selected.status !== 0) return selected;
      const selectedRows = recognize(output, remaining());
      const accepted = rendered(selectedRows, destination);
      record({kind: 'selected', destination, attempt, passed: accepted, fullFallback: disabled, elapsedMs: performance.now() - start});
      if (accepted) return selected;
      // Preserve the rejected image; only a fresh, independently checked full image may replace it.
      fs.renameSync(output, output + `.rejected-${attempt}.png`);
      disabled = true;
    }
    throw Error('Rendered destination not verified');
  };
}
let executeGate;
async function execute(args, options) {
  if (!executeGate) {
    const directory = process.env.VERSION_RUN_DIR;
    const device = process.env.ANDROPERATOR_DEVICE_ID;
    const percent = Number(process.env.VERSION_SCREENSHOTS.split('-')[1]);
    const cli = path.resolve(__dirname, '../../apps/node/dist/cli/index.js');
    const runCli = (command, settings) => {
      if (settings.timeout <= 0) throw Error('Rendering check deadline exhausted');
      return spawnSync(process.execPath, [cli, ...command, '--device', device,
      '--operator-package', 'com.androperator.operator.dev', '--no-daemon', '--output', 'json'],
      {encoding: 'utf8', timeout: settings.timeout, maxBuffer: 8 * 1024 * 1024,
        env: {...process.env, ANDROPERATOR_LOG_DIR: settings.logDir}});
    };
    const selected = createRunner({mode: process.env.VERSION_SCREENSHOTS === 'decisions-25-fault' ? 'quarter-fault' : 'quarter', percent, device, directory, runCli,
      selectDisplay(timeout) {
        const result = spawnSync('adb', ['-s', device, 'shell', 'dumpsys', 'display'], {encoding: 'utf8', timeout});
        if (result.status !== 0) throw Error('Display selection failed');
        return experimentDisplay(result.stdout);
      }});
    executeGate = createGate({capture: selected.execute, fullCapture: runCli,
      recognize(file, timeout) {
        if (timeout <= 0) throw Error('Rendering check deadline exhausted');
        const result = spawnSync(process.env.VERSION_SCREEN_TEXT, [file], {encoding: 'utf8', timeout});
        if (result.status !== 0) throw Error('Local pixel recognition failed');
        const rows = JSON.parse(result.stdout);
        fs.writeFileSync(file + '.ocr.json', JSON.stringify(rows), {mode: 0o600});
        return rows;
      },
      record(row) {fs.appendFileSync(path.join(directory, 'render-checks.ndjson'), JSON.stringify(row) + '\n', {mode: 0o600});},
    });
  }
  return executeGate(args, options);
}
module.exports = {execute, createGate, rendered};
