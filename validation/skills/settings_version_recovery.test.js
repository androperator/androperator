const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const runtime=require('../../examples/skills/utils/settings_version_runtime');
const {failureFrom}=require('../../examples/skills/utils/settings_version_failure');
const {recoverObservation}=require('../../examples/skills/utils/settings_version_recovery');
const {invalidate,publicObservation}=require('../../examples/skills/utils/settings_version_state');
const {prepareLogging,loggingAfter}=require('../../examples/skills/utils/settings_version_logging');
const nested={envelope:{commandId:'requested',taskId:'task',status:'failed',failureEvidence:{phase:'post_processing',dispatchState:'dispatched',probeCommandId:'probe',probeDispatchState:'dispatched'},stepResults:[{id:'snap',actionType:'snapshot',success:false,data:{error:'SNAPSHOT_EXTRACTION_FAILED',extractionReason:'malformed_xml',failurePhase:'post_processing',dispatchState:'dispatched',diagnostics:{line:7,column:4,receivedBytes:300,closingHierarchySeen:false,rawXml:'PRIVATE',message:'PRIVATE'}}}]}};
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'settings-recovery-'));
 const keys=['VERSION_RUN_DIR','ANDROPERATOR_BIN','ANDROPERATOR_DEVICE_ID','ANDROPERATOR_LOG_DIR','JEV_API_KEY'];
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{VERSION_RUN_DIR:dir,ANDROPERATOR_DEVICE_ID:'fixture-device',ANDROPERATOR_LOG_DIR:'/inaccessible/shared',JEV_API_KEY:'synthetic'});
 return {dir,close(){for(const key of keys) if(old[key]===undefined) delete process.env[key];else process.env[key]=old[key];fs.rmSync(dir,{recursive:true,force:true});}};
}
function fakeCli(f,body) {
 const cli=path.join(f.dir,'cli.js');fs.writeFileSync(cli,body);process.env.ANDROPERATOR_BIN=cli;
}
test('nested failure and optional diagnostics are bounded and presentation precedence preserves local evidence',()=>{
 const failure=failureFrom(nested,{status:1},7,'snapshot');
 assert.equal(failure.code,'SNAPSHOT_EXTRACTION_FAILED');assert.equal(failure.scope,'observation_extraction');
 assert.equal(failure.failedStep.id,'snap');assert.equal(failure.phase,'post_processing');assert.equal(failure.probe.commandId,'probe');
 assert.deepEqual(failure.diagnostics,{line:7,column:4,receivedBytes:300,closingHierarchySeen:false});assert.ok(!JSON.stringify(failure).includes('PRIVATE'));
 const outer={...nested,code:'COMPACT_PRESENTATION_FAILED',message:'PRIVATE'};
 assert.equal(failureFrom(outer,{status:1},7,'snapshot').code,'COMPACT_PRESENTATION_FAILED');assert.equal(outer.envelope,nested.envelope);
 for(const [child,code] of [[{error:{code:'ETIMEDOUT'}},'COMMAND_TIMEOUT'],[{error:{code:'ENOENT'}},'COMMAND_SPAWN_FAILED'],[{signal:'SIGTERM'},'COMMAND_SIGNALLED'],[{status:0},'UNPARSEABLE_OUTPUT']]) assert.equal(failureFrom(null,child,0,'snapshot').code,code);
});
test('tool exposes incident failure, original response and both stale candidate menus',()=>{
 const f=fixture();try {
  scenario(f,true);
  runtime.save('state.json',{observation:{captureId:'old',candidates:[{id:'scroll'}],evidence:{candidates:[{id:'scroll'}]}},fields:{androidVersion:{value:'verified'}},observedAt:Date.now(),actions:1});
  const child=spawnSync(process.execPath,[path.join(require('node:path').resolve(__dirname, '../../examples/skills/utils'),'settings_version_tool.js'),'observe'],{env:process.env,encoding:'utf8'});
  const result=JSON.parse(child.stderr);assert.equal(result.failure.code,'SNAPSHOT_EXTRACTION_FAILED');assert.equal(result.failure.extractionReason,'malformed_xml');
  assert.deepEqual(result.state.candidates,[]);assert.deepEqual(result.state.evidence.candidates,[]);assert.equal(result.state.freshness.status,'stale');assert.equal(result.state.collected.androidVersion.value,'verified');
  assert.deepEqual(runtime.read('command-1.json'),nested);assert.equal(runtime.read('events.json')[1].failure.phase,'post_processing');
 }finally{f.close();}
});
test('logging is child local, setup blocks dispatch, and later failure preserves primary success',()=>{
 const f=fixture();try {
  fakeCli(f,`const fs=require('node:fs');fs.writeFileSync(process.env.ANDROPERATOR_LOG_DIR+'/actual.log','fixture');console.error('[androperator] WARN: logging disabled after write failure for private-path');console.log(JSON.stringify({envelope:{status:'success',stepResults:[]}}));`);
  assert.equal(runtime.command(['snapshot']).response.envelope.status,'success');
  assert.equal(runtime.read('events.json')[0].logging.status,'unavailable');assert.deepEqual(runtime.read('events.json')[0].logging.artifacts,[]);
  fs.rmSync(path.join(f.dir,'logs'),{recursive:true});fs.writeFileSync(path.join(f.dir,'logs'),'blocked');
  assert.throws(()=>runtime.command(['snapshot']),error=>error.failure.code==='LOGGING_SETUP_FAILED');assert.equal(runtime.read('events.json').length,1);
 }finally{f.close();}
});
test('freshness expires by age and clears nested candidates while keeping verified values',()=>{
 const state={observation:{captureId:'old',candidates:[{id:'tap'}],evidence:{candidates:[{id:'tap'}]}},observedAt:100,fields:{androidVersion:'verified'}};
 assert.equal(publicObservation(state,101).freshness.status,'current');
 assert.deepEqual(publicObservation(state,46000).evidence.candidates,[]);
 const stale=invalidate(state,'action_dispatch');assert.deepEqual(stale.observation.candidates,[]);assert.equal(stale.fields.androidVersion,'verified');
});
// Real subprocess fixture with synthetic observations, never a genuine malformed device source.
function scenario(f,repeated=false,failureAt=1) {
 const nodes=[{nodePath:'0',parentPath:null,resourceId:'list',className:'android.widget.ScrollView',scrollable:true,enabled:true,visibleToUser:true,bounds:'[0,0][100,100]'}];
 fakeCli(f,`const fs=require('node:fs');const p=process.env.VERSION_RUN_DIR;const op=process.argv[2];const calls=fs.existsSync(p+'/calls.json')?JSON.parse(fs.readFileSync(p+'/calls.json')):[];calls.push(op);fs.writeFileSync(p+'/calls.json',JSON.stringify(calls));let response={envelope:{commandId:'capture-'+calls.length,taskId:'task',status:'success',stepResults:[]}};
 if(op==='screenshot'){const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(100,16);png.writeUInt32BE(100,20);fs.writeFileSync(process.argv[process.argv.indexOf('--path')+1],png);}
 if(op==='snapshot'){const count=calls.filter(x=>x==='snapshot').length;if(count===${failureAt} || (${repeated} && count>=${failureAt})){response=${JSON.stringify(nested)};process.exitCode=1;}else {response.envelope.stepResults=[{id:'snapshot',actionType:'snapshot',success:true,data:{foreground_package:'com.android.settings',has_overlay:'false'}}];response.compact={schemaVersion:1,commandId:response.envelope.commandId,taskId:'task',nodes:${JSON.stringify(nodes)},truncated:false,totalNodes:1,returnedNodes:1,omittedNodes:0};}}
 console.log(JSON.stringify(response));`);
 runtime.save('state.json',{observation:{captureId:'original',candidates:[{id:'scroll',command:['scroll','down']}],evidence:{candidates:[{id:'scroll'}]}},fields:{androidVersion:{value:'retained'}},observedAt:Date.now(),actions:0});
}
test('successful mutation then malformed snapshot gets one fresh observation and never replays mutation',()=>{
 const f=fixture();try {
  scenario(f);let failure;try{runtime.act('scroll','original');}catch(error){failure=error.failure;}
  assert.equal(failure.code,'SNAPSHOT_EXTRACTION_FAILED');assert.deepEqual(runtime.fallbackState().candidates,[]);
  const state=recoverObservation(failure);assert.equal(state.freshness.status,'current');assert.notEqual(state.captureId,'original');assert.equal(state.collected.androidVersion.value,'retained');
  assert.equal(runtime.read('calls.json').filter(x=>x==='scroll').length,1);assert.equal(runtime.read('calls.json').filter(x=>x==='snapshot').length,2);
  assert.equal(runtime.read('recoveries.json')[0].originalFailure.code,'SNAPSHOT_EXTRACTION_FAILED');assert.equal(runtime.read('events.json').filter(x=>x.failure).length,1);
  assert.throws(()=>recoverObservation(failure));
 }finally{f.close();}
});
test('repeated malformed snapshot reaches Jev fallback with structured evidence and stale state',async()=>{
 const f=fixture();try {
  scenario(f,true);const result=await require('../../examples/skills/utils/settings_version_jev').loop();
  assert.equal(result.status,'escalate');assert.equal(result.failure.code,'SNAPSHOT_EXTRACTION_FAILED');assert.equal(result.failure.phase,'post_processing');
  assert.deepEqual(result.state.candidates,[]);assert.deepEqual(result.state.evidence.candidates,[]);
  assert.equal(runtime.read('calls.json').filter(x=>x==='snapshot').length,2);assert.equal(runtime.read('recoveries.json').length,1);
  assert.equal(runtime.read('fallbacks.json')[0].failure.extractionReason,'malformed_xml');assert.equal(fs.existsSync(runtime.file('jev.json')),false);
  assert.throws(()=>recoverObservation(result.failure),error=>error.recovery.reason==='recovery_limit');
 }finally{f.close();}
});
test('unknown dispatch, incompatible source and exhausted deadlines cannot recover',()=>{
 const f=fixture();try {
  process.env.ANDROPERATOR_BIN='/bin/echo';
  const failure=failureFrom(nested,{status:1},0,'snapshot');runtime.save('events.json',[{index:0,failure}]);
  for(const patch of [{dispatchState:'unknown'},{extractionReason:'forbidden_xml'},{code:'VERSION_INCOMPATIBLE'},{operation:'execute'}]) assert.throws(()=>recoverObservation({...failure,...patch}),error=>error.recovery.reason==='ineligible_failure');
  assert.throws(()=>recoverObservation(failure,Date.now()-1),error=>error.recovery.reason==='budget_exhausted');
  assert.equal(fs.existsSync(runtime.file('recoveries.json')),false);
  runtime.save('budget.json',{deadline:Date.now()-1});assert.throws(()=>runtime.command(['snapshot']),error=>error.failure.code==='RUN_BUDGET_EXHAUSTED');
 }finally{f.close();}
});
test('provider rejection before action keeps a genuinely current capture',async()=>{
 const f=fixture();const observe=runtime.observe;const fetch=global.fetch;try {
  runtime.save('state.json',{observation:{captureId:'current',signature:'fresh',headings:[],candidates:[]},fields:{},actions:0,observedAt:Date.now()});
  runtime.observe=()=>runtime.fallbackState();global.fetch=async()=>({ok:false,status:401});
  const result=await require('../../examples/skills/utils/settings_version_jev').loop();assert.equal(result.failure.scope,'provider');assert.equal(result.state.freshness.status,'current');assert.equal(fs.existsSync(runtime.file('recoveries.json')),false);
 }finally{runtime.observe=observe;global.fetch=fetch;f.close();}
});

