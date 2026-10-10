#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {summarize} = require('./summary.cjs');

const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'apps/node/dist/cli/index.js');
const helper = path.join(root, 'examples/skills/utils/settings_version_tool.js');

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!['--device', '--out'].includes(name) || !value?.trim() || value.startsWith('--') || result[name]) {
      throw Error('Usage: node validation/agent-loop-latency/benchmark.cjs --device <serial> --out <new-absolute-directory>');
    }
    result[name] = value;
  }
  if (!result['--device'] || !path.isAbsolute(result['--out'] ?? '')) throw Error('Explicit device and absolute output directory required');
  return result;
}

function run(argv) {
  const args = options(argv);
  if (!process.env.JEV_API_KEY?.trim()) throw Error('JEV_API_KEY is not configured');
  if (!fs.existsSync(cli)) throw Error('Build the branch-local Node CLI first');
  const directory = args['--out'];
  fs.mkdirSync(directory, {mode: 0o700}); // Refuse to overwrite or resume a trial.
  const env = {...process.env,
    ANDROPERATOR_BIN: cli, ANDROPERATOR_DEVICE_ID: args['--device'],
    ANDROPERATOR_OPERATOR_PACKAGE: 'com.androperator.operator.dev',
    ANDROPERATOR_SKILL_ID: 'com.android.settings.get-version-details-with-jev',
    ANDROPERATOR_RUN_ID: `latency-${path.basename(directory)}`,
    VERSION_RUN_DIR: directory, VERSION_TIMING: '1',
    ANDROPERATOR_LOG_DIR: path.join(directory, 'logs'),
  };
  const operations = [];
  function execute(operation, program, parameters, timeout) {
    const started = performance.now();
    const child = spawnSync(process.execPath, [program, ...parameters], {
      cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(directory, `${operation}.stdout`), child.stdout ?? '');
    fs.writeFileSync(path.join(directory, `${operation}.stderr`), child.stderr ?? '');
    let response;
    try { response = JSON.parse(child.stdout); } catch { response = undefined; }
    const elapsedMs = performance.now() - started;
    operations.push({operation, elapsedMs, exitCode: child.status, signal: child.signal,
      status: response?.status, reason: response?.reason});
    return {ok: child.status === 0, response};
  }
  // Reset is reported separately and excluded from the task clock.
  const reset = execute('reset', cli, ['close', 'com.android.settings', '--device', args['--device'],
    '--operator-package', env.ANDROPERATOR_OPERATOR_PACKAGE, '--no-daemon', '--output', 'json'], 30000);
  const resetVerified = reset.ok && reset.response?.envelope?.status === 'success';
  const started = performance.now();
  let status = 'failed';
  let stoppedAt = 'reset';
  if (resetVerified) {
    for (const operation of ['open', 'jev', 'finish']) {
      stoppedAt = operation;
      const result = execute(operation, helper, [operation], 280000);
      if (!result.ok || result.response?.status === 'overlay_review_required' ||
          (operation === 'jev' && result.response?.status !== 'complete') ||
          (operation === 'finish' && result.response?.status !== 'success')) break;
      if (operation === 'finish') status = 'verified';
    }
  }
  const trial = {status, stoppedAt, taskMs: resetVerified ? performance.now() - started : null, operations};
  fs.writeFileSync(path.join(directory, 'trial.json'), JSON.stringify(trial, null, 2));
  const summary = summarize(directory, trial);
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  return status === 'verified' ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {options, run};
