const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),path=require('node:path'),net=require('node:net'),fs=require('node:fs'),os=require('node:os');
const {start}=require('./host.cjs');
const entry=path.resolve(__dirname,'../../apps/node',require('../../apps/node/package.json').bin.androperator),relay=path.join(__dirname,'relay.cjs');
function run(file,args,env={}){return new Promise(resolve=>{const c=spawn(process.execPath,[file,...args],{env:{...process.env,...env}});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.on('exit',status=>resolve({stdout,stderr,status}));});}
test('persistent CLI preserves exact help, errors, exit isolation and aliases',async()=>{
 const host=await start(entry);
 try {for(const args of [['--help'],['snapshot','--help'],['snapshot','--max-nodes'],['snapshot','--max-nodes','bad'],['snapshot','--timeout','0'],['click','--text',''],['screenshot','--path'],['press','--key','bad'],['snapshot','--timeout-ms','0'],['snapshot','--不明','value'],['--version'],['--help']]){
 const expected=await run(entry,args);const actual=await run(relay,args,{PERSISTENT_CLI_SOCKET:host.socketPath});assert.deepEqual(actual,expected,JSON.stringify(args));
 }}finally{await host.close();}
});
test('disconnect after dispatch returns failure without reconnection or replay',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-fault-')),socketPath=path.join(dir,'s');let requests=0;
 const server=net.createServer(s=>s.once('data',()=>{requests++;s.destroy();}));await new Promise(r=>server.listen(socketPath,r));
 try{const r=await run(relay,['click','--text','example'],{PERSISTENT_CLI_SOCKET:socketPath});assert.equal(r.status,1);assert.equal(requests,1);assert.match(r.stderr,/No retry performed/);}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('worker exit fails closed and explicit replacement works',async()=>{
 const host=await start(entry);await host.close();assert.equal((await run(relay,['--help'],{PERSISTENT_CLI_SOCKET:host.socketPath})).status,1);
 const replacement=await start(entry);try{assert.equal((await run(relay,['--help'],{PERSISTENT_CLI_SOCKET:replacement.socketPath})).status,0);}finally{await replacement.close();}
});