test('child environment overrides inaccessible inherited logs without changing the parent',()=>{
 const f=fixture();try {
  const child=require('../../examples/skills/utils/settings_version_harness').childEnvironment(false);
  assert.equal(child.ANDROPERATOR_LOG_DIR,path.join(f.dir,'logs'));
  assert.equal(process.env.ANDROPERATOR_LOG_DIR,'/inaccessible/shared');
  const ready=prepareLogging(f.dir);assert.deepEqual(loggingAfter(f.dir,ready,{},'').artifacts,[]);
  fs.writeFileSync(path.join(f.dir,'logs','actual.log'),'fixture');
  assert.deepEqual(loggingAfter(f.dir,ready,{},'').artifacts,['logs/actual.log']);
  assert.deepEqual(loggingAfter(f.dir,ready,{diagnostics:{logging:{status:'write_failed'}}},'').artifacts,[]);
 }finally{f.close();}
});
test('command deadline caps subprocess timeout and retains truthful timeout evidence',()=>{
 const f=fixture();try {
  fakeCli(f,'setInterval(()=>{},1000);');
  const started=Date.now();
  assert.throws(()=>runtime.withDeadline(Date.now()+100,()=>runtime.command(['snapshot'])),error=>error.failure.code==='COMMAND_TIMEOUT');
  assert.ok(Date.now()-started<2000);assert.equal(runtime.read('command-0.json'),null);
  assert.equal(runtime.read('events.json')[0].failure.dispatchState,'unavailable');
 }finally{f.close();}
});

