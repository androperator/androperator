function staleObservation(observation = {}, reason = 'refresh_required') {
  return {...observation, candidates:[], freshness:{status:'stale',reason},
    ...(observation.evidence ? {evidence:{...observation.evidence,candidates:[],freshness:{status:'stale',reason}}} : {})};
}
function invalidate(state, reason) {
  return {...state,observedAt:0,observation:staleObservation(state.observation,reason)};
}
function publicObservation(state, now = Date.now()) {
  if (!state.observedAt || now-state.observedAt>45000 || state.pendingOverlay) return staleObservation(state.observation, state.observation?.freshness?.reason ?? 'expired');
  return {...state.observation,freshness:{status:'current',observedAt:state.observedAt,expiresAt:state.observedAt+45000}};
}
module.exports = {staleObservation,invalidate,publicObservation};
