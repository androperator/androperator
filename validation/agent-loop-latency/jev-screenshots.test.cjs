const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRunner, mayFallback} = require('./jev-screenshots.cjs');
const {viewportFromCapture} = require('../../examples/skills/utils/settings_version_runtime');

test('scaled viewport preserves native geometry and rejects mismatched rounding', () => {
  const png=Buffer.alloc(24); png.writeUInt32BE(270,16); png.writeUInt32BE(602,20);
  const data={backend:'experimental-direct-buffer',sourceWidthPx:1080,sourceHeightPx:2410,
    captureWidthPx:270,captureHeightPx:602,requestedScale:0.25};
  const response={envelope:{stepResults:[{actionType:'take_screenshot',data}]}};
  assert.equal(viewportFromCapture(png,response).height,2410);
  data.sourceHeightPx=2400;
  assert.throws(()=>viewportFromCapture(png,response),/geometry/);
  assert.deepEqual(viewportFromCapture(png,{}),{width:270,height:602,sourceKind:'image-dimensions'});
});

test('closed helper falls back once, disables direct capture and never replays actions', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jev-capture-test-'));
  const calls=[];
  let captures=0;
  const runner=createRunner({mode:'quarter',device:'test-device',directory,
    selectDisplay:()=>({width:1080,height:2410,rotation:0,physicalId:'1'}),
    startSession:()=>({capture:async()=>{captures++;throw Error('Capture session closed');},close:async()=>{}}),
    runCli:(args,options)=>{calls.push({args,timeout:options.timeout});return {status:0,stdout:'{}'};}});
  try {
    await runner.execute(['click','--text','test'],{timeout:20000});
    for(let i=0;i<2;i++) await runner.execute(['screenshot','--path',path.join(directory,`${i}.png`)],{timeout:20000});
    assert.equal(captures,1);
    assert.deepEqual(calls.map(c=>c.args[0]),['click','screenshot','screenshot']);
    assert.ok(calls[1].timeout<20000);
    assert.equal(fs.readFileSync(path.join(directory,'screenshot-attempts.ndjson'),'utf8').trim().split('\n').length,3);
    for(const reason of ['Display geometry changed','Display is not interactive or is locked','Secure capture cannot be published','HDR behavior is not validated']) assert.equal(mayFallback(Error(reason)),false);
  } finally {await runner.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('policy or geometry failure stops instead of invoking stock capture', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jev-capture-test-'));
  const runner=createRunner({mode:'quarter',device:'test-device',directory,
    selectDisplay:()=>({width:1080,height:2410,rotation:0,physicalId:'1'}),
    startSession:()=>({capture:async()=>{throw Error('Secure capture cannot be published');},close:async()=>{}}),
    runCli:()=>{throw Error('Unexpected fallback');}});
  try {await assert.rejects(runner.execute(['screenshot','--path',path.join(directory,'test.png')],{timeout:20000}),/Secure capture/);}
  finally {await runner.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('transition mode routes the observation after a successful click to full resolution', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jev-capture-test-'));
  const calls=[];
  const runner=createRunner({mode:'quarter-transition',directory,
    runCli:args=>{calls.push(args[0]);return {status:0,stdout:'{}'};},
    selectDisplay:()=>{throw Error('Unexpected direct capture');}});
  try {
    await runner.execute(['click','--text','test'],{timeout:20000});
    await runner.execute(['screenshot','--path',path.join(directory,'test.png')],{timeout:20000});
    assert.deepEqual(calls,['click','screenshot']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'screenshot-attempts.ndjson'),'utf8')).backend,'stock-transition');
  } finally {await runner.close();fs.rmSync(directory,{recursive:true,force:true});}
});