test('Jev action recovery retains the failure and does not replay the chosen scroll',async()=>{
 const f=fixture();const previousFetch=global.fetch;try {
  scenario(f,false,2);
  global.fetch=async()=>({ok:true,status:200,json:async()=>({model:'jev-1.13.0',answers:{next_action:{type:'choice',choice:'scroll-down',confidence:1,probabilities:{'scroll-down':1,'scroll-up':0,escalate:0}}}})});
  const result=await require('../../examples/skills/utils/settings_version_jev').loop();
  assert.equal(result.status,'escalate');assert.equal(result.reason,'no_progress');
  assert.equal(runtime.read('calls.json').filter(x=>x==='scroll').length,1);
  const recovery=runtime.read('recoveries.json')[0];assert.equal(recovery.status,'observed');
  assert.equal(recovery.originalFailure.code,'SNAPSHOT_EXTRACTION_FAILED');
  assert.equal(result.observationRecoveries[0].originalFailure.code,'SNAPSHOT_EXTRACTION_FAILED');
  assert.equal(runtime.read('fallbacks.json')[0].observationRecoveries[0].originalFailure.code,'SNAPSHOT_EXTRACTION_FAILED');
  assert.equal(result.state.freshness.status,'current');assert.equal(result.state.actions,1);
 }finally{global.fetch=previousFetch;f.close();}
});

