const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=require('../../examples/skills/utils/settings_version_runtime');
const {verifyScreenshot}=require('../../apps/node/dist/domain/observe/screenshotMetadata.js');
const directory=process.argv[2];
if(!path.isAbsolute(directory??''))throw Error('Absolute evidence directory required');
const rows=[];let reference;
for(const name of ['pilot-baseline','pilot-persistent',...Array.from({length:5},(_,i)=>['baseline-'+(i+1),'persistent-'+(i+1)]).flat()]){
 const dir=path.join(directory,name);const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file)));
 const trial=read('trial.json');assert.equal(trial.status,'verified',name);
 const summary=read('summary.json'),events=read('events.json'),frame=read('verified-result.json');
 Object.assign(process.env,{VERSION_RUN_DIR:dir,ANDROPERATOR_SKILL_ID:frame.skillId,ANDROPERATOR_DEVICE_ID:events[0].device,ANDROPERATOR_RUN_ID:events[0].runId});runtime.verifyEvidence(frame);
 const signature={commands:events.map(e=>e.args[0]),route:events.filter(e=>['click','scroll'].includes(e.args[0])).map(e=>e.args),fields:Object.fromEntries(Object.entries(frame.result.value).filter(([k])=>k!=='evidence'))};
 reference??=signature;assert.deepEqual(signature,reference,name);
 const images=fs.readdirSync(dir).filter(n=>n.endsWith('.png')).map(n=>verifyScreenshot(fs.readFileSync(path.join(dir,n))));
 const logdir=path.join(directory,name+'-setup','logs');
 const logs=fs.readdirSync(logdir).filter(n=>n.endsWith('.log')).flatMap(n=>fs.readFileSync(path.join(logdir,n),'utf8').trim().split('\n').map(JSON.parse));
 for(const e of events){const matching=logs.filter(l=>l.runId===e.runId&&l.commandId===e.commandId&&l.taskId===e.taskId);assert.equal(matching.filter(l=>l.event==='broadcast.dispatched').length,1);assert.equal(matching.filter(l=>l.event==='envelope.received').length,1);}
 assert.equal(logs.filter(l=>l.runId===events[0].runId&&l.event==='serve.http.request'&&l.message.startsWith('POST /execute')).length,events.length);
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,name+'-setup','stop.json'))).daemon.status,'stopped');
 rows.push({name,taskMs:trial.taskMs,commands:events.length,commandMs:summary.commandCalls.totalMs,providerMs:summary.provider.requests.totalMs,otherMs:summary.otherMs,acceptedChoices:summary.provider.acceptedChoices,providerFailures:summary.provider.failedAttempts,failedCommands:summary.failedCommands,images:images.length,dimensions:[...new Set(images.map(i=>i.captureWidthPx+'x'+i.captureHeightPx))],matchedDispatches:events.length});
}
const summary=Object.fromEntries(['baseline','persistent'].map(arm=>{const selected=rows.filter(r=>new RegExp('^'+arm+'-[1-5]$').test(r.name));return [arm,Object.fromEntries(['taskMs','commandMs','providerMs','otherMs'].map(k=>{const x=selected.map(r=>r[k]).sort((a,b)=>a-b);return [k,{median:x[2],mean:x.reduce((a,b)=>a+b)/x.length,min:x[0],max:x.at(-1)}]}))];}));
console.log(JSON.stringify({summary,rows},null,2));
