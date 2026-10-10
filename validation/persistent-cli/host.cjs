const {fork}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function start(entry,options={}) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'androperator-cli-probe-'));fs.chmodSync(directory,0o700);
 const socketPath=path.join(directory,'cli.sock');
 const child=fork(path.join(__dirname,'worker.mjs'),[entry,socketPath],{cwd:options.cwd??process.cwd(),env:options.env??process.env,stdio:['ignore','ignore','pipe','ipc']});
 let diagnostics='';child.stderr.on('data',b=>diagnostics+=b);
 async function close(){if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await ended;}fs.rmSync(directory,{recursive:true,force:true});}
 try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Prototype start timeout')),10000);child.once('message',m=>{clearTimeout(timer);m.ready?resolve():reject(Error('Invalid ready response'));});child.once('exit',()=>{clearTimeout(timer);reject(Error('Prototype exited: '+diagnostics));});});}
 catch(error){await close();throw error;}
 return {socketPath,child,close};
}
module.exports={start};
