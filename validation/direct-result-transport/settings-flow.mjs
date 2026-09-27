#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExecution } from '../../apps/node/dist/domain/executions/runExecution.js';
import { projectCompactSnapshot } from '../../apps/node/dist/domain/observe/compactSnapshot.js';
import { trialSchedule, viewport, hasLabel, endpointVisible, targetStable, swipeParams, summarize, summarizeAndroidTimings } from './settings-flow-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: {
  device: { type: 'string' }, profile: { type: 'string' }, apk: { type: 'string' },
  'operator-package': { type: 'string', default: 'com.clawperator.operator.dev' },
  warmups: { type: 'string', default: '3' }, measured: { type: 'string', default: '10' },
  'out-dir': { type: 'string' },
} });
const warmups = Number(values.warmups), measured = Number(values.measured);
for (const key of ['device', 'profile', 'apk', 'operator-package']) {
  if (!values[key]?.trim()) throw new Error(`--${key} is required and must be nonblank`);
}
if (!Number.isInteger(warmups) || warmups < 0 || warmups > 20 || !Number.isInteger(measured) || measured < 1 || measured > 100) {
  throw new Error('Use --warmups 0..20 --measured 1..100 (counts per transport)');
}
if (values['out-dir'] !== undefined && !values['out-dir'].trim()) throw new Error('--out-dir must be nonblank');
const profile = JSON.parse(readFileSync(values.profile, 'utf8'));
for (const key of ['name', 'apiLevel', 'mainReady', 'mainContainer', 'mainLastItem', 'detailEntry', 'detailReady', 'detailContainer', 'detailLastItem']) {
  if (typeof profile[key] !== 'string' || !profile[key].trim()) throw new Error(`Missing profile field: ${key}`);
}
const adb = (...args) => execFileSync('adb', ['-s', values.device, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }).trim();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
if (adb('get-state') !== 'device') throw new Error('Selected device is not ready');
if (adb('shell', 'getprop', 'ro.build.version.sdk') !== profile.apiLevel) throw new Error('Profile API level does not match device');
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const outputRoot = values['out-dir'] ?? join(homedir(), '.clawperator', 'timings', new Date().toISOString().slice(0, 10), encodeURIComponent(values.device));
const outDir = join(outputRoot, `settings-${runId}`);
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const save = (name, value) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const installedPath = adb('shell', 'pm', 'path', values['operator-package']).split('\n').find(line => line.endsWith('/base.apk'))?.replace(/^package:/, '');
if (!installedPath) throw new Error('Cannot locate installed Operator base APK');
const installedCopy = join(outDir, 'installed.apk');
adb('pull', installedPath, installedCopy);
const apkSha256 = sha256(values.apk), installedSha256 = sha256(installedCopy);
unlinkSync(installedCopy);
if (apkSha256 !== installedSha256) throw new Error('Installed Operator does not match --apk; install the branch build first');
const metadata = {
  runId, startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')),
  harnessSha256: sha256(fileURLToPath(import.meta.url)), coreSha256: sha256(join(root, 'validation/direct-result-transport/settings-flow-core.mjs')),
  nodeVersion: process.version, version: JSON.parse(readFileSync(join(root, 'apps/node/package.json'))).version,
  operatorPackage: values['operator-package'], apkSha256, profile, warmups, measured,
  device: values.device, model: adb('shell', 'getprop', 'ro.product.model'),
  androidVersion: adb('shell', 'getprop', 'ro.build.version.release'), buildFingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'),
  display: adb('shell', 'wm', 'size'), density: adb('shell', 'wm', 'density'),
  animations: Object.fromEntries(['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'].map(key => [key, adb('shell', 'settings', 'get', 'global', key)])),
  method: 'Persistent Node API; same APK; alternating AB/BA pairs; reset excluded; 300 ms swipes and 300 ms settling; endpoint and pre-click target each require two stable viewport confirmations; no automatic action retries.',
};
save('metadata.json', metadata);
console.log(JSON.stringify({ event: 'started', outDir, metadata }));
const trials = [];
let activeTrial, activeStage;
const sleep = { id: 'settle', type: 'sleep', params: { durationMs: 300 } };
const snapshot = { id: 'snapshot', type: 'snapshot' };
const matcher = text => ({ textEquals: text, resourceId: 'android:id/title' });

