// Experimental thin Node launcher; no automatic retry after any connection.
const net=require('node:net');
const socketPath=process.env.PERSISTENT_CLI_SOCKET;
if(!socketPath){console.error('PERSISTENT_CLI_SOCKET required');process.exit(1);}
let settled=false, data='';
function fail(message){if(settled)return;settled=true;console.error(JSON.stringify({code:'PROTOTYPE_CONNECTION_FAILED',message}));process.exitCode=1;socket.destroy();}
const socket=net.createConnection(socketPath);
socket.setEncoding('utf8');
socket.setTimeout(120000,()=>fail('Timed out; action outcome may be unknown. No retry performed.'));
socket.on('connect',()=>socket.write(JSON.stringify({args:process.argv.slice(2),context:Object.fromEntries(['ANDROPERATOR_RUN_ID','ANDROPERATOR_LOG_DIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))})+'\n'));
socket.on('data',bytes=>{data+=bytes.toString('utf8');if(Buffer.byteLength(data)>16*1024*1024)fail('Response too large; no retry performed.');});
socket.on('error',()=>fail('Connection failed; action outcome may be unknown. No retry performed.'));
socket.on('end',()=>{if(settled)return;try{const r=JSON.parse(data);if(typeof r.stdout!=='string'||typeof r.stderr!=='string'||!Number.isInteger(r.status)||r.status<0||r.status>255)throw Error();settled=true;process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;}catch{fail('Incomplete response; action outcome may be unknown. No retry performed.');}});
