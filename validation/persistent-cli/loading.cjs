// Host-only lower-cost command: invalid snapshot limit, rejected before device access.
const {start}=require('./host.cjs'),{spawn}=require('node:child_process'),path=require('node:path');
const entry=path.resolve(__dirname,'../../apps/node/dist/cli/index.js');
async function main(){
 const host=await start(entry);const samples=[];let reference;
 try{for(let i=0;i<21;i++)for(const arm of i%2?['persistent','baseline']:['baseline','persistent']){
  const file=arm==='baseline'?entry:path.join(__dirname,'relay.cjs');const started=performance.now();
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,'snapshot','--max-nodes','invalid'],{env:{...process.env,PERSISTENT_CLI_SOCKET:host.socketPath}});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',status=>resolve({stdout,stderr,status}));});
  const elapsedMs=performance.now()-started;reference??=result;
  if(JSON.stringify(result)!==JSON.stringify(reference)||result.status!==1)throw Error('CLI mismatch');
  if(i>0)samples.push({pair:i,arm,elapsedMs});
 }}finally{await host.close();}
 const summary=Object.fromEntries(['baseline','persistent'].map(arm=>{const x=samples.filter(s=>s.arm===arm).map(s=>s.elapsedMs).sort((a,b)=>a-b);return [arm,{count:x.length,medianMs:(x[9]+x[10])/2,meanMs:x.reduce((a,b)=>a+b)/x.length,minMs:x[0],maxMs:x.at(-1)}]}));
 console.log(JSON.stringify({summary,samples},null,2));
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
