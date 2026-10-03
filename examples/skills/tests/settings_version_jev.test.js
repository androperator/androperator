const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {decide}=require('../utils/settings_version_jev');
const state={captureId:'test-capture',headings:['Search Settings'],collected:{},fields:{private:'not-for-request'},candidates:[{id:'scroll-down',description:'Scroll visible list down',command:['scroll','down']}]};
const answer={model:'jev-1.13.0',answers:{next_action:{type:'choice',choice:'scroll-down',confidence:1,probabilities:{'scroll-down':1,escalate:0}}}};
async function isolated(fn) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'version-jev-test-'));
 const old={key:process.env.JEV_API_KEY,dir:process.env.VERSION_RUN_DIR,fetch:global.fetch};
 process.env.JEV_API_KEY='synthetic-key';process.env.VERSION_RUN_DIR=dir;
 try{await fn(dir);}finally{global.fetch=old.fetch;for(const [key,value]of [['JEV_API_KEY',old.key],['VERSION_RUN_DIR',old.dir]])if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(dir,{recursive:true,force:true});}
}
test('Jev sends only projected state and retries a transient failure once',async()=>isolated(async dir=>{
 let calls=0;
 global.fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(options.headers.Authorization,'Bearer synthetic-key');assert.ok(!options.body.includes('not-for-request'));assert.ok(!options.body.includes('synthetic-key'));
  return calls===1?{ok:false,status:429}:{ok:true,status:200,json:async()=>answer};
 };
 assert.equal(await decide(state),'scroll-down');assert.equal(calls,2);
 const log=fs.readFileSync(path.join(dir,'jev.json'),'utf8');assert.ok(!log.includes('synthetic-key'));assert.equal(JSON.parse(log).length,2);
}));
test('Jev does not retry authentication failures or invalid action responses',async()=>isolated(async()=>{
 let calls=0;global.fetch=async()=>{calls++;return {ok:false,status:401};};
 await assert.rejects(()=>decide(state),/HTTP 401/);assert.equal(calls,1);
 global.fetch=async()=>({ok:true,status:200,json:async()=>({...answer,answers:{next_action:{...answer.answers.next_action,choice:'tap-build'}}})});
 await assert.rejects(()=>decide(state),/Invalid or uncertain/);
}));
test('completion on the eighth action is completion, not a controller-limit fallback',async()=>isolated(async dir=>{
 const runtime=require('../utils/settings_version_runtime');
 const original={observe:runtime.observe,act:runtime.act};
 let actions=0;
 const next=()=>({...state,signature:String(actions),complete:actions===8});
 runtime.observe=next;runtime.act=()=>{actions++;return next();};
 global.fetch=async()=>({ok:true,status:200,json:async()=>answer});
 try{const result=await require('../utils/settings_version_jev').loop();assert.equal(result.status,'complete');assert.equal(actions,8);assert.equal(fs.existsSync(path.join(dir,'fallbacks.json')),false);}
 finally{runtime.observe=original.observe;runtime.act=original.act;}
}));

test('Jev evidence keeps ancestry, false and unknown states while explicitly omitting local disclosures',async()=>isolated(async()=>{
 const richer={...state,evidence:{provenance:{captureId:'test-capture',sourceKind:'androperator-compact-v1',receivedAt:'test-time',device:'private-device',rawReference:'private-path'},coverage:{source:{source:'complete'},projection:{truncated:false}},needsRicherEvidence:false,nodes:[{nodePath:'anonymous',parentPath:null,text:'private-value',resourceId:'private-id',checked:false,selected:null},{nodePath:'child',parentPath:'anonymous',enabled:true}],discoveryHints:[{id:'hidden',nodePath:'child',reasons:['outside_viewport']}]}};
 global.fetch=async(url,options)=>{
  for(const secret of ['private-device','private-path','private-value','private-id'])assert.ok(!options.body.includes(secret));
  const evidence=JSON.parse(options.body).state.evidence;
  assert.equal(evidence.nodes[0].checked,false);assert.equal(evidence.nodes[0].selected,null);
  assert.equal(Object.hasOwn(evidence.nodes[1],'checked'),false);
  assert.equal(evidence.nodes[1].parentPath,'anonymous');assert.ok(evidence.disclosureOmissions.length>0);
  assert.deepEqual(evidence.discoveryHints[0].reasons,['outside_viewport']);
  return {ok:true,status:200,json:async()=>answer};
 };
 assert.equal(await decide(richer),'scroll-down');
}));