async function command(actions) {
  const commandId = `settings-benchmark-${randomUUID()}`;
  const transportTimings = [], screenshotAdbMs = [];
  const logger = {
    emit(event) {
      if (event.event === 'transport.direct.timing') transportTimings.push(JSON.parse(event.message));
      if (event.event === 'adb.complete' && event.message.includes('exec-out screencap')) {
        const match = /durationMs=(\d+)/.exec(event.message);
        if (match) screenshotAdbMs.push(Number(match[1]));
      }
    },
    status() { return { status: 'disabled' }; }, logPath() { return undefined; }, child() { return this; },
  };
  const started = performance.now();
  const result = await runExecution({ commandId, taskId: `settings-${runId}`, source: 'debug',
    expectedFormat: 'android-ui-automator', timeoutMs: 20000, actions },
  { deviceId: values.device, operatorPackage: values['operator-package'], resultTransport: activeTrial.transport, logger });
  const record = { commandId, stage: activeStage, wallMs: performance.now() - started, transportTimings, screenshotAdbMs,
    snapshotExpected: actions.some(action => action.type === 'snapshot'), result };
  activeTrial.commands.push(record);
  if (!result.ok || result.envelope.status !== 'success' || actions.some(action => !result.envelope.stepResults.some(step => step.id === action.id && step.success))) {
    throw new Error(`Command failed: ${result.ok ? result.envelope.errorCode ?? result.envelope.stepResults.find(step => !step.success)?.data.errorCode ?? result.envelope.status : result.error?.code ?? 'transport failure'}`);
  }
  return result.envelope;
}

function readSnapshot(envelope) {
  const xml = envelope.stepResults.find(step => step.actionType === 'snapshot')?.data.text;
  if (typeof xml !== 'string' || !xml.trimEnd().endsWith('</hierarchy>')) throw new Error('Missing complete hierarchy');
  const projected = projectCompactSnapshot(xml, { commandId: envelope.commandId, taskId: envelope.taskId }, { compact: true, maxNodes: 1000, maxTextChars: 4096 });
  if (projected.truncated) throw new Error('Snapshot projection truncated; cannot verify endpoint');
  return { nodes: projected.nodes, xml, nodeCount: projected.totalNodes };
}

async function stage(name, work) {
  activeStage = name;
  const started = performance.now();
  try { return await work(); }
  finally { activeTrial.stages[name] = performance.now() - started; }
}

async function scrollToBottom(initial, containerId, lastItem) {
  let current = initial, stable = 0;
  for (let scrolls = 1; scrolls <= 20; scrolls++) {
    const before = viewport(current.nodes, containerId);
    current = readSnapshot(await command([{ id: 'swipe', type: 'swipe', params: swipeParams(before, 'down') }, sleep, snapshot]));
    const after = viewport(current.nodes, containerId);
    stable = endpointVisible(after, lastItem) && before.signature === after.signature ? stable + 1 : 0;
    if (stable >= 2) {
      activeTrial.scrollCounts[activeStage] = scrolls;
      return current;
    }
  }
  throw new Error(`Bottom not verified within 20 swipes: ${lastItem}`);
}

