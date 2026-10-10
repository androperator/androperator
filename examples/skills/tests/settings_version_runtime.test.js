const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verifyEvidence}=require('../utils/settings_version_runtime');
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'version-proof-test-'));
 const env={VERSION_RUN_DIR:dir,ANDROPERATOR_DEVICE_ID:'test-device',ANDROPERATOR_RUN_ID:'test-run',ANDROPERATOR_SKILL_ID:'test-skill'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 const fields={androidVersion:{label:'Android version',value:'synthetic-release',snapshotIndex:0,readIndex:1,stepResultId:'read'},buildNumber:{label:'Build number',value:'synthetic.build',snapshotIndex:0,readIndex:2,stepResultId:'read'}};
 const nodes=Object.values(fields).flatMap((v,i)=>[{nodePath:String(i),parentPath:null},{nodePath:`${i}.0`,parentPath:`${i}`,text:v.label,resourceId:'android:id/title',visibleToUser:true,enabled:true},{nodePath:`${i}.1`,parentPath:`${i}`,text:v.value,resourceId:'android:id/summary',visibleToUser:true,enabled:true}]);
 const snap={envelope:{commandId:'s',taskId:'s',status:'success',stepResults:[{id:'snapshot',actionType:'snapshot',success:true,data:{foreground_package:'com.android.settings',has_overlay:'false'}}]},compact:{schemaVersion:1,commandId:'s',taskId:'s',nodes,truncated:false,totalNodes:nodes.length,returnedNodes:nodes.length,omittedNodes:0}};
 save('command-0.json',snap);
 const envelopes=[snap.envelope];
 for(const v of Object.values(fields)){const envelope={commandId:`r${v.readIndex}`,taskId:`r${v.readIndex}`,status:'success',stepResults:[{id:'read',actionType:'read_key_value_pair',success:true,data:{label:v.label,value:v.value}}]};save(`command-${v.readIndex}.json`,{envelope});envelopes.push(envelope);}
 const screenshotEnvelope={commandId:'png',taskId:'png',status:'success',stepResults:[{id:'png',actionType:'take_screenshot',success:true,data:{}}]};save('command-3.json',{envelope:screenshotEnvelope});envelopes.push(screenshotEnvelope);
 save('state.json',{fields});
 const events=['snapshot','read-value','read-value','screenshot'].map((arg,index)=>({index,args:[arg],exitCode:0,device:'test-device',runId:'test-run'}));save('events.json',events);
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);fs.writeFileSync(path.join(dir,'final.png'),png);
 const frame={status:'success',contractVersion:'1.0.0',skillId:'test-skill',terminalVerification:{status:'verified'},result:{kind:'json',value:{androidVersion:fields.androidVersion.value,buildNumber:fields.buildNumber.value,evidence:{androidVersion:{execEnvelopeIndex:1,stepResultId:'read'},buildNumber:{execEnvelopeIndex:2,stepResultId:'read'}}}},execEnvelopes:envelopes};
 return {dir,frame,events,save,cleanup(){fs.rmSync(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
}
test('result verifier rejects altered values, broken references, cross-device evidence and missing screenshot',()=>{
 const f=fixture();try{
 assert.equal(verifyEvidence(f.frame),true);
 const changed=structuredClone(f.frame);changed.result.value.buildNumber='generated';assert.throws(()=>verifyEvidence(changed));
 const reference=structuredClone(f.frame);reference.result.value.evidence.buildNumber.execEnvelopeIndex=1;assert.throws(()=>verifyEvidence(reference));
 f.events[1].device='other-device';f.save('events.json',f.events);assert.throws(()=>verifyEvidence(f.frame));f.events[1].device='test-device';f.save('events.json',f.events);
 const stored=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));f.save('state.json',{...stored,pendingOverlay:{package:'unreviewed'}});assert.throws(()=>verifyEvidence(f.frame),/Unreviewed/);f.save('state.json',stored);
 fs.unlinkSync(path.join(f.dir,'final.png'));assert.throws(()=>verifyEvidence(f.frame));
 }finally{f.cleanup();}
});
test('missing transport envelopes do not shift command evidence into invalid result references',()=>{
 const f=fixture();try{
  const state=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));
  const old=[0,1,2,3].map(i=>JSON.parse(fs.readFileSync(path.join(f.dir,`command-${i}.json`))));
  f.save('command-1.json',null);
  for(let i=1;i<4;i++)f.save(`command-${i+1}.json`,old[i]);
  state.fields.androidVersion.readIndex=2;state.fields.buildNumber.readIndex=3;f.save('state.json',state);
  const events=[f.events[0],{index:1,args:['read-value'],exitCode:1,device:'test-device',runId:'test-run'},...f.events.slice(1).map(e=>({...e,index:e.index+1}))];f.save('events.json',events);
  assert.equal(verifyEvidence(f.frame),true);
  const broken=structuredClone(f.frame);broken.execEnvelopes.splice(1,0,null);broken.result.value.evidence.androidVersion.execEnvelopeIndex=2;broken.result.value.evidence.buildNumber.execEnvelopeIndex=3;
  assert.throws(()=>verifyEvidence(broken),/envelope sequence/);
 }finally{f.cleanup();}
});

