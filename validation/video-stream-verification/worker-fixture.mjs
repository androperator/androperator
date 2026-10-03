import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runVideoWorker } from '../../apps/node/dist/domain/evidence/videoWorker.js';
import { atomicJson } from '../../apps/node/dist/domain/evidence/videoSupport.js';
import { stopVideo } from '../../apps/node/dist/domain/evidence/video.js';

// Fake only recorder transport; pulled bytes and media subprocesses are real.
export async function verifyWorkerFailure(root, media, mediaRunner) {
  const outputDir = join(root, 'worker');
  await mkdir(outputDir);
  const sessionId = randomUUID();
  const state = { sessionId, nonce: randomUUID(), outputDir, lockPath: join(outputDir, 'lock.json'), managed: false,
    deviceId: 'test-device', operatorPackage: 'com.example.operator', adbPath: 'fixture-adb', durationSeconds: 1,
    size: '320x240', hostPid: null, hostStartedAt: null, remotePid: null, remoteStart: null,
    remotePath: `/data/local/tmp/androperator-video-${sessionId}.mp4`, deadline: Date.now() + 1000,
    updatedAt: Date.now(), recoveryRequired: false };
  const manifestPath = join(outputDir, 'manifest.json');
  await atomicJson(join(outputDir, 'session.json'), state);
  await atomicJson(state.lockPath, { sessionId, nonce: state.nonce });
  await atomicJson(manifestPath, { schemaVersion: 1, evidenceId: sessionId, label: null, context: { originalVerdict: 'failed' },
    device: { serial: state.deviceId, operatorPackage: state.operatorPackage, cliVersion: null, operatorVersion: null,
      apiLevel: null, androidVersion: null, manufacturer: null, model: null, deviceType: 'unknown',
      deviceTypeProperties: { 'ro.kernel.qemu': null, 'ro.boot.qemu': null },
      display: { width: 320, height: 240, density: null, rotation: null } },
    startedAt: new Date().toISOString(), finishedAt: null, status: 'starting', artifacts: [], errors: [],
    video: { requestedDurationSeconds: 1, hostDurationMs: 0, mediaDurationMs: null, requestedSize: state.size,
      actualSize: null, codec: null, stopReason: null } });
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => { throw new Error('Unexpected kill'); } });
  let spawns = 0, pulls = 0;
  const runner = {
    spawn: () => { spawns++; queueMicrotask(() => child.stdout.emit('data', Buffer.from('123\n'))); return child; },
    run: async (command, args, options) => {
      if (command !== 'fixture-adb') return mediaRunner.run(command, args, options);
      let stdout = '';
      if (args.some(arg => arg.endsWith('/cmdline'))) stdout = `screenrecord\0--size\0${state.size}\0--time-limit\0${1}\0${state.remotePath}\0`;
      else if (args.some(arg => arg.endsWith('/stat'))) stdout = '123 (screenrecord) ' + [...Array(19).fill('0'), '456'].join(' ');
      else if (args.includes('pull')) { pulls++; await copyFile(media, args.at(-1)); }
      else throw new Error('Unexpected recorder operation: ' + args.join(' '));
      return { code: 0, stdout, stderr: '' };
    },
  };
  let now = Date.now(), sleeps = 0;
  await runVideoWorker(outputDir, runner, { now: () => now, monotonic: () => now,
    sleep: async ms => { now += ms; if (++sleeps === 3) child.emit('close', 0); } });
  const before = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(before);
  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.context.originalVerdict, 'failed');
  assert.equal(manifest.video.mediaDurationMs, 3000);
  assert.equal(manifest.video.codec, 'h264');
  assert.equal(manifest.video.actualSize, state.size);
  assert.match(manifest.errors[0].message, /Full video decode failed/);
  assert.deepEqual(await readFile(join(outputDir, 'video.partial.mp4')), await readFile(media));
  assert.equal(manifest.artifacts[0].sha256, createHash('sha256').update(await readFile(media)).digest('hex'));
  await assert.rejects(stat(join(outputDir, 'video.mp4')));
  await assert.rejects(stat(state.lockPath));
  for (let i = 0; i < 2; i++) assert.equal((await stopVideo({ session: manifestPath })).ok, false);
  assert.equal(await readFile(manifestPath, 'utf8'), before);
  assert.equal(spawns, 1);
  assert.equal(pulls, 1);
}
