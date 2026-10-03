const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {resolveAndroperatorBin,resolveOperatorPackage}=require('./common');
const {prepareRun,sourceHashes}=require('./orchestrated_run');
const {digest}=require('./settings_version_model');
function parseFailureFrame(text, skillId) {
  const prefix='[Androperator-Skill-Result]';
  const framed=text.startsWith(prefix);
  const frame=JSON.parse(framed?text.slice(prefix.length).trim():text);
  if(!framed && !['failed','indeterminate'].includes(frame.status)) return null;
  if(!['failed','indeterminate'].includes(frame.status) || frame.contractVersion!=='1.0.0' || frame.skillId!==skillId || frame.result!==null || !Array.isArray(frame.checkpoints) || frame.source!==undefined) throw Error('Invalid runtime failure frame');
  return frame;
}
function childEnvironment(jev) {
  const env={};
  for(const key of ['HOME','CODEX_HOME','PATH','LANG','SHELL','TMPDIR','ADB_PATH','ANDROPERATOR_BIN','ANDROPERATOR_DEVICE_ID','ANDROPERATOR_OPERATOR_PACKAGE','ANDROPERATOR_SKILLS_DIR','ANDROPERATOR_SKILL_RUN_ID','ANDROPERATOR_SKILL_ID','ANDROPERATOR_LOG_DIR','VERSION_RUN_DIR']) if(process.env[key]!==undefined) env[key]=process.env[key];
  if(process.env.VERSION_RUN_DIR) env.ANDROPERATOR_LOG_DIR=path.join(process.env.VERSION_RUN_DIR,'logs');
  if(jev && process.env.JEV_API_KEY!==undefined) env.JEV_API_KEY=process.env.JEV_API_KEY;
  return env;
}
function finalizeRun(session, frame, elapsedMs) {
  const warn = message => {
    frame.diagnostics ??= {};
    const warnings = Array.isArray(frame.diagnostics.warnings) ? frame.diagnostics.warnings : [];
    frame.diagnostics.warnings = [...warnings, message];
  };
  try {
    fs.writeFileSync(path.join(session.directory,'run-summary.json'),JSON.stringify({status:frame.status,elapsedMs,reason:frame.diagnostics?.reason ?? null}));
  } catch {
    warn('Could not write run-summary.json; retained evidence and the primary result remain authoritative.');
  }
  try { session.release(); }
  catch {
    warn('Could not release the device reservation; inspect its owner and lock before retrying.');
  }
}
async function run(jev) {
  let frame, session;
  const started=performance.now();
  try {
    if(!process.env.ANDROPERATOR_BIN?.trim() || !process.env.ANDROPERATOR_DEVICE_ID?.trim()) throw Error('Explicit CLI and device are required');
    if(jev && !process.env.JEV_API_KEY?.trim()) throw Error('JEV_API_KEY is missing');
    session=prepareRun();
    const {directory:dir,model,effort}=session;
    process.env.VERSION_RUN_DIR=dir;
    fs.writeFileSync(path.join(dir,'budget.json'),JSON.stringify({deadline:Date.now()+Math.max(1000,Math.min(275000,session.timeout-15000))}));
    const skillProgram=fs.readFileSync(process.env.ANDROPERATOR_SKILL_PROGRAM,'utf8');
    const tool=path.join(__dirname,'settings_version_tool.js');
    const prompt=`You are a runtime Codex agent executing this read-only Android skill. Perform actual commands now; do not edit code, inspect repositories, or spawn other agents. Use the supplied deterministic helper through the shell tool. It invokes only the pinned Androperator CLI, serializes actions and retains all UI evidence. Its candidate menu is evidence, not a preselected route. You choose the next action and handle deviations.\nHelper: node ${JSON.stringify(tool)} <operation>\nRun directory: ${dir}\nPinned CLI: ${process.env.ANDROPERATOR_BIN}\nTarget: ${process.env.ANDROPERATOR_DEVICE_ID}\nOperator: ${resolveOperatorPackage()}\nModel: ${model}, effort: ${effort}\nProgram:\n${skillProgram}\nYour final answer must be exactly the compact JSON receipt returned by finish. The launcher validates its hash and emits the retained full SkillResult frame; do not repeat the raw envelopes. If blocked, emit a failed frame with result:null, contractVersion:1.0.0, skillId:${process.env.ANDROPERATOR_SKILL_ID}, checkpoints:[], and a truthful diagnostics reason. Inspect retained command errors before recovery. Requested and readiness-probe evidence are separate. After dispatch uncertainty, observe before repeating a mutation. Never invent evidence or values.`;
    fs.writeFileSync(path.join(dir,'prompt.txt'),prompt);
    const bin=resolveAndroperatorBin();
    const version=spawnSync(bin.cmd,[...bin.args,'--version'],{encoding:'utf8',timeout:10000});
    if(version.status!==0) throw Error('Pinned CLI unavailable');
    const args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','workspace-write','-c','sandbox_workspace_write.network_access=true','-c','project_doc_max_bytes=0','-c','shell_environment_policy.inherit="all"','-c','shell_environment_policy.include_only=["PATH","HOME","CODEX_HOME","LANG","SHELL","TMPDIR","ADB_PATH","ANDROPERATOR_*","VERSION_*","JEV_API_KEY"]','-c','shell_environment_policy.ignore_default_excludes=true','-c',`model_reasoning_effort="${effort}"`,'-m',model,'--json','--color','never','-C',dir,'-o',path.join(dir,'last-message.txt'),'-'];
    const agentVersion=spawnSync(process.env.ANDROPERATOR_SKILL_AGENT_CLI_PATH,['--version'],{encoding:'utf8',timeout:10000});
    if(agentVersion.status!==0) throw Error('Selected Codex executable unavailable');
    fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify({device:process.env.ANDROPERATOR_DEVICE_ID,operatorPackage:resolveOperatorPackage(),agentExecutable:process.env.ANDROPERATOR_SKILL_AGENT_CLI_PATH,sourceHashes:sourceHashes([['skill',process.env.ANDROPERATOR_SKILL_PROGRAM],...['common.js','observation_context.js','orchestrated_run.js','settings_version_harness.js','settings_version_runtime.js','settings_version_tool.js','settings_version_model.js','settings_version_jev.js','settings_version_failure.js','settings_version_state.js','settings_version_logging.js','settings_version_recovery.js'].map(name=>[name,path.join(__dirname,name)])]),model,effort,cliVersion:version.stdout.trim(),androperatorBin:process.env.ANDROPERATOR_BIN,runId:process.env.ANDROPERATOR_SKILL_RUN_ID,jev,promptHash:digest(prompt),childLogging:{destination:path.join(dir,'logs'),status:'pending_child_check',statusReference:'logging.json'},sandbox:'workspace-write',transport:'direct --no-daemon',keyPresentInChild:!!childEnvironment(jev).JEV_API_KEY,codexVersion:agentVersion.stdout.trim(),args},null,2));
    const stdout=fs.openSync(path.join(dir,'codex.jsonl'),'w');
    const stderr=fs.openSync(path.join(dir,'codex.stderr'),'w');
    const child=spawn(process.env.ANDROPERATOR_SKILL_AGENT_CLI_PATH,args,{env:childEnvironment(jev),stdio:['pipe',stdout,stderr],detached:true});
    fs.closeSync(stdout);fs.closeSync(stderr);
    let timedOut=false;
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
    let escalation;
    const stop=()=>{timedOut=true;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),1500);};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    const configured=session.timeout;
    const timeout=setTimeout(stop,Math.max(1000,Math.min(285000,configured-10000)));
    child.stdin.on('error',()=>{});child.stdin.end(prompt);
    let code;
    try { code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}); }
    finally {
      clearTimeout(timeout);if(escalation)clearTimeout(escalation);
      kill('SIGKILL');
      process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    }
    fs.writeFileSync(path.join(dir,'child-exit.json'),JSON.stringify({code,timedOut,groupCleanup:'SIGKILL sent to remaining group'}));
    if(timedOut || code!==0) throw Error(timedOut?'Codex deadline exceeded':`Codex exited ${code}`);
    const text=fs.readFileSync(path.join(dir,'last-message.txt'),'utf8').trim();
    frame=parseFailureFrame(text,process.env.ANDROPERATOR_SKILL_ID);
    if(frame) {
      process.exitCode=1;
    } else {
      const receipt=JSON.parse(text);
      frame=JSON.parse(fs.readFileSync(path.join(dir,'verified-result.json'),'utf8'));
      if(receipt.status!=='success' || receipt.verifiedResultHash!==digest(frame) || digest(receipt.result)!==digest(frame.result.value)) throw Error('Runtime receipt does not match captured result');
      require('./settings_version_runtime').verifyEvidence(frame);
    }
  } catch(error) {
    frame={result:null,status:'failed',contractVersion:'1.0.0',skillId:process.env.ANDROPERATOR_SKILL_ID ?? 'version-details',checkpoints:[],terminalVerification:{status:'failed'},diagnostics:{reason:error.message,failure:error.failure}};
    process.exitCode=1;
  }
  try {
    if(session && frame.status!=='success') {
      const toolFailurePath=path.join(session.directory,'last-tool-failure.json');
      if(fs.existsSync(toolFailurePath)) {
        frame.diagnostics ??= {};
        frame.diagnostics.lastToolFailure=JSON.parse(fs.readFileSync(toolFailurePath,'utf8'));
      }
      const eventsPath=path.join(session.directory,'events.json');
      if(fs.existsSync(eventsPath)) {
        const events=JSON.parse(fs.readFileSync(eventsPath,'utf8'));
        frame.diagnostics ??= {};
        const failures=events.filter(event=>event.failure);
        frame.diagnostics.retainedFailureCount=failures.length;
        frame.diagnostics.retainedFailures=failures.slice(-16).map(event=>event.failure);
      }
    }
  } catch {
    frame.diagnostics ??= {};
    frame.diagnostics.evidenceWarning='Retained failure summaries could not be read; inspect local command files.';
  }
  if(session) finalizeRun(session,frame,performance.now()-started);
  console.log('[Androperator-Skill-Result]\n'+JSON.stringify(frame));
}
module.exports={run,childEnvironment,parseFailureFrame,finalizeRun};