test('command failures retain requested and probe evidence without synthesizing envelopes',()=>{
 const f=fixture();const old=process.env.ANDROPERATOR_BIN;
 try {
  fs.unlinkSync(path.join(f.dir,'events.json'));
  const failure={code:'RESULT_ENVELOPE_TIMEOUT',details:{phase:'readiness',dispatchState:'not_dispatched',commandId:'requested',probeCommandId:'probe',probeDispatchState:'unknown',earlierEffects:[{actionId:'close',effect:'force_stop'}]}};
  const cli=path.join(f.dir,'fake-cli.js');
  fs.writeFileSync(cli,`console.log(${JSON.stringify(JSON.stringify(failure))});process.exitCode=1;`);
  process.env.ANDROPERATOR_BIN=cli;
  assert.throws(()=>require('../utils/settings_version_runtime').command(['snapshot']),/phase=readiness, dispatchState=not_dispatched/);
  const event=JSON.parse(fs.readFileSync(path.join(f.dir,'events.json')))[0];
  assert.deepEqual(event.failureEvidence,failure.details);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'command-0.json'))).envelope,undefined);
 } finally {if(old===undefined)delete process.env.ANDROPERATOR_BIN;else process.env.ANDROPERATOR_BIN=old;f.cleanup();}
});

test('a later failed snapshot cannot satisfy final verification with earlier collected values',()=>{
 const f=fixture();try {
  const failure={envelope:{commandId:'failed',status:'failed',stepResults:[{id:'snap',actionType:'snapshot',success:false,data:{error:'SNAPSHOT_EXTRACTION_FAILED',extractionReason:'malformed_xml'}}]}};
  f.save('command-4.json',failure);f.save('events.json',[...f.events,{index:4,args:['snapshot'],exitCode:1}]);
  assert.throws(()=>verifyEvidence(f.frame),error=>error.failure.scope==='terminal_verification');
 }finally{f.cleanup();}
});

test('an injected command runner retains original arguments, evidence and failure semantics',()=>{
 const f=fixture();const runtime=require('../utils/settings_version_runtime');
 const old=process.env.ANDROPERATOR_BIN;
 try {
  process.env.ANDROPERATOR_BIN='synthetic-cli';
  fs.unlinkSync(path.join(f.dir,'events.json'));
  const failure={code:'RESULT_TRANSPORT_FAILED',details:{phase:'dispatch',dispatchState:'unknown',commandId:'original'}};
  let calls=0;
  runtime.setCommandRunner((args,options)=>{
   calls++;assert.deepEqual(args,['snapshot']);
   assert.ok(options.timeout>0 && options.timeout<=20000);
   assert.equal(options.logDir,path.join(f.dir,'logs'));
   return {status:1,signal:null,stdout:JSON.stringify(failure),stderr:'original diagnostics'};
  });
  assert.throws(()=>runtime.command(['snapshot']),/RESULT_TRANSPORT_FAILED/);
  assert.equal(calls,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'command-0.json'))),failure);
  const event=JSON.parse(fs.readFileSync(path.join(f.dir,'events.json')))[0];
  assert.equal(event.failure.dispatchState,'unknown');
  assert.equal(fs.readFileSync(path.join(f.dir,'command-0.stderr'),'utf8'),'original diagnostics');
 }finally{runtime.setCommandRunner(undefined);if(old===undefined)delete process.env.ANDROPERATOR_BIN;else process.env.ANDROPERATOR_BIN=old;f.cleanup();}
});

// A raw TypeScript build is not executable; every Node module extension needs Node.
test('example launcher supports non-executable JavaScript entries',()=>{
 const {resolveAndroperatorBin}=require('../utils/common');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-launcher-'));
 const previous=process.env.ANDROPERATOR_BIN;
 try {
  for(const extension of ['js','cjs','mjs']) {
   const entry=path.join(directory,`entry.${extension}`);
   fs.writeFileSync(entry,'console.log("launched")',{mode:0o600});
   process.env.ANDROPERATOR_BIN=entry;
   const {cmd,args}=resolveAndroperatorBin();
   const result=spawnSync(cmd,args,{encoding:'utf8'});
   assert.equal(result.status,0);
   assert.equal(result.stdout,'launched\n');
  }
 } finally {
  if(previous===undefined)delete process.env.ANDROPERATOR_BIN;else process.env.ANDROPERATOR_BIN=previous;
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
