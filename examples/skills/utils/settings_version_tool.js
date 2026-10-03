#!/usr/bin/env node
const runtime=require('./settings_version_runtime');
(async()=>{
  const [operation,...args]=process.argv.slice(2);
  let result;
  if(operation==='open') {runtime.command(['open','com.android.settings']);result=runtime.observe();}
  else if(operation==='recover-observation') result=require('./settings_version_recovery').recoverObservation(require('./settings_version_recovery').latestFailure());
  else if(operation==='observe') result=runtime.observe();
  else if(operation==='approve-overlay') result=runtime.approveOverlay(args[0]);
  else if(operation==='act') result=runtime.act(args[0],args[1]);
  else if(operation==='jev') result=await require('./settings_version_jev').loop();
  else if(operation==='finish') { const frame=runtime.finish(); result={verifiedResultHash:require('./settings_version_model').digest(frame),result:frame.result.value,status:frame.status}; }
  else throw Error('Use open, observe, recover-observation, approve-overlay <capture>, act <candidate> <capture>, jev, or finish');
  console.log(JSON.stringify(result));
})().catch(error=>{
  try {runtime.save('last-tool-failure.json',{reason:error.message,failure:error.failure,recovery:error.recovery});} catch {}
  console.error(JSON.stringify({status:'escalate',reason:error.message,failure:error.failure,recovery:error.recovery,state:runtime.fallbackState()}));process.exitCode=1;});
