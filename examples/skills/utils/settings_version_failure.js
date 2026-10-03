// Only bounded structured facts cross the agent boundary. Original output stays local.
const token = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
function facts(source = {}) {
  const result = {};
  for (const key of ['phase','failurePhase','dispatchState','commandId','taskId','probeCommandId','probeTaskId','probeDispatchState','actionId','stepId','actionType','extractionReason']) {
    if (token(source[key])) result[key] = source[key];
  }
  return result;
}
function diagnostics(source = {}) {
  const result = {};
  for (const key of ['line','column','position','receivedBytes','sourceBytes','depth']) {
    if (Number.isSafeInteger(source[key]) && source[key] >= 0) result[key] = source[key];
  }
  for (const key of ['closingHierarchySeen','closingMarkerSeen']) if (typeof source[key] === 'boolean') result[key] = source[key];
  for (const key of ['category','terminationReason','sourceValidationCategory']) if (token(source[key])) result[key] = source[key];
  return result;
}
function failureFrom(response, child, index, operation) {
  const envelope = response?.envelope;
  const steps = Array.isArray(envelope?.stepResults) ? envelope.stepResults : [];
  const failed = steps.filter(step => step?.success === false);
  const step = failed.find(step => token(step.data?.error) || token(step.error?.code) || token(step.errorCode)) ?? failed[0];
  const outer = token(response?.code) ?? token(response?.error?.code);
  const specific = token(step?.data?.error) ?? token(step?.error?.code) ?? token(step?.errorCode);
  let commandCode = 'COMMAND_FAILED';
  if (child.error?.code === 'ETIMEDOUT') commandCode = 'COMMAND_TIMEOUT';
  else if (child.error) commandCode = 'COMMAND_SPAWN_FAILED';
  else if (child.signal) commandCode = 'COMMAND_SIGNALLED';
  else if (response === null) commandCode = 'UNPARSEABLE_OUTPUT';
  const code = (outer !== 'COMMAND_FAILED' ? outer : undefined) ?? specific ?? token(envelope?.errorCode) ?? commandCode;
  const evidence = response?.details ?? envelope?.failureEvidence ?? {};
  const detail = step?.data ?? {};
  const scope = code === 'SNAPSHOT_EXTRACTION_FAILED' ? 'observation_extraction' : 'command_execution';
  return {
    code, message: `${scope === 'observation_extraction' ? 'Observation extraction' : 'Command'} failed (${code}). Inspect retained local evidence.`, scope,
    commandIndex: index, operation, ...facts(evidence),
    commandId: token(envelope?.commandId) ?? token(evidence.commandId), taskId: token(envelope?.taskId) ?? token(evidence.taskId),
    phase: token(detail.failurePhase) ?? token(evidence.phase) ?? 'unavailable',
    dispatchState: token(detail.dispatchState) ?? token(evidence.dispatchState) ?? 'unavailable',
    failedStep: step ? {id:token(step.id),actionType:token(step.actionType),code:specific,...facts(detail)} : undefined,
    extractionReason: token(detail.extractionReason),
    diagnostics: diagnostics(detail.diagnostics ?? detail.extractionDiagnostics),
    earlierEffects: Array.isArray(evidence.earlierEffects) ? evidence.earlierEffects.slice(0,16).map(effect=>({...facts(effect),effect:token(effect.effect)})) : undefined,
    probe: {commandId:token(evidence.probeCommandId),taskId:token(evidence.probeTaskId),dispatchState:token(evidence.probeDispatchState) ?? 'unavailable'},
    exitCode: Number.isInteger(child.status) ? child.status : null, signal:token(child.signal),
    references:{response:`command-${index}.json`,stdout:`command-${index}.stdout`,stderr:`command-${index}.stderr`},
  };
}
function failureError(failure) {
  const error = Error(failure.commandIndex === undefined ? failure.message : `Androperator command ${failure.commandIndex} failed: ${failure.code}; phase=${failure.phase}, dispatchState=${failure.dispatchState}; ${failure.message}`);
  error.failure = failure;
  return error;
}
function localFailure(code, scope, message) { return {code,scope,message,phase:'unavailable',dispatchState:'unavailable'}; }
module.exports = {failureFrom,failureError,localFailure,diagnostics};
