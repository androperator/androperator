const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { measureSync } = require('./settings_version_timing');
const { resolveAndroperatorBin, resolveOperatorPackage } = require('./common');
const {failureFrom,failureError,localFailure} = require('./settings_version_failure');
const {invalidate,publicObservation} = require('./settings_version_state');
const {prepareLogging,loggingAfter} = require('./settings_version_logging');
const { LABELS, normalize, validateRead, digest } = require('./settings_version_model');
const directory = () => {
  const value=process.env.VERSION_RUN_DIR;
  if (!value || !path.isAbsolute(value)) throw Error('VERSION_RUN_DIR must be an absolute evidence directory');
  return value;
};
const file = name => path.join(directory(),name);
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
const save = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2));
let commandDeadline = Infinity;
let commandRunner;
// Experimental hosts may reuse the Node API while preserving this helper's policy.
function setCommandRunner(runner) { commandRunner = runner; }
function withDeadline(deadline, operation) {
  const previous=commandDeadline;commandDeadline=Math.min(previous,deadline);
  try {return operation();} finally {commandDeadline=previous;}
}
function runDeadline() {
  if (!fs.existsSync(file('budget.json'))) save('budget.json',{deadline:Date.now()+275000});
  return read('budget.json').deadline;
}
function command(args) {
  return measureSync('command', () => executeCommand(args));
}
function executeCommand(args) {
  if (!process.env.ANDROPERATOR_BIN?.trim() || !process.env.ANDROPERATOR_DEVICE_ID?.trim()) throw Error('Explicit ANDROPERATOR_BIN and device required');
  const remaining=Math.floor(Math.min(commandDeadline,runDeadline())-Date.now());
  if(remaining<=0) throw failureError(localFailure('RUN_BUDGET_EXHAUSTED','command_execution','No time remains for a device command.'));
  const logging=prepareLogging(directory());
  const bin=resolveAndroperatorBin();
  const events=fs.existsSync(file('events.json')) ? read('events.json') : [];
  const index=events.length;
  const startedAt=new Date().toISOString();
  const started=performance.now();
  const argv=[...bin.args,...args,'--device',process.env.ANDROPERATOR_DEVICE_ID,'--operator-package',resolveOperatorPackage(),'--no-daemon','--output','json'];
  if(['open','click','scroll'].includes(args[0]) && fs.existsSync(file('state.json'))) save('state.json',invalidate(read('state.json'),'action_dispatch'));
  const timeout=Math.max(1,Math.min(20000,remaining));
  const child=commandRunner
    ? commandRunner(args,{timeout,logDir:logging.destination})
    : spawnSync(bin.cmd,argv,{encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:8*1024*1024,env:{...process.env,ANDROPERATOR_LOG_DIR:logging.destination}});
  const elapsedMs=performance.now()-started;
  fs.writeFileSync(file(`command-${index}.stdout`),child.stdout ?? '');
  fs.writeFileSync(file(`command-${index}.stderr`),child.stderr ?? '');
  let response;
  try { response=JSON.parse(child.stdout); } catch { response=null; }
  save(`command-${index}.json`,response);
  const loggingStatus=loggingAfter(directory(),logging,response,child.stderr);
  const failureEvidence=response?.details ?? response?.envelope?.failureEvidence;
  const failed=child.status!==0 || response?.code || response?.error || response?.envelope?.status!=='success' || !Array.isArray(response?.envelope?.stepResults) || response.envelope.stepResults.some(s=>s?.success!==true);
  const failure=failed ? {...failureFrom(response,child,index,args[0]),logging:loggingStatus} : undefined;
  events.push({startedAt,completedAt:new Date().toISOString(),failureEvidence,failure,logging:loggingStatus,index,args,device:process.env.ANDROPERATOR_DEVICE_ID,runId:process.env.ANDROPERATOR_RUN_ID,elapsedMs,exitCode:child.status,signal:child.signal,commandId:response?.envelope?.commandId,taskId:response?.envelope?.taskId});
  save('events.json',events);
  if (failure) throw failureError(failure);
  return {response,index};
}
function observe() {
  try {return measureSync('observation', acquireObservation);}
  catch(error) {
    if(fs.existsSync(file('state.json'))) save('state.json',invalidate(read('state.json'),'observation_failed'));
    throw error;
  }
}
function acquireObservation() {
  // Invalidate the previous candidate menu even if this refresh fails.
  if(fs.existsSync(file('state.json'))) {
    save('state.json',invalidate(read('state.json'),'observation_refresh'));
  }
  const sequence=fs.existsSync(file('events.json'))?read('events.json').length:0;
  const viewportPath=file(`viewport-${sequence}.png`);
  const viewportCapture=command(['screenshot','--path',viewportPath]);
  const png=fs.readFileSync(viewportPath);
  if(png.length<24 || png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || !png.readUInt32BE(16) || !png.readUInt32BE(20)) throw Error('Invalid viewport screenshot');
  const viewportEvent=read('events.json')[viewportCapture.index];
  const {response,index}=command(['snapshot','--compact','--max-nodes','200','--max-text-chars','1024','--raw-path',file(`snapshot-${sequence}.xml`)]);
  const context={receivedAt:read('events.json')[index].completedAt,device:process.env.ANDROPERATOR_DEVICE_ID,
    operatorPackage:resolveOperatorPackage(),sourceReference:`command-${index}.json`,
    viewport:{bounds:{left:0,top:0,right:png.readUInt32BE(16),bottom:png.readUInt32BE(20)},reference:`viewport-${sequence}.png`,observedAt:viewportEvent.completedAt,sourceKind:'image-dimensions',atomicWithTree:false}};
  save(`context-${index}.json`,context);
  const state=fs.existsSync(file('state.json')) ? read('state.json') : {fields:{},actions:0};
  const metadata=response.envelope.stepResults.find(s=>s.actionType==='snapshot').data;
  if(metadata.foreground_package==='com.android.settings' && metadata.has_overlay==='true' && metadata.overlay_package!==state.overlayApproval?.package) {
    const screenshotPath=file(`overlay-${index}.png`);
    command(['screenshot','--path',screenshotPath]);
    state.pendingOverlay={captureId:response.envelope.commandId,package:metadata.overlay_package,screenshotPath,observedAt:Date.now()};
    save('state.json',state);
    return publicState(state);
  }
  const projectionStarted=performance.now();
  const observation=normalize(response,{allowedOverlayPackage:state.overlayApproval?.package,context});
  const projectionMs=performance.now()-projectionStarted;
  save(`projection-${index}.json`,observation);
  save(`projection-metrics-${index}.json`,{projectionMs,sourceBytes:Buffer.byteLength(JSON.stringify(response)),projectionBytes:Buffer.byteLength(JSON.stringify(observation)),captureMs:read('events.json')[index].elapsedMs,viewportMs:viewportEvent.elapsedMs});
  delete state.pendingOverlay;
  state.observation=observation;
  state.captureIndex=index;
  state.observedAt=Date.now();
  save('state.json',state);
  for (const [field,observed] of Object.entries(observation.fields)) {
    if (state.fields[field]?.value === observed.value) continue;
    const result=command(['read-value','--label',LABELS[field]]);
    const step=validateRead(result.response,field,observed);
    state.fields[field]={...observed,readIndex:result.index,snapshotIndex:index,stepResultId:step.id};
    save('state.json',state);
  }
  save('state.json',state);
  return publicState(state);
}
function publicState(state) {
  const observation=publicObservation(state);
  const result={ ...observation, collected:state.fields, actions:state.actions, complete:observation.freshness.status==='current' && Object.keys(LABELS).every(k=>state.fields[k]), evidenceDirectory:directory() };
  if(state.pendingOverlay) {
    return {...result,status:'overlay_review_required',...state.pendingOverlay,note:'Use the image tool to inspect this screenshot. If this is an unobstructive overlay and Settings is usable, approve-overlay <captureId> for this run. Otherwise stop truthfully.'};
  }
  return result;
}
function approveOverlay(captureId) {
  const state=read('state.json');
  const pending=state.pendingOverlay;
  if(!pending?.package || pending.captureId!==captureId || Date.now()-pending.observedAt>45000) throw Error('Overlay review is stale; observe again');
  if(!fs.existsSync(pending.screenshotPath)) throw Error('Overlay screenshot missing');
  state.overlayApproval={...pending,note:'Runtime Codex explicitly accepted the unobstructive overlay after image inspection; valid only for this run and overlay package.'};
  delete state.pendingOverlay;
  save('state.json',state);
  return observe();
}
function act(id,captureId) {
  const state=read('state.json');
  if (state.pendingOverlay) throw Error('Review pending overlay before acting');
  if (state.observation.captureId!==captureId || Date.now()-state.observedAt>45000) throw Error('Stale capture; observe again');
  if (state.actions>=18) throw Error('Run action limit reached');
  const candidate=state.observation.candidates.find(c=>c.id===id);
  if (!candidate) throw Error('Choose an offered candidate');
  state.actions++;
  save('state.json',invalidate(state,'action_dispatch'));
  command(candidate.command);
  return observe();
}
function verifyEvidence(frame) {
  try {return verifyRetainedEvidence(frame);}
  catch(error) {
    if(!error.failure) error.failure=localFailure('TERMINAL_VERIFICATION_FAILED','terminal_verification','Final evidence did not pass independent verification.');
    throw error;
  }
}
function verifyRetainedEvidence(frame) {
  const events=read('events.json');
  const state=read('state.json');
  if(state.pendingOverlay) throw Error('Unreviewed overlay remains');
  const lastSnapshot=events.findLast(e=>e.args[0]==='snapshot');
  if(!lastSnapshot) throw Error('Final snapshot missing');
  normalize(read(`command-${lastSnapshot.index}.json`),{allowedOverlayPackage:state.overlayApproval?.package});
  const retained=events.map(event=>({commandIndex:event.index,envelope:read(`command-${event.index}.json`)?.envelope})).filter(entry=>entry.envelope);
  if(!Array.isArray(frame.execEnvelopes) || frame.execEnvelopes.length!==retained.length || retained.some((entry,index)=>digest(entry.envelope)!==digest(frame.execEnvelopes[index]))) throw Error('Retained envelope sequence mismatch');
  if (frame.status!=='success' || frame.result?.kind!=='json' || frame.skillId!==process.env.ANDROPERATOR_SKILL_ID || frame.contractVersion!=='1.0.0' || frame.terminalVerification?.status!=='verified') throw Error('Missing valid success frame');
  for (const field of Object.keys(LABELS)) {
    const evidence=state.fields[field];
    if (!evidence || frame.result.value[field]!==evidence.value) throw Error(`Missing or changed ${field}`);
    const snap=read(`command-${evidence.snapshotIndex}.json`);
    const observed=normalize(snap,{allowedOverlayPackage:state.overlayApproval?.package}).fields[field];
    if (!observed || observed.value!==evidence.value) throw Error('Snapshot row proof mismatch');
    const response=read(`command-${evidence.readIndex}.json`);
    const step=validateRead(response,field,observed);
    const ref=frame.result.value.evidence[field];
    if (ref.execEnvelopeIndex!==retained.findIndex(entry=>entry.commandIndex===evidence.readIndex) || ref.stepResultId!==step.id || digest(frame.execEnvelopes[ref.execEnvelopeIndex])!==digest(response.envelope)) throw Error('Envelope reference mismatch');
    for (const i of [evidence.readIndex,evidence.snapshotIndex]) if(events[i].device!==process.env.ANDROPERATOR_DEVICE_ID || events[i].runId!==process.env.ANDROPERATOR_RUN_ID) throw Error('Evidence belongs to another run or device');
  }
  const screenshot=events.findLast(e=>e.args[0]==='screenshot');
  if (!screenshot || screenshot.exitCode!==0 || events.at(-1).args[0]!=='screenshot') throw Error('Final screenshot missing');
  const png=fs.readFileSync(file('final.png'));
  if (png.length<24 || png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || !png.readUInt32BE(16) || !png.readUInt32BE(20)) throw Error('Invalid screenshot');
  return true;
}
function finish() {
  observe();
  const state=read('state.json');
  if(state.pendingOverlay) throw Error('Review overlay before finishing');
  if (!Object.keys(LABELS).every(k=>state.fields[k])) throw Error('Both UI fields required');
  command(['screenshot','--path',file('final.png')]);
  const events=read('events.json');
  const retained=events.map(event=>({commandIndex:event.index,envelope:read(`command-${event.index}.json`)?.envelope})).filter(entry=>entry.envelope);
  const envelopes=retained.map(entry=>entry.envelope);
  const evidence=Object.fromEntries(Object.entries(state.fields).map(([key,value])=>[key,{execEnvelopeIndex:retained.findIndex(entry=>entry.commandIndex===value.readIndex),stepResultId:value.stepResultId}]));
  const loggingWarnings=events.filter(event=>event.logging?.status==='unavailable').map(event=>`Command ${event.index} diagnostics unavailable (${event.logging.code}).`);
  const warnings=events.filter(event=>!retained.some(entry=>entry.commandIndex===event.index)).map(event=>`Command ${event.index} returned no result envelope; the original failure is retained in the command ledger.`);
  const value={...Object.fromEntries(Object.entries(state.fields).map(([k,v])=>[k,v.value])),evidence};
  const result={result:{kind:'json',value},status:'success',contractVersion:'1.0.0',skillId:process.env.ANDROPERATOR_SKILL_ID,goal:{kind:'get_android_version_details'},inputs:{},checkpoints:[{id:'settings_opened',status:'ok',note:'Settings foreground observed in retained snapshots'},...Object.entries(state.fields).map(([k,v])=>({id:k+'_observed',status:'ok',evidence:{kind:'result_envelope_ref',...evidence[k]},note:`Exact ${v.label} label and sibling value matched live read-value`})),{id:'terminal_state_verified',status:'ok',note:'Both UI rows verified and final screenshot retained'}],terminalVerification:{status:'verified',observed:{kind:'json',value},note:'Exact snapshot row values independently matched successful read-value results'},execEnvelopes:envelopes,diagnostics:{runtimeState:'healthy',evidenceDirectory:directory(),warnings:[...warnings,...loggingWarnings],observationRecoveries:fs.existsSync(file('recoveries.json'))?read('recoveries.json'):[]}};
  verifyEvidence(result);
  save('verified-result.json',result);
  return result;
}
function fallbackState() {
  return fs.existsSync(file('state.json')) ? publicState(read('state.json')) : {candidates:[],collected:{},freshness:{status:'stale',reason:'no_observation'}};
}
module.exports={setCommandRunner,withDeadline,runDeadline,fallbackState,command,observe,approveOverlay,act,finish,verifyEvidence,file,read,save,publicState};
