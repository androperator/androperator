const crypto = require('node:crypto');
const {normalizeCompact, projectObservation, ancestors} = require('./observation_context');
const LABELS = { androidVersion: 'Android version', buildNumber: 'Build number' };
const NAVIGATION = /^(About (?:phone|tablet|device|emulated device)|Software (?:information|info)|Device information|Android version)$/i;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalize(snapshot, options = {}) {
  const observation = normalizeCompact(snapshot, options.context);
  const compact = snapshot.compact;
  const step = snapshot.envelope.stepResults.find(s => s.actionType === 'snapshot' && s.success);
  if (observation.coverage.source !== 'complete') throw Error('Snapshot failed or truncated/incomplete; inspect retained source and reacquire before choosing actions');
  if (step.data.foreground_package !== 'com.android.settings') throw Error('Unexpected foreground; return control to Codex');
  if (step.data.has_overlay !== 'false' && !(step.data.has_overlay === 'true' && options.allowedOverlayPackage && step.data.overlay_package === options.allowedOverlayPackage)) throw Error('Unexpected overlay; Codex must inspect screenshot before continuing');
  const nodes = observation.nodes;
  const visible = nodes.filter(n => n.visibleToUser === true && n.enabled === true && n.accessibilityDataSensitive !== true);
  const byPath = new Map(nodes.map(n => [n.nodePath, n]));
  const fields = {};
  for (const [field, label] of Object.entries(LABELS)) {
    const labels = visible.filter(n => n.text === label);
    if (labels.length !== 1) continue;
    const node = labels[0];
    // Samsung wraps the title in title_frame while the summary is its sibling.
    // Ascend only one extra transparent level; never search the next row for a value.
    let scopePath=node.parentPath;
    for(let depth=0;depth<2;depth++) {
      const inScope=n=>{
        let parent=n.parentPath;
        for(let hop=0;hop<nodes.length;hop++) {
          if(parent===scopePath) return true;
          const ancestor=byPath.get(parent);
          if(!ancestor) return false;
          parent=ancestor.parentPath;
        }
        return false;
      };
      const texts=visible.filter(n=>n.text?.trim() && inScope(n));
      const values=texts.filter(n=>n.nodePath!==node.nodePath);
      if(texts.length===2 && values.length===1 && values[0].resourceId?.endsWith('/summary')) {
        fields[field]={label,value:values[0].text,labelPath:node.nodePath,valuePath:values[0].nodePath,parentPath:scopePath};
        break;
      }
      if(texts.length!==1) break;
      const scope=byPath.get(scopePath);
      if(!scope || (scope.resourceId && !scope.resourceId.endsWith('/title_frame'))) break;
      scopePath=scope.parentPath;
    }
  }
  const specs = [];
  for (const n of nodes) {
    if (!NAVIGATION.test(n.text) || (n.text === LABELS.androidVersion && fields.androidVersion)) continue;
    specs.push({id:`tap-${specs.length}`,kind:'click',nodePath:n.nodePath});
  }
  const scrolls = nodes.filter(n => n.scrollable === true).sort((a,b) => ancestors(b,byPath).length - ancestors(a,byPath).length);
  for (const [index,n] of scrolls.entries()) specs.push({id:`list-${index}`,kind:'scroll',nodePath:n.nodePath});
  const headingNodes = visible.filter(n => NAVIGATION.test(n.text) || NAVIGATION.test(n.contentDescription) || ['Settings','Search Settings','System'].includes(n.text));
  const fieldPaths = Object.values(fields).flatMap(f => [f.labelPath,f.valuePath]);
  const evidence = projectObservation(observation, {selectPaths:[...headingNodes.map(n=>n.nodePath),...fieldPaths],candidateSpecs:specs});
  if(evidence.needsRicherEvidence) throw Error('Settings projection insufficient; inspect retained source or narrow the selection');
  const candidates = [];
  for (const offered of evidence.candidates.filter(c=>c.kind==='click')) {
    const text=offered.selector.textEquals;
    candidates.push({...offered, description:`Open visible ${text} row`, command:['click','--text',text]});
  }
  // Goal policy prefers the deepest eligible list, measured through parent edges.
  const scroll=evidence.candidates.find(c=>c.kind==='scroll');
  if(scroll) for(const direction of ['down','up']) candidates.push({...scroll,id:`scroll-${direction}`,description:`Scroll visible list ${direction}`,command:['scroll',direction,'--container-id',scroll.selector.resourceId]});
  const headings=headingNodes.map(n=>NAVIGATION.test(n.text) || ['Settings','Search Settings','System'].includes(n.text) ? n.text : n.contentDescription);
  return { captureId: observation.provenance.captureId, headings:[...new Set(headings)], fields, candidates, evidence,
    signature: digest(visible.map(n => [n.nodePath,n.text,n.bounds])), totalNodes:compact.totalNodes, returnedNodes:compact.returnedNodes, truncated:compact.truncated };

}
function validateRead(response, field, observed) {
  const label = LABELS[field];
  const step = response.envelope?.stepResults?.find(s => s.actionType === 'read_key_value_pair' && s.success && s.data.label === label);
  if (response.envelope?.status !== 'success' || !step || typeof step.data.value !== 'string' || !step.data.value.trim() || step.data.value !== observed.value) throw Error(`UI read does not match associated snapshot row: ${field}`);
  return step;
}
function validateChoice(response, criteria, threshold = 0.6) {
  const answer = response.answers?.next_action;
  if (response.model !== 'jev-1.13.0' || answer?.type !== 'choice' || !Object.hasOwn(criteria,answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence < threshold || answer.confidence > 1) throw Error('Invalid or uncertain Jev answer');
  const p=answer.probabilities;
  if (!p || Object.keys(p).length !== Object.keys(criteria).length || Object.keys(criteria).some(k => !Number.isFinite(p[k]) || p[k]<0 || p[k]>1) || Math.abs(Object.values(p).reduce((a,b)=>a+b,0)-1)>0.02 || p[answer.choice] < Math.max(...Object.values(p))) throw Error('Invalid Jev probability distribution');
  return answer.choice;
}
module.exports={ LABELS, normalize, validateRead, validateChoice, digest };
