const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {statistics, summarize} = require('./summary.cjs');
const {options} = require('./benchmark.cjs');
const {measureSync, measureAsync} = require('../../examples/skills/utils/settings_version_timing');
const {createBridge} = require('./api-bridge.cjs');
const {context} = require('./node-api.cjs');

test('timing preserves returned results and original synchronous/asynchronous failures', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-timing-'));
  const old = {VERSION_RUN_DIR: process.env.VERSION_RUN_DIR, VERSION_TIMING: process.env.VERSION_TIMING};
  Object.assign(process.env, {VERSION_RUN_DIR: directory, VERSION_TIMING: '1'});
  try {
    const error = Error('private failure');
    assert.equal(measureSync('success', () => 42), 42);
    assert.throws(() => measureSync('sync', () => {throw error;}), value => value === error);
    await assert.rejects(measureAsync('async', async () => {throw error;}), value => value === error);
    assert.equal(await measureAsync('success', async () => 43), 43);
    const text = fs.readFileSync(path.join(directory, 'timings.ndjson'), 'utf8');
    assert.ok(!text.includes('private failure'));
    const rows = text.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.outcome), ['returned', 'failed', 'failed', 'returned']);
    assert.ok(rows.every(row => row.elapsedMs >= 0));
    delete process.env.VERSION_TIMING;
    measureSync('disabled', () => 1);
    assert.equal(fs.readFileSync(path.join(directory, 'timings.ndjson'), 'utf8'), text);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('summary includes failed attempts and excludes private evidence without double-counting spans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-summary-'));
  const save = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data));
  try {
    save('events.json', [{args: ['click', 'private label'], device: 'private-device', elapsedMs: 100, exitCode: 0},
      {args: ['snapshot'], elapsedMs: 200, exitCode: 1, failure: {message: 'private message'}}]);
    save('jev.json', [{elapsedMs: 50, httpStatus: 429, error: 'private error'},
      {elapsedMs: 60, httpStatus: 200, choice: 'private-choice', request: {secret: 'private key'}}]);
    fs.writeFileSync(path.join(directory, 'timings.ndjson'), JSON.stringify({name: 'observation', elapsedMs: 400}) + '\n');
    const result = summarize(directory, {status: 'failed', stoppedAt: 'jev', taskMs: 1000, operations: []});
    assert.equal(result.otherMs, 590);
    assert.equal(result.failedCommands, 1);
    assert.equal(result.provider.failedAttempts, 1);
    assert.equal(result.provider.requests.count, 2);
    assert.equal(result.terminalEvidencePresent, false);
    assert.ok(!JSON.stringify(result).includes('private'));
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('statistics and arguments reject missing, malformed and non-finite inputs', () => {
  assert.deepEqual(statistics([]), {count: 0});
  assert.equal(statistics([3, 1, 4, 2]).medianMs, 2.5);
  assert.throws(() => statistics([NaN]));
  for (const args of [[], ['--device'], ['--device', 'x', '--out', 'relative'],
    ['--device', 'x', '--out', '/tmp/test', '--extra', 'x']]) assert.throws(() => options(args));
  assert.equal(options(['--device', 'test-device', '--out', '/tmp/test'])['--device'], 'test-device');
  assert.equal(options(['--device', 'test-device', '--out', '/tmp/test', '--backend', 'persistent'])['--backend'], 'persistent');
  assert.throws(() => options(['--device', 'test-device', '--out', '/tmp/test', '--backend', 'unknown']));
});

test('persistent worker retains state, preserves failures and closes permanently on a deadline', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-api-'));
  const fixture = path.join(directory, 'api.cjs');
  fs.writeFileSync(fixture, `let count=0; exports.execute=async args=>{
    if(args[0]==='timeout') await new Promise(resolve=>setTimeout(resolve,1000));
    if(args[0]==='throw') throw Error('test error');
    return {stdout:JSON.stringify({count:++count}),status:args[0]==='fail'?1:0,signal:null};
  };`);
  const bridge = createBridge(fixture);
  try {
    assert.equal(JSON.parse(bridge.execute(['ok'], {timeout: 5000}).stdout).count, 1);
    assert.equal(JSON.parse(bridge.execute(['ok'], {timeout: 5000}).stdout).count, 2);
    assert.equal(bridge.execute(['fail'], {timeout: 5000}).status, 1);
    const error = bridge.execute(['throw'], {timeout: 5000});
    assert.equal(error.status, 1);
    assert.match(error.stderr, /test error/);
    assert.equal(bridge.execute(['timeout'], {timeout: 20}).error.code, 'ETIMEDOUT');
    assert.throws(() => bridge.execute(['ok'], {timeout: 5000}), /closed/);
  } finally { await bridge.close(); fs.rmSync(directory, {recursive: true, force: true}); }
});

test('API context retains exact helper arguments, explicit targeting and direct execution', () => {
  const args = ['snapshot', '--compact', '--max-nodes', '200', '--max-text-chars', '1024', '--raw-path', '/tmp/capture.xml'];
  const result = context(args, 'test-device', 'test.operator', {});
  assert.deepEqual(result.rest, args.slice(1));
  assert.equal(result.deviceId, 'test-device');
  assert.equal(result.operatorPackage, 'test.operator');
  assert.equal(result.noDaemon, true);
  assert.equal(result.format, 'json');
  assert.throws(() => context(['exec'], 'test-device', 'test.operator', {}));
  assert.throws(() => context(args, '', 'test.operator', {}));
});