test('logging metadata failure stops setup without exposing filesystem exception text',()=>{
 const f=fixture();try {
  fs.mkdirSync(path.join(f.dir,'logging.json'));
  assert.throws(()=>prepareLogging(f.dir),error=>error.failure.code==='LOGGING_SETUP_FAILED' && !error.message.includes(f.dir));
 }finally{f.close();}
});

test('Jev overlay escalation preserves current review evidence and clears historical candidates',async()=>{
 const f=fixture();const observe=runtime.observe;try {
  const pendingOverlay={captureId:'overlay-current',package:'fixture.overlay',screenshotPath:path.join(f.dir,'overlay.png'),observedAt:Date.now()};
  runtime.save('state.json',{observation:{captureId:'historical',candidates:[{id:'old'}],evidence:{candidates:[{id:'old'}]}},fields:{androidVersion:{value:'verified'}},actions:1,observedAt:0,pendingOverlay});
  runtime.observe=()=>({status:'overlay_review_required',...pendingOverlay});
  const result=await require('../../examples/skills/utils/settings_version_jev').loop();
  assert.equal(result.reason,'overlay_review_required');
  for(const state of [result.state,runtime.read('fallbacks.json')[0].state]) {
    assert.equal(state.status,'overlay_review_required');assert.equal(state.captureId,pendingOverlay.captureId);
    assert.equal(state.screenshotPath,pendingOverlay.screenshotPath);assert.equal(state.package,pendingOverlay.package);
    assert.match(state.note,/inspect this screenshot/);assert.equal(state.freshness.status,'stale');
    assert.deepEqual(state.candidates,[]);assert.deepEqual(state.evidence.candidates,[]);
    assert.equal(state.collected.androidVersion.value,'verified');assert.equal(state.complete,false);
  }
 }finally{runtime.observe=observe;f.close();}
});
