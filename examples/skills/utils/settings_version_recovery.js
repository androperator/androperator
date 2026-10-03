// Explicit orchestrator policy. The deterministic runtime never retries an action.
const fs = require('node:fs');
const runtime = require('./settings_version_runtime');
const {failureError,localFailure} = require('./settings_version_failure');
function recoverObservation(failure, deadline = runtime.runDeadline()) {
  const attempts=fs.existsSync(runtime.file('recoveries.json')) ? runtime.read('recoveries.json') : [];
  const events=fs.existsSync(runtime.file('events.json')) ? runtime.read('events.json') : [];
  const latest=events.at(-1);
  const eligible=failure?.code==='SNAPSHOT_EXTRACTION_FAILED' && failure.operation==='snapshot' &&
    failure.extractionReason==='malformed_xml' && failure.phase==='post_processing' && failure.dispatchState==='dispatched' &&
    latest?.index===failure.commandIndex && latest.failure?.code===failure.code;
  const end=Math.min(deadline,runtime.runDeadline(),Date.now()+10000);
  if(!eligible || attempts.length>=1 || end-Date.now()<1000) {
    const error=failureError(failure ?? localFailure('RECOVERY_UNAVAILABLE','observation_extraction','No eligible retained observation failure.'));
    error.recovery={status:'unavailable',reason:!eligible?'ineligible_failure':attempts.length?'recovery_limit':'budget_exhausted'};
    throw error;
  }
  const record={originalFailure:failure,startedAt:new Date().toISOString(),deadline:end,status:'started'};
  attempts.push(record);runtime.save('recoveries.json',attempts);
  try {
    const state=runtime.withDeadline(end,()=>runtime.observe());
    record.status=state.freshness?.status==='current'?'observed':'review_required';record.captureId=state.captureId;
    return {...state,recovery:record};
  } catch(error) {
    record.status='failed';record.failure=error.failure ?? localFailure('OBSERVATION_RECOVERY_FAILED','observation_extraction','Fresh observation failed; inspect local evidence.');
    error.recovery={status:'failed',originalFailure:failure};throw error;
  } finally {
    record.completedAt=new Date().toISOString();runtime.save('recoveries.json',attempts);
  }
}
function latestFailure() {
  return fs.existsSync(runtime.file('events.json')) ? runtime.read('events.json').at(-1)?.failure : undefined;
}
module.exports={recoverObservation,latestFailure};
