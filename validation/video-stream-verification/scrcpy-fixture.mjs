import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runVideoWorker } from '../../apps/node/dist/domain/evidence/videoWorker.js';
import { atomicJson } from '../../apps/node/dist/domain/evidence/videoSupport.js';
import { stopVideo } from '../../apps/node/dist/domain/evidence/video.js';

// Fake only scrcpy transport. Real H.264 parameter changes, splitting, encoding and decoding exercise the worker.
export async function verifyDimensionChanges(root, runner) {
  const run = async (command, args) => {
    const result = await runner.run(command, args, { timeoutMs: 120000 });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout;
  };
  const chunks = [];
  for (const [index, size] of ['320x240', '240x320', '320x240'].entries()) {
    const file = join(root, `geometry-${index}.h264`);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=60:duration=1`,
      '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-bf', '0', '-g', '60', '-f', 'h264', file]);
    chunks.push(await readFile(file));
  }
  const raw = join(root, 'geometry.h264'), source = join(root, 'geometry.mkv');
  await writeFile(raw, Buffer.concat(chunks));
  // Closely spaced VFR frames reproduce nominal-timebase rounding seen during live rotation.
  await run('ffmpeg', ['-v', 'error', '-fflags', '+genpts', '-r', '60', '-i', raw, '-c', 'copy', '-bsf:v', "setts=time_base=1/1000:pts='if(eq(mod(N,60),30),floor((N-1)*1001/60)+1,floor(N*1001/60))':dts=PTS", source]);
  const sourceFrames = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', source])).frames;
  const outputDir = join(root, 'scrcpy-worker');
  await mkdir(outputDir);
  const sessionId = randomUUID();
  const state = { sessionId, nonce: randomUUID(), outputDir, lockPath: join(outputDir, 'lock.json'), managed: false,
    deviceId: 'test-device', operatorPackage: 'com.example.operator', adbPath: 'fixture-adb', durationSeconds: 10,
    size: '320x240', hostPid: null, hostStartedAt: null, remotePid: null, remoteStart: null,
    remotePath: `/data/local/tmp/androperator-video-${sessionId}.mp4`, deadline: 0,
    updatedAt: Date.now(), recoveryRequired: false, backend: 'scrcpy', maxEdge: 320 };
  const manifestPath = join(outputDir, 'manifest.json');
  await atomicJson(join(outputDir, 'session.json'), state);
  await atomicJson(join(outputDir, 'stop.json'), { nonce: state.nonce });
  await atomicJson(state.lockPath, { sessionId, nonce: state.nonce });
  await atomicJson(manifestPath, { schemaVersion: 1, evidenceId: sessionId, label: null, context: { verdict: 'failed' },
    device: { serial: state.deviceId, operatorPackage: state.operatorPackage, cliVersion: null, operatorVersion: null,
      apiLevel: null, androidVersion: null, manufacturer: null, model: null, deviceType: 'unknown',
      deviceTypeProperties: { 'ro.kernel.qemu': null, 'ro.boot.qemu': null },
      display: { width: 320, height: 240, density: null, rotation: 0 } },
    startedAt: new Date().toISOString(), finishedAt: null, status: 'starting', artifacts: [], errors: [],
    video: { requestedDurationSeconds: 10, hostDurationMs: 0, mediaDurationMs: null, requestedSize: state.size,
      actualSize: null, codec: null, stopReason: null } });
  await copyFile(source, join(outputDir, 'capture.partial.mkv'));
  let spawns = 0;
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill(signal) {
    assert.equal(signal, 'SIGINT'); queueMicrotask(() => child.emit('close', 0));
  } });
  await runVideoWorker(outputDir, { run: runner.run.bind(runner), runShell: () => { throw new Error('No shell'); },
    spawn: command => { assert.equal(command, 'scrcpy'); spawns++; return child; } });
  const before = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(before);
  assert.equal(manifest.status, 'complete', JSON.stringify(manifest.errors));
  assert.equal(manifest.video.actualSize, null);
  assert.equal(manifest.context.verdict, 'failed');
  const videos = manifest.artifacts.filter(artifact => artifact.kind === 'video');
  assert.equal(videos.length, 3);
  for (const [index, artifact] of videos.entries()) {
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
      '-show_entries', 'frame=width,height,best_effort_timestamp_time', '-of', 'json', join(outputDir, artifact.path)]));
    assert.equal(probe.frames.length, 60, 'Every captured frame must survive the split');
    assert.deepEqual([...new Set(probe.frames.map(frame => `${frame.width}x${frame.height}`))], [index === 1 ? '240x320' : '320x240']);
    assert.equal(Number(probe.frames[0].best_effort_timestamp_time), 0);
    const sourceStart = Number(sourceFrames[index * 60].best_effort_timestamp_time);
    for (const [frameIndex, frame] of probe.frames.entries()) {
      const expected = Number(sourceFrames[index * 60 + frameIndex].best_effort_timestamp_time) - sourceStart;
      assert.ok(Math.abs(Number(frame.best_effort_timestamp_time) - expected) < 0.00001, 'Preserve every source timestamp after rebasing');
    }
  }
  assert.equal(spawns, 1, 'Folding must not restart capture');
  await assert.rejects(stat(join(outputDir, 'capture.partial.mkv')));
  await assert.rejects(stat(state.lockPath));
  assert.equal((await stopVideo({ session: manifestPath })).ok, true);
  assert.equal(await readFile(manifestPath, 'utf8'), before);
  console.log('PASS: one continuous capture, three independent MP4 sizes, all frames preserved, immutable stop');
}