async function runTrial(spec) {
  activeTrial = { ...spec, passed: false, stages: {}, scrollCounts: {}, commands: [] };
  let started;
  try {
    await stage('reset', () => command([{ id: 'close', type: 'close_app', params: { applicationId: 'com.android.settings' } }]));
    started = performance.now();
    let screen = await stage('openReady', async () => readSnapshot(await command([
      { id: 'open', type: 'open_app', params: { applicationId: 'com.android.settings' } },
      { id: 'ready', type: 'wait_for_node', params: { matcher: matcher(profile.mainReady), timeoutMs: 8000 } }, sleep, snapshot,
    ])));
    if (!hasLabel(viewport(screen.nodes, profile.mainContainer), profile.mainReady)) throw new Error('Initial Settings page not verified');
    screen = await stage('mainBottom', () => scrollToBottom(screen, profile.mainContainer, profile.mainLastItem));
    screen = await stage('selectDetail', async () => {
      let swipes = 0, stable = 0, direction = 'up';
      for (let observation = 0; observation < 20 && stable < 2; observation++) {
        const before = viewport(screen.nodes, profile.mainContainer);
        const visible = hasLabel(before, profile.detailEntry);
        const actions = visible ? [sleep, snapshot] : [
          { id: 'swipe', type: 'swipe', params: swipeParams(before, direction) }, sleep, snapshot,
        ];
        if (!visible) swipes++;
        screen = readSnapshot(await command(actions));
        const after = viewport(screen.nodes, profile.mainContainer);
        stable = targetStable(before, after, profile.detailEntry) ? stable + 1 : 0;
        // A residual fling can carry a briefly visible row past the viewport.
        // Reveal it in the opposite direction before any click is dispatched.
        if (visible && !hasLabel(after, profile.detailEntry)) direction = direction === 'up' ? 'down' : 'up';
      }
      if (stable < 2) throw new Error('Detail entry did not become stable within 20 observations');
      activeTrial.scrollCounts.selectDetail = swipes;
      const detail = readSnapshot(await command([
        { id: 'select', type: 'click', params: { matcher: matcher(profile.detailEntry) } },
        { id: 'ready', type: 'wait_for_node', params: { matcher: matcher(profile.detailReady), timeoutMs: 8000 } }, sleep, snapshot,
      ]));
      if (!hasLabel(viewport(detail.nodes, profile.detailContainer), profile.detailReady)) throw new Error('Detail page not verified');
      return detail;
    });
    screen = await stage('detailBottom', () => scrollToBottom(screen, profile.detailContainer, profile.detailLastItem));
    const final = await stage('finalSnapshot', async () => readSnapshot(await command([snapshot])));
    if (viewport(final.nodes, profile.detailContainer).signature !== viewport(screen.nodes, profile.detailContainer).signature) throw new Error('Final hierarchy moved after endpoint verification');
    const screenshotPath = join(outDir, `${spec.phase}-${spec.pair}-${spec.transport}.png`);
    const image = await stage('screenshot', async () => (await command([{ id: 'screenshot', type: 'take_screenshot', params: { path: screenshotPath } }])).stepResults.find(step => step.id === 'screenshot').data);
    activeTrial.totalMs = performance.now() - started;
    const png = readFileSync(screenshotPath);
    if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16) !== Number(image.captureWidthPx) || png.readUInt32BE(20) !== Number(image.captureHeightPx)) throw new Error('Screenshot dimensions or PNG invalid');
    const after = await stage('verifyScreenshot', async () => readSnapshot(await command([snapshot])));
    if (viewport(after.nodes, profile.detailContainer).signature !== viewport(final.nodes, profile.detailContainer).signature) throw new Error('Screen moved during screenshot');
    activeTrial.captureWidthPx = Number(image.captureWidthPx);
    activeTrial.captureHeightPx = Number(image.captureHeightPx);
    const previous = trials.find(trial => trial.passed);
    if (previous && (previous.captureWidthPx !== activeTrial.captureWidthPx || previous.captureHeightPx !== activeTrial.captureHeightPx)) {
      throw new Error('Capture dimensions changed during comparison; keep device orientation and posture fixed');
    }
    activeTrial.snapshotBytes = Buffer.byteLength(final.xml);
    activeTrial.nodeCount = final.nodeCount;
    activeTrial.screenshotBytes = png.length;
    activeTrial.commandCount = activeTrial.commands.filter(item => !['reset', 'verifyScreenshot'].includes(item.stage)).length;
    activeTrial.passed = true;
  } catch (error) {
    activeTrial.failedStage = activeStage;
    activeTrial.error = error instanceof Error ? error.message : String(error);
    activeTrial.elapsedUntilFailureMs = started === undefined ? null : performance.now() - started;
  }
  const trial = activeTrial;
  // Persist raw evidence outside the measured interval. These files can contain device identifiers.
  save(`${spec.phase}-${spec.pair}-${spec.transport}.json`, trial);
  const compact = { ...trial, commands: trial.commands.map(({ result, ...record }) => record) };
  trials.push(compact);
  appendFileSync(join(outDir, 'trials.jsonl'), JSON.stringify(compact) + '\n', { mode: 0o600 });
  save('summary.json', { metadata, results: summarize(trials) });
  console.log(JSON.stringify({ ...spec, passed: trial.passed, totalMs: trial.totalMs, stages: trial.stages, scrollCounts: trial.scrollCounts, error: trial.error }));
}

const oldTimingProperty = adb('shell', 'getprop', 'log.tag.ClawpSnapshotTiming');
const logFd = openSync(join(outDir, 'android-snapshot-timing.log'), 'wx', 0o600);
let logcat;
try {
  adb('shell', 'setprop', 'log.tag.ClawpSnapshotTiming', 'DEBUG');
  logcat = spawn('adb', ['-s', values.device, 'logcat', '-T', '1', '-v', 'brief', '-s', 'ClawpSnapshotTiming:I', '*:S'], { stdio: ['ignore', logFd, logFd] });
  logcat.on('error', error => console.error(`Timing log capture failed: ${error.message}`));
  for (const spec of trialSchedule(warmups, measured)) await runTrial(spec);
} finally {
  if (logcat && logcat.exitCode === null && logcat.pid) {
    const exited = new Promise(resolve => logcat.once('close', resolve));
    logcat.kill();
    await exited;
  }
  closeSync(logFd);
  adb('shell', 'setprop', 'log.tag.ClawpSnapshotTiming', oldTimingProperty || "''");
}
save('summary.json', { metadata, results: summarize(trials),
  androidSnapshotTimings: summarizeAndroidTimings(trials, readFileSync(join(outDir, 'android-snapshot-timing.log'), 'utf8')) });
console.log(JSON.stringify({ event: 'completed', outDir, results: summarize(trials) }));
if (trials.some(trial => !trial.passed)) process.exitCode = 1;
