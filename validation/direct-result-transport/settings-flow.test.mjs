import test from 'node:test';
import assert from 'node:assert/strict';
import { statistics, trialSchedule, viewport, endpointVisible, targetStable, swipeParams, summarize } from './settings-flow-core.mjs';

test('statistics use nearest-rank p95 and do not mutate evidence', () => {
  const values = [4, 1, 2, 3];
  assert.deepEqual(statistics(values), { count: 4, min: 1, max: 4, mean: 2.5, median: 2.5, p95: 4 });
  assert.deepEqual(values, [4, 1, 2, 3]);
  assert.equal(statistics([]), null);
  assert.throws(() => statistics([NaN]));
});

test('schedule pairs both transports, alternates order, and separates warmups', () => {
  const schedule = trialSchedule(1, 2);
  assert.deepEqual(schedule.map(row => `${row.phase}:${row.transport}`), [
    'warmup:logcat', 'warmup:direct', 'measured:logcat', 'measured:direct', 'measured:direct', 'measured:logcat',
  ]);
});

const container = { nodePath: '0.1', visibleToUser: true, resourceId: 'list', bounds: '[0,100][1000,2000]' };
const label = (text, nodePath = '0.1.1', position = '[10,1800][900,1900]') =>
  ({ nodePath, text, visibleToUser: true, resourceId: 'android:id/title', bounds: position });

test('endpoint requires fully visible last label inside the expected container', () => {
  assert.equal(endpointVisible(viewport([container, label('End')], 'list'), 'End'), true);
  assert.equal(endpointVisible(viewport([container, label('End'), label('Later', '0.1.2')], 'list'), 'End'), false);
  assert.equal(endpointVisible(viewport([container, label('End', '0.1.1', '[10,1990][900,2050]')], 'list'), 'End'), false);
  assert.throws(() => viewport([container, label('End', '0.2.1')], 'list'));
  assert.throws(() => viewport([container, container, label('End')], 'list'));
});

test('stability signature detects actual viewport movement and ignores changing summaries', () => {
  const before = viewport([container, label('End'), { ...label('00:01'), resourceId: 'android:id/summary' }], 'list');
  const same = viewport([container, label('End'), { ...label('00:02'), resourceId: 'android:id/summary' }], 'list');
  const moved = viewport([container, label('End', '0.1.1', '[10,1700][900,1800]')], 'list');
  assert.equal(before.signature, same.signature);
  assert.notEqual(before.signature, moved.signature);
  assert.deepEqual(swipeParams(before, 'down'), { start: { x: 500, y: 1620 }, end: { x: 500, y: 480 }, durationMs: 300 });
});

test('a briefly visible selection target cannot pass the pre-click stability check', () => {
  const before = viewport([container, label('About', '0.1.1', '[10,1900][900,1970]')], 'list');
  const moving = viewport([container, label('About', '0.1.1', '[10,1930][900,2000]')], 'list');
  const gone = viewport([container, { ...label('About'), visibleToUser: false }, label('Other', '0.1.2')], 'list');
  assert.equal(targetStable(before, moving, 'About'), false);
  assert.equal(targetStable(before, gone, 'About'), false);
  assert.equal(targetStable(before, before, 'About'), true);
});

test('failed runs remain visible and warmups never enter successful latency aggregates', () => {
  const pass = { phase: 'measured', transport: 'logcat', passed: true, totalMs: 10, commandCount: 2,
    snapshotBytes: 100, nodeCount: 3, screenshotBytes: 50, stages: { screenshot: 4 }, commands: [] };
  const result = summarize([pass, { ...pass, phase: 'warmup', totalMs: 1000 },
    { phase: 'measured', transport: 'logcat', passed: false, pair: 1, error: 'timeout', failedStage: 'mainBottom' }]);
  assert.equal(result.logcat.attempted, 2);
  assert.equal(result.logcat.passed, 1);
  assert.equal(result.logcat.failed, 1);
  assert.equal(result.logcat.totalMs.median, 10);
  assert.equal(result.logcat.failures[0].error, 'timeout');
  assert.equal(result.direct.totalMs, null);
});

test('Android timing aggregation correlates command IDs and exposes missing evidence', async () => {
  const { summarizeAndroidTimings } = await import('./settings-flow-core.mjs');
  const trials = [{ phase: 'measured', transport: 'direct', passed: true, commands: [
    { commandId: 'one', snapshotExpected: true, stage: 'finalSnapshot' },
    { commandId: 'missing', snapshotExpected: true, stage: 'mainBottom' },
    { commandId: 'verify', snapshotExpected: true, stage: 'verifyScreenshot' },
  ] }];
  const result = summarizeAndroidTimings(trials,
    '[SnapshotTiming] commandId=unrelated operatorSnapshotUs=100000\n' +
    '[SnapshotTiming] commandId=one operatorSnapshotUs=2500 hierarchyBytes=800\n' +
    '[SnapshotTiming] commandId=verify operatorSnapshotUs=9000');
  assert.equal(result.direct.expectedCommands, 2);
  assert.equal(result.direct.observedCommands, 1);
  assert.equal(result.direct.fields.operatorSnapshotUs.median, 2500);
});

test('summary evidence drops raw results and replaces every device identifier', async () => {
  const { timingOnlyTrial, redactDeviceIdentifier } = await import('./settings-flow-core.mjs');
  const trial = { error: 'TEST-DEVICE unavailable: TEST-DEVICE', commands: [
    { wallMs: 10, result: { envelope: { text: 'private hierarchy', screenshot: 'private path' } } },
  ] };
  const serialized = redactDeviceIdentifier(JSON.stringify(timingOnlyTrial(trial)), 'TEST-DEVICE', 'Physical test device');
  assert.equal(serialized.includes('TEST-DEVICE'), false);
  assert.equal(serialized.includes('private'), false);
  assert.equal(JSON.parse(serialized).commands[0].wallMs, 10);
  assert.equal(trial.commands[0].result.envelope.text, 'private hierarchy');
});

test('summary-only CLI requires an alias and redacts failed ADB command output', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('./settings-flow.mjs', import.meta.url));
  const noAlias = spawnSync(process.execPath, [script, '--summary-only'], { encoding: 'utf8' });
  assert.equal(noAlias.status, 1);
  assert.match(noAlias.stderr, /requires --device-label/);
  const directory = mkdtempSync(join(tmpdir(), 'settings-privacy-test-'));
  try {
    writeFileSync(join(directory, 'adb'), '#!/usr/bin/env node\nprocess.stderr.write(process.argv.join(" "));process.exit(1);\n', { mode: 0o700 });
    const profile = fileURLToPath(new URL('./profiles/settings-api35.json', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--device', 'TEST-DEVICE', '--profile', profile,
      '--apk', 'unused.apk', '--summary-only', '--device-label', 'Physical test device'],
    { encoding: 'utf8', env: { ...process.env, PATH: directory + delimiter + process.env.PATH } });
    assert.equal(result.status, 1);
    assert.equal((result.stdout + result.stderr).includes('TEST-DEVICE'), false);
    assert.match(result.stderr, /Physical test device/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
