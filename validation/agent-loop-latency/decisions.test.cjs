const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createGate, rendered} = require('./decisions-screenshots.cjs');
const {validate} = require('./decisions.cjs');
const row = text => [{text, top: 0.09, confidence: 1}];

test('destination gate rejects the previous Settings frame after About click', async () => {
  assert.equal(rendered(row('Q Search Settings'), 'Settings'), true);
  const frames = [row('Search Settings'), row('About phone'), row('About phone')];
  const records = [], captures = [];
  const result = {status: 0, stdout: '{}'};
  const execute = createGate({capture: async args => {captures.push(args); return result;},
    fullCapture: async () => result, recognize: () => frames.shift(), record: r => records.push(r)});
  await execute(['click', '--text', 'About phone'], {timeout: 20000});
  assert.equal(await execute(['screenshot', '--path', '/unused.png'], {timeout: 20000}), result);
  assert.deepEqual(records.map(r => r.passed), [false, true, true]);
  assert.equal(captures.filter(a => a[0] === 'click').length, 1);
  assert.equal(captures.filter(a => a[0] === 'screenshot').length, 1);
});
test('destination gate fails closed when old page persists', async () => {
  let selected = 0;
  const execute = createGate({capture: async args => {if(args[0] === 'screenshot') selected++; return {status: 0};},
    fullCapture: async () => ({status: 0}), recognize: () => row('Search Settings'), record() {}});
  await execute(['click', '--text', 'About phone'], {timeout: 20000});
  await assert.rejects(execute(['screenshot', '--path', '/unused.png'], {timeout: 20000}), /not verified/);
  assert.equal(selected, 0);
  assert.equal(rendered([{text:'About phone', top:0.8, confidence:1}], 'About phone'), false);
});
test('Decisions accepts only allowed confident typed answers with valid distributions', () => {
  const response = {model:'gpt-6-luna',answers:[{type:'choice',name:'next_action',choice:'down',confidence:0.9,
    probabilities:[{value:'down',probability:0.9},{value:'escalate',probability:0.1}]}]};
  assert.equal(validate(response, ['down','escalate']), 'down');
  for (const change of [{choice:'tap'}, {confidence:0.59}, {type:'refusal'},
    {probabilities:[{value:'down',probability:0.9},{value:'down',probability:0.1}]}]) {
    assert.throws(() => validate({...response,answers:[{...response.answers[0],...change}]}, ['down','escalate']));
  }
});
test('unreadable reduced capture falls back to a fresh full image without action replay', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'render-gate-'));
  const output = path.join(directory, 'image.png');
  const frames = [row('About phone'), [], row('About phone'), row('About phone')];
  const calls = [], records = [];
  const capture = async args => {calls.push(['selected', ...args]); if(args[0] === 'screenshot') fs.writeFileSync(args[2], 'rejected'); return {status:0};};
  const fullCapture = async args => {calls.push(['full', ...args]); fs.writeFileSync(args[2], 'full'); return {status:0};};
  try {
    const execute = createGate({capture,fullCapture,recognize:()=>frames.shift(),record:r=>records.push(r)});
    await execute(['click','--text','About phone'], {timeout:20000});
    await execute(['screenshot','--path',output], {timeout:20000});
    assert.equal(fs.readFileSync(output,'utf8'), 'full');
    assert.equal(fs.readFileSync(output+'.rejected-1.png','utf8'), 'rejected');
    assert.equal(calls.filter(c=>c[1]==='click').length,1);
    assert.equal(records.at(-1).fullFallback,true);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test('all experimental scales retain native viewport geometry', () => {
  const {viewportFromCapture}=require('../../examples/skills/utils/settings_version_runtime');
  for(const scale of [1,0.5,0.25]) {
    const width=Math.floor(1080*scale),height=Math.floor(2410*scale);
    const png=Buffer.alloc(24);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
    const data={backend:'experimental-direct-buffer',sourceWidthPx:1080,sourceHeightPx:2410,
      requestedScale:scale,captureWidthPx:width,captureHeightPx:height};
    const response={envelope:{stepResults:[{actionType:'take_screenshot',data}]}};
    assert.equal(viewportFromCapture(png,response).height,2410);
    data.requestedScale=0.1;
    assert.throws(()=>viewportFromCapture(png,response),/geometry/);
  }
});
test('unsupported destinations are rejected before navigation', async () => {
  let calls=0;
  const execute=createGate({capture:async()=>{calls++;return {status:0};}});
  await assert.rejects(execute(['click','--text','Other page'],{timeout:20000}),/Unsupported destination/);
  assert.equal(calls,0);
});
test('reduced probe falls back to independently verified full pixels before selecting', async () => {
  const calls=[],records=[],frames=[[],row('About phone'),row('About phone')];
  const execute=createGate({reducedProbe:true,
    capture:async args=>{calls.push(['direct',...args]);return {status:0};},
    fullCapture:async args=>{calls.push(['full',...args]);return {status:0};},
    recognize:()=>frames.shift(),record:r=>records.push(r)});
  await execute(['click','--text','About phone'],{timeout:20000});
  await execute(['screenshot','--path','/unused.png'],{timeout:20000});
  assert.deepEqual(records.map(r=>[r.kind,r.passed]),[['probe',false],['probe-full-fallback',true],['selected',true]]);
  assert.deepEqual(calls.map(c=>c[0]),['direct','direct','full','direct']);
  assert.equal(calls.filter(c=>c[1]==='click').length,1);
});
test('a full fallback showing the old page cannot rescue a rejected reduced probe', async () => {
  let selected=0,full=0;
  const execute=createGate({reducedProbe:true,
    capture:async args=>{if(args[0]==='screenshot'&&!args[2].includes('render-probe'))selected++;return {status:0};},
    fullCapture:async()=>{full++;return {status:0};},recognize:()=>row('Search Settings'),record(){}});
  await execute(['click','--text','About phone'],{timeout:20000});
  await assert.rejects(execute(['screenshot','--path','/unused.png'],{timeout:20000}),/not verified/);
  assert.equal(full,3);assert.equal(selected,0);
});
test('recognized quarter probes do not capture full resolution', async () => {
  const calls=[];
  const execute=createGate({reducedProbe:true,capture:async args=>{calls.push(args);return {status:0};},
    fullCapture:async()=>{throw Error('Unexpected full probe');},recognize:()=>row('Search Settings'),record(){}});
  await execute(['screenshot','--path','/unused.png'],{timeout:20000});
  assert.equal(calls.length,2);
});
