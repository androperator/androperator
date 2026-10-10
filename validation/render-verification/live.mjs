// Opt-in physical validation. OCR and hidden-API capture remain experimental adapters.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRenderVerifier} from '../../apps/node/dist/renderVerification.js';
import {startScaleSession} from '../agent-loop-latency/scale-session.cjs';
import {experimentDisplay,splitPacket,validateDirectMetrics} from '../agent-loop-latency/screenshot-scales.cjs';
import policy from '../../examples/skills/utils/settings_render_condition.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
if(args.length!==8 || args[0]!=='--device' || !args[1]?.trim() || args[2]!=='--out' || !path.isAbsolute(args[3])
 || args[4]!=='--ocr' || !path.isAbsolute(args[5]) || args[6]!=='--dex' || !path.isAbsolute(args[7])) {
 throw Error('Usage: node live.mjs --device <serial> --out <new_absolute_directory> --ocr <absolute_recognizer> --dex <absolute_built_dex>');
}
const [device,out,ocr,dex]=[args[1],args[3],args[5],args[7]];
const remote=`/data/local/tmp/androperator-render-verification-${randomUUID()}.dex`;
fs.mkdirSync(out,{mode:0o700});
const cli=path.join(root,'apps/node/dist/cli/index.js');
const env={...process.env,ANDROPERATOR_LOG_DIR:path.join(out,'logs'),ANDROPERATOR_RUN_ID:'render-verification'};
let processNumber=0;
let commandNumber=0,session,sequence=0,currentDir=out;
const ledger=[];
function processOutput(program,argv,{timeoutMs=20000,signal}={}) {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('Cancelled'));
  const processIndex=processNumber++;
  const child=spawn(program,argv,{cwd:root,env,stdio:['ignore','pipe','pipe']});let stdout=Buffer.alloc(0),stderr='',failure;
  const cancel=()=>{failure=Error('Cancelled');child.kill('SIGKILL');};
  const timer=setTimeout(()=>{failure=Error('Process deadline exceeded');child.kill('SIGKILL');},timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stdout.on('data',data=>{stdout=Buffer.concat([stdout,data]);if(stdout.length>64*1024*1024){failure=Error('Output limit');child.kill('SIGKILL');}});
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(0,8192);});
  child.on('error',error=>{failure=error;});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(failure||code!==0){fs.writeFileSync(path.join(currentDir,`failed-process-${processIndex}.stdout`),stdout,{mode:0o600});fs.writeFileSync(path.join(currentDir,`failed-process-${processIndex}.json`),JSON.stringify({program,argv,code,stderr,error:failure?.message}),{mode:0o600});reject(failure??Error(`Process failed (${code}); retained as failed-process-${processIndex}`));}else resolve(stdout);});
 });
}
async function command(argv,budget) {
 const index=commandNumber++,started=performance.now();
 const bytes=await processOutput(process.execPath,[cli,...argv,'--device',device,'--operator-package','com.androperator.operator.dev','--no-daemon','--output','json'],budget);
 fs.writeFileSync(path.join(currentDir,`command-${index}.json`),bytes,{mode:0o600});
 const response=JSON.parse(bytes);assert.equal(response.envelope.status,'success');assert.ok(response.envelope.stepResults.every(s=>s.success));
 ledger.push({index,args:argv,elapsedMs:performance.now()-started,commandId:response.envelope.commandId,taskId:response.envelope.taskId});
 fs.writeFileSync(path.join(out,'commands.json'),JSON.stringify(ledger,null,2));return response;
}
async function snapshot(budget){return command(['snapshot','--compact','--max-nodes','200','--max-text-chars','1024'],budget);}
async function display(budget){return experimentDisplay((await processOutput('adb',['-s',device,'shell','dumpsys','display'],budget)).toString());}
function scrollArgs(s){const n=s.compact.nodes.find(n=>n.scrollable&&n.visibleToUser&&n.resourceId);if(!n)throw Error('No visible scroll container');return ['scroll','down','--container-id',n.resourceId];}
async function reset(){await command(['close','com.android.settings']);await command(['open','com.android.settings']);}
async function find(label){for(let i=0;i<8;i++){const s=await snapshot();const metadata=policy.metadata(s);if(metadata.foreground_package!=='com.android.settings')continue;if(s.compact.nodes.some(n=>n.text===label&&n.visibleToUser))return s;await command(scrollArgs(s));}throw Error('Target not found');}
const results=[];
async function trial(name,mode,fault){
 currentDir=path.join(out,name);fs.mkdirSync(currentDir,{mode:0o700});
 await reset();
 const target=await find('About phone');
 // Preparation is outside timing. Verify actual target pixels before clicking.
 const targetFile=path.join(currentDir,'pre-click.png');
 await command(['screenshot','--path',targetFile]);
 const targetRows=JSON.parse((await processOutput(ocr,[targetFile])).toString());
 fs.writeFileSync(targetFile+'.ocr.json',JSON.stringify(targetRows),{mode:0o600});
 assert.ok(targetRows.some(row=>row.text==='About phone'&&row.confidence>=0.5),'Target absent from actual pixels');
 const confirmed=await snapshot();policy.metadata(confirmed);
 const bounds=s=>s.compact.nodes.filter(n=>n.text==='About phone'&&n.visibleToUser).map(n=>n.bounds);
 assert.deepEqual(bounds(confirmed),bounds(target),'Target moved during preparation');
 const expectedDisplay=await display();
 // Retain actual old-page pixels for the explicitly injected delayed-frame test.
 let oldPng;
 if(fault==='delayed-frame'){
  if(!session){session=startScaleSession(device,expectedDisplay.physicalId,remote,expectedDisplay);sequence=0;}
  const packet=splitPacket((await session.capture(25,5000)).buffer);validateDirectMetrics(packet.metrics,Math.floor(expectedDisplay.width/4),Math.floor(expectedDisplay.height/4),expectedDisplay.rotation,++sequence);oldPng=packet.png;
  fs.writeFileSync(path.join(currentDir,'pre-action-old.png'),oldPng,{mode:0o600});
 }
 const actionStarted=performance.now();
 const clicked=await command(['click','--text','About phone']);
 let captureIndex=0;
 const controller=new AbortController();
 const run=createRenderVerifier({
  async acquire(r){
   const started=performance.now(),budget=()=>({timeoutMs:Math.max(1,Math.floor(r.timeoutMs-(performance.now()-started))),signal:r.signal});
   const before=await snapshot(budget()),d1=await display(budget());policy.metadata(before);
   assert.deepEqual(d1,expectedDisplay,'Geometry changed; stop without fallback');
   let png,backend;
   if(r.scale===0.25){
    if(!session){session=startScaleSession(device,d1.physicalId,remote,d1);sequence=0;}
    const abort=()=>{void session.close();};r.signal.addEventListener('abort',abort,{once:true});
    let packet;try{packet=splitPacket((await session.capture(25,budget().timeoutMs)).buffer);}finally{r.signal.removeEventListener('abort',abort);}
    validateDirectMetrics(packet.metrics,Math.floor(d1.width/4),Math.floor(d1.height/4),d1.rotation,++sequence);
    if(packet.metrics.containsHdrLayers)throw Error('Unsupported HDR');png=packet.png;backend='experimental-direct-buffer';
   }else{
    const file=path.join(currentDir,r.captureId+'.stock.png');await command(['screenshot','--path',file],budget());png=fs.readFileSync(file);backend='canonical-stock';
   }
   const d2=await display(budget()),after=await snapshot(budget());policy.metadata(after);assert.deepEqual(d2,d1,'Geometry changed during capture');
   captureIndex++;
   fs.writeFileSync(path.join(currentDir,r.captureId+'.original.png'),png,{mode:0o600});
   const injected=fault==='delayed-frame'&&captureIndex<=2;
   if(injected)png=oldPng;
   fs.writeFileSync(path.join(currentDir,r.captureId+'.png'),png,{mode:0o600});
   return {captureId:r.captureId,deviceId:device,png,backend,source:{width:d1.width,height:d1.height,rotation:d1.rotation,displayId:d1.physicalId},
    beforeKey:policy.contextKey(before,labels,d1),afterKey:policy.contextKey(after,labels,d2),evidence:{before,after,injected,captureIndex}};
  },
  async verify(frame,_condition,budget){
   const file=path.join(currentDir,frame.captureId+'.png');
   const rows=JSON.parse((await processOutput(ocr,[file],budget)).toString());
   fs.writeFileSync(file+'.ocr.json',JSON.stringify(rows),{mode:0o600});
   const semantic=policy.semantic(frame.evidence.before,labels)&&policy.semantic(frame.evidence.after,labels);
   const actualVisual=policy.visual(rows,labels);
   const injected=fault==='both-unreadable'||(fault==='small-unreadable'&&frame.png.readUInt32BE(16)<frame.source.width);
   if(fault==='cancel')controller.abort();
   return {semantic:{matched:semantic&&fault!=='wrong-destination',reason:fault==='wrong-destination'?'injected impossible destination':'expected visible page content in both snapshots'},
    visual:{matched:actualVisual&&!injected&&fault!=='wrong-destination',reason:injected?'injected recognition failure; original OCR retained':fault==='wrong-destination'?'injected impossible destination':'title position and requested content in pixels'}};
  },
 });
 let labels=['About phone'];
 async function verify(action,phase){
  const start=performance.now();const result=await run({action,deviceId:device,conditionId:labels.join(' + '),timeoutMs:30000,reducedAttempts:mode==='full'?0:3,fullAttempts:2,fallbackReserveMs:6000,signal:controller.signal});
  fs.writeFileSync(path.join(currentDir,phase+'.json'),JSON.stringify(result,(key,value)=>key==='png'?undefined:value,2),{mode:0o600});
  const expected=fault==='cancel'?'RENDER_CANCELLED':['both-unreadable','wrong-destination'].includes(fault)?'RENDER_NOT_VERIFIED':'RENDER_VERIFIED';
  assert.equal(result.code,expected);assert.deepEqual(result.action,action);
  const accepted=result.attempts.find(a=>a.captureId===result.acceptedCaptureId);
  if(accepted)assert.ok(!accepted.frame.evidence.injected,'A stale injected frame was accepted');
  const row={trial:name,phase,mode,fault:fault??null,code:result.code,elapsedMs:performance.now()-start,attempts:result.attempts.length,fullAttempts:result.attempts.filter(a=>a.requestedScale===1).length,rejected:result.attempts.filter(a=>a.outcome==='rejected').length,acceptedScale:accepted?.requestedScale};
  results.push(row);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(row));return result;
 }
 await verify(clicked.envelope,'arrival');
 results.at(-1).actionToEvidenceMs=performance.now()-actionStarted;
 if(!fault){
  let s=await snapshot();let scroll;
  for(let i=0;i<8;i++){
   scroll=await command(scrollArgs(s));s=await snapshot();policy.metadata(s);
   if(s.compact.nodes.some(n=>n.text==='Build number'&&n.visibleToUser))break;
  }
  assert.ok(s.compact.nodes.some(n=>n.text==='Build number'&&n.visibleToUser));labels=['About phone','Build number'];
  await verify(scroll.envelope,'scrolled-content');
 }
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(results,null,2));
}
try {
 const readiness=JSON.parse(await processOutput(process.execPath,[cli,'doctor','--device',device,'--operator-package','com.androperator.operator.dev','--output','json']));
 fs.writeFileSync(path.join(out,'readiness.json'),JSON.stringify(readiness));assert.equal(readiness.criticalOk,true);
 await processOutput('adb',['-s',device,'push',dex,remote]);
 await trial('pilot','quarter');
 if(process.env.RENDER_PILOT_ONLY!=='1') {
 for(let i=1;i<=3;i++)for(const mode of i%2?['full','quarter']:['quarter','full'])await trial(`${mode}-${i}`,mode);
 for(const fault of ['delayed-frame','small-unreadable','wrong-destination','both-unreadable','cancel'])await trial(fault,'quarter',fault);
 }
}finally{
 if(session)await session.close();await processOutput('adb',['-s',device,'shell','rm','-f',remote]);
}
