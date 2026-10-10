import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFullResolutionAcquirer} from '../../examples/skills/utils/render_full_resolution.mjs';
import {createRenderVerifier} from '../../apps/node/dist/renderVerification.js';
const {PNG} = createRequire(new URL('../../apps/node/package.json', import.meta.url))('pngjs');
const receipt = {commandId:'click-1',taskId:'task-1',status:'success',stepResults:[{id:'click',actionType:'click',success:true,data:{}}]};
const options = {action:receipt,deviceId:'test-device',conditionId:'destination',timeoutMs:1000,reducedAttempts:0};
async function fixture(t, fault) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'render-example-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  const commands=[];let snapshot=0,displays=0;
  const run=async (program,args,budget)=>{
    assert.ok(budget.timeout>0&&budget.timeout<=1000);assert.ok(budget.signal instanceof AbortSignal);
    assert.ok(args.includes('test-device'));
    if(program==='adb') {
      displays++;
      return {stdout:`DisplayViewport{valid=true, isActive=true, displayId=0, uniqueId='local:1', orientation=${fault==='rotation'&&displays===2?1:0}, logicalFrame=Rect(0, 0 - 8, 8)}`};
    }
    const command=args[1];commands.push(command);
    assert.ok(args.includes('--no-daemon'));assert.ok(args.includes('com.androperator.operator.dev'));
    if(command==='doctor')return {stdout:JSON.stringify({criticalOk:fault!=='locked',checks:[{id:'readiness.device.interactive',status:fault==='locked'?'fail':'pass'}]})};
    if(command==='snapshot'){
      const id=String(++snapshot);
      return {stdout:JSON.stringify({envelope:{commandId:id,taskId:id,status:'success',stepResults:[{actionType:'snapshot',success:true,data:{foreground_package:'test.app',has_overlay:fault==='overlay'?'true':'false',window_count:'1'}}]},compact:{commandId:id,taskId:id,truncated:false,nodes:[{text:'Destination'}]}})};
    }
    assert.equal(command,'screenshot');
    if(fault==='transport')throw Error('private-token');
    await fs.writeFile(args[args.indexOf('--path')+1],PNG.sync.write(new PNG({width:8,height:8})));
    return {stdout:JSON.stringify({envelope:receipt})};
  };
  const acquire=createFullResolutionAcquirer({directory,run});
  return {directory,commands,acquire};
}
test('full-resolution example captures real file bytes with canonical read-only commands and current context',async t=>{
  const f=await fixture(t);let verifies=0;
  const run=createRenderVerifier({acquire:f.acquire,verify:async(frame,condition)=>{
    verifies++;assert.equal(condition,'destination');assert.equal(frame.deviceId,'test-device');
    assert.equal(frame.evidence.before.compact.nodes[0].text,'Destination');
    assert.equal(frame.png.readUInt32BE(16),8);
    return {semantic:{matched:true,reason:'fixture semantic condition'},visual:{matched:true,reason:'fixture pixel condition'}};
  }});
  const result=await run(options);assert.equal(result.code,'RENDER_VERIFIED');assert.equal(verifies,1);
  assert.deepEqual(f.commands,['doctor','snapshot','screenshot','snapshot','doctor']);
  assert.deepEqual(result.action,receipt);assert.equal(result.attempts[0].requestedScale,1);
});
test('full-resolution example fails closed on readiness, overlays, rotation and transport errors',async t=>{
  for(const [fault,reason] of [['locked','device_not_ready'],['overlay','unsafe_observation'],['rotation','unsafe_observation'],['transport','capture_unavailable']]){
    const f=await fixture(t,fault);
    const run=createRenderVerifier({acquire:f.acquire,verify:async()=>{throw Error('must not verify unsafe input');}});
    const result=await run(options);assert.equal(result.code,'RENDER_CALLBACK_FAILED');
    assert.deepEqual(result.failure,{stage:'acquire',reason});assert.equal(result.attempts.length,1);
    assert.ok(!JSON.stringify(result).includes('private-token'));
    assert.equal(f.commands.filter(c=>c==='screenshot').length,['locked','overlay'].includes(fault)?0:1);
  }
});
test('example CLI rejects missing or relative arguments with usage and exit 1 before device work',async()=>{
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const example=new URL('../../examples/skills/utils/render_full_resolution.mjs',import.meta.url).pathname;
  for(const args of [[],['private-token','relative-action.json','/verifier.mjs','/output','destination']]) {
    await assert.rejects(promisify(execFile)(process.execPath,[example,...args]),error=>{
      assert.equal(error.code,1);assert.equal(error.stdout,'');
      assert.match(error.stderr,/Usage: node render_full_resolution/);
      assert.ok(!error.stderr.includes('private-token'));return true;
    });
  }
});
