// Opt-in physical experiment. Never changes the installed CLI or starts an unowned daemon.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {start}=require('./host.cjs');
const root=path.resolve(__dirname,'../..'),cli=path.join(root,'apps/node',require('../../apps/node/package.json').bin.androperator);
async function main(){
 const [device,out]=process.argv.slice(2);
 if(!device?.trim()||!path.isAbsolute(out??'')||process.argv.length!==4)throw Error('Usage: node compare.cjs <device_serial> <new_absolute_output_directory>');
 if(!process.env.JEV_API_KEY?.trim())throw Error('JEV_API_KEY required');
 fs.mkdirSync(out,{mode:0o700});
 const utils=path.join(out,'utils');fs.cpSync(path.join(root,'examples/skills/utils'),utils,{recursive:true});
 const runtime=path.join(utils,'settings_version_runtime.js'),text=fs.readFileSync(runtime,'utf8');
 if(text.split(",'--no-daemon'").length!==2)throw Error('Unsupported helper');
 fs.writeFileSync(runtime,text.replace(",'--no-daemon'",''));
 let source=fs.readFileSync(path.join(root,'validation/agent-loop-latency/benchmark.cjs'),'utf8');
 source=source.replace("require('./summary.cjs')",`require(${JSON.stringify(path.join(root,'validation/agent-loop-latency/summary.cjs'))})`).replace("path.resolve(__dirname, '../..')",JSON.stringify(root)).replace("path.join(root, 'examples/skills/utils/settings_version_tool.js')",JSON.stringify(path.join(utils,'settings_version_tool.js'))).replace('ANDROPERATOR_BIN: cli,','ANDROPERATOR_BIN: process.env.PROBE_BIN ?? cli,');
 const benchmark=path.join(out,'benchmark.cjs');fs.writeFileSync(benchmark,source);
 function execute(file,args,env){return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[file,...args],{cwd:root,env});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.on('error',reject);c.on('exit',status=>resolve({stdout,stderr,status}));});}
 const trials=[['pilot-baseline','baseline'],['pilot-persistent','persistent'],...Array.from({length:5},(_,i)=>i%2?[['persistent-'+(i+1),'persistent'],['baseline-'+(i+1),'baseline']]:[['baseline-'+(i+1),'baseline'],['persistent-'+(i+1),'persistent']]).flat()];
 for(const [name,arm] of trials){
  const setup=path.join(out,name+'-setup');fs.mkdirSync(setup);
  const env={...process.env,ANDROPERATOR_LOG_DIR:path.join(setup,'logs'),ANDROPERATOR_NO_DAEMON:'0'};
  async function daemon(command){const r=await execute(cli,['daemon',command,'--device',device,'--operator-package','com.androperator.operator.dev','--output','json'],env);fs.writeFileSync(path.join(setup,command+'.json'),r.stdout);if(r.status!==0)throw Error('Daemon '+command+' failed');return JSON.parse(r.stdout).daemon;}
  if((await daemon('status')).status!=='not_running')throw Error('Existing daemon: refusing to touch it');
  if((await daemon('start')).status!=='started')throw Error('Expected owned daemon start');
  let host;
  try{
   if(arm==='persistent'){host=await start(cli,{cwd:root,env});env.PERSISTENT_CLI_SOCKET=host.socketPath;env.PROBE_BIN=JSON.stringify(process.execPath)+' '+JSON.stringify(path.join(__dirname,'relay.cjs'));}
   else env.PROBE_BIN=cli;
   const r=await execute(benchmark,['--device',device,'--out',path.join(out,name),'--backend','cli'],env);
   fs.writeFileSync(path.join(setup,'driver.stdout'),r.stdout);fs.writeFileSync(path.join(setup,'driver.stderr'),r.stderr);
   if(r.status!==0)throw Error(name+' failed; retained, batch stopped');
   const summary=JSON.parse(fs.readFileSync(path.join(out,name,'summary.json')));
   console.log(JSON.stringify({name,status:summary.status,taskMs:summary.taskMs,commands:summary.commandCount}));
   if(summary.status!=='verified')throw Error('Task not verified');
  }finally{if(host)await host.close();await daemon('stop');}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
