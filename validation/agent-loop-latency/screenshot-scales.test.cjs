const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const nodeRequire = createRequire(require('node:path').resolve('apps/node/package.json'));
const {PNG} = nodeRequire('pngjs');
const {splitPacket, expectedSize, aggregate, experimentDisplay, validateDirectMetrics} = require('./screenshot-scales.cjs');
const {verifyScreenshot} = require('../../apps/node/dist/domain/observe/screenshotMetadata.js');

test('remote stderr trailer is separated without weakening PNG validation', () => {
  const png = PNG.sync.write(new PNG({width: 3, height: 5}));
  const packet = Buffer.concat([png, Buffer.from('SCALE_TIMING {"width":3}\n')]);
  const result = splitPacket(packet);
  assert.deepEqual(result.png, png);
  assert.equal(result.metrics.width, 3);
  assert.equal(verifyScreenshot(result.png).captureHeightPx, 5);
  assert.throws(() => splitPacket(png), /trailer/);
  assert.throws(() => splitPacket(Buffer.concat([packet, Buffer.from('unexpected output')])), /trailer/);
  assert.throws(() => splitPacket(packet.subarray(0, 20)), /Truncated/);
  const corrupted = Buffer.from(packet);
  corrupted[29] ^= 1;
  assert.throws(() => verifyScreenshot(splitPacket(corrupted).png));
});

test('quarter-size coordinates use actual rounded dimensions', () => {
  assert.deepEqual(expectedSize({width: 1080, height: 2410}, 25), {width:270, height:602});
});

test('direct capture proves smaller buffer geometry, rotation and ordered responses', () => {
  const metrics = {bufferWidth:270, bufferHeight:602, rotation:0, sequence:3, containsHdrLayers:false,
    deviceCaptureMs:10, readbackMs:2, encodeAndWriteMs:5};
  validateDirectMetrics(metrics, 270, 602, 0, 3);
  assert.throws(() => validateDirectMetrics({...metrics, bufferWidth:1080}, 270, 602, 0, 3), /geometry/);
  assert.throws(() => validateDirectMetrics(metrics, 270, 602, 1, 3), /geometry/);
  assert.throws(() => validateDirectMetrics(metrics, 270, 602, 0, 4), /sequence/);
  assert.throws(() => validateDirectMetrics({...metrics, containsHdrLayers:undefined}, 270, 602, 0, 3));
  assert.throws(() => validateDirectMetrics({...metrics, readbackMs:NaN}, 270, 602, 0, 3), /timing/);
});

test('aggregation excludes warmups and failures without hiding failure records', () => {
  const samples = [
    {variant:'25', success:true, warmup:true, captureMs:1},
    {variant:'25', success:false, warmup:false, captureMs:2},
    {variant:'25', success:true, warmup:false, captureMs:40},
    {variant:'25', success:true, warmup:false, captureMs:60},
  ];
  assert.equal(aggregate(samples)['25'].count, 2);
  assert.equal(aggregate(samples)['25'].captureMs.median, 50);
  assert.equal(samples.length, 4);
});

test('legacy display selection requires the explicit default local viewport', () => {
  const dump = 'mDefaultViewport=DisplayViewport{valid=true, displayId=0, uniqueId=\'null\', orientation=0, logicalFrame=Rect(0, 0 - 1344, 2992)} uniqueId="local:0"';
  assert.deepEqual(experimentDisplay(dump), {physicalId:'0', width:1344, height:2992, rotation:0});
  assert.throws(() => experimentDisplay(dump.replace('valid=true','valid=false')));
  assert.throws(() => experimentDisplay(''));
});
