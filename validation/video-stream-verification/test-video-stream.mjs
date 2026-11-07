import { verifyDimensionChanges } from './scrcpy-fixture.mjs';
import { verifyWorkerFailure } from './worker-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoProcessRunner } from '../../apps/node/dist/domain/evidence/videoProcessRunner.js';
import { verifyVideo } from '../../apps/node/dist/domain/evidence/videoWorker.js';

// Real codecs are required: fake process output cannot prove tail decoding or VFR timing.
const runner = new VideoProcessRunner();
const root = await mkdtemp(join(tmpdir(), 'video-stream-verification-'));
async function run(command, args, timeoutMs = 120000) {
  const result = await runner.run(command, args, { timeoutMs });
  assert.equal(result.code, 0, `${command}: ${result.stderr}`);
  return result.stdout;
}
async function generate(name, size, duration, filter) {
  const path = join(root, name + '.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=60:duration=${duration}`,
    ...(filter ? ['-vf', filter] : []), '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast',
    '-g', '60', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], 300000);
  return path;
}
try {
  await verifyDimensionChanges(root, runner);
  const sparseRoot = join(root, 'sparse-tail');
  await mkdir(sparseRoot);
  await verifyDimensionChanges(sparseRoot, runner, true);
  const valid = await generate('valid', '320x240', 3);
  assert.equal((await verifyVideo(runner, valid, '320x240')).mediaDurationMs, 3000);
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-of', 'json', valid]));
  const packet = probe.packets.at(-5);
  assert.ok(Number(packet.pts_time) > 2.5);
  const bytes = await readFile(valid);
  // Break the AVCC NAL length in a late packet while leaving the MP4 tables and opening frames intact.
  bytes.writeUInt32BE(0xffffffff, Number(packet.pos));
  const corrupt = join(root, 'corrupt-late.mp4');
  await writeFile(corrupt, bytes);
  await run('ffmpeg', ['-v', 'error', '-xerror', '-i', corrupt, '-frames:v', '1', '-f', 'framemd5', '-']);
  let metadata;
  await assert.rejects(verifyVideo(runner, corrupt, '320x240', value => { metadata = value; }),
    error => /Full video decode failed/.test(error.message));
  assert.deepEqual(metadata, { codec: 'h264', actualSize: '320x240', mediaDurationMs: 3000 });
  await verifyWorkerFailure(root, corrupt, runner);
  const truncated = join(root, 'truncated.mp4');
  await writeFile(truncated, (await readFile(valid)).subarray(0, Number(packet.pos) + 10));
  await assert.rejects(verifyVideo(runner, truncated, '320x240'));
  const variable = await generate('variable', '320x240', 3, 'select=eq(mod(n\\,10)\\,0)+eq(mod(n\\,10)\\,1)');
  await verifyVideo(runner, variable, '320x240');
  const timestamps = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'json', variable])).frames.map(f => Number(f.pts_time));
  assert.ok(new Set(timestamps.slice(1).map((t, i) => Math.round((t - timestamps[i]) * 1000))).size > 1);
  // Both orientations of the default maximum and an explicit full-HD size at the duration cap.
  for (const size of ['720x1280', '1280x720', '1920x1080']) {
    const path = await generate('maximum-' + size, size, 180);
    const started = performance.now();
    assert.equal((await verifyVideo(runner, path, size)).mediaDurationMs, 180000);
    console.log(`${size}, 180 s, 60 fps: full verification ${(performance.now() - started).toFixed(0)} ms`);
  }
  // Keep fixture media only on an explicit local diagnostic run.
  if (process.env.VIDEO_FIXTURE_OUTPUT) {
    for (const [source, name] of [[valid, 'valid.mp4'], [corrupt, 'corrupt-late.mp4'], [variable, 'variable.mp4']]) {
      await copyFile(source, join(process.env.VIDEO_FIXTURE_OUTPUT, name));
    }
  }
  console.log('PASS: full streams, corrupt late packet, truncated tail, VFR timing, maximum-duration budgets');
} finally { await rm(root, { recursive: true, force: true }); }
