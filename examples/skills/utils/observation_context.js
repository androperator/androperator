// Provider-neutral compact-v1 evidence handling. No device calls or goal selection.
const STATE_KEYS = ['enabled', 'checked', 'checkable', 'selected', 'visibleToUser',
  'clickable', 'scrollable', 'accessibilityDataSensitive'];
const STRING_KEYS = ['resourceId', 'className', 'text', 'contentDescription', 'bounds'];
const bytes = value => Buffer.byteLength(JSON.stringify(value));
// Native NodeMatcher compares UiNode.label: nonblank text, then description.
const selectorLabel = node => node.text?.trim() ? node.text : node.contentDescription?.trim() ? node.contentDescription : '';

function bounds(value) {
  const match = typeof value === 'string' && /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value);
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (![left, top, right, bottom].every(Number.isSafeInteger) || right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}
function rectangle(value) {
  return value && ['left', 'top', 'right', 'bottom'].every(k => Number.isFinite(value[k])) &&
    value.right > value.left && value.bottom > value.top;
}
function intersects(a, b) {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
    Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}
function ancestors(node, byPath) {
  const result = [];
  const seen = new Set([node.nodePath]);
  for (let parent = node.parentPath; parent !== null && parent !== undefined;) {
    if (seen.has(parent)) throw Error('Invalid compact ancestry cycle');
    seen.add(parent);
    const next = byPath.get(parent);
    if (!next) break;
    result.push(next);
    parent = next.parentPath;
  }
  return result;
}
function normalizeCompact(snapshot, context = {}) {
  const compact = snapshot?.compact;
  const envelope = snapshot?.envelope;
  const step = envelope?.stepResults?.find(s => s.actionType === 'snapshot' && s.success);
  if (envelope?.status !== 'success' || !step || compact?.schemaVersion !== 1 || !Array.isArray(compact.nodes)) {
    throw Error('Invalid compact-v1 snapshot; retain source and reacquire');
  }
  if (typeof envelope.commandId !== 'string' || !envelope.commandId ||
      compact.commandId !== envelope.commandId || compact.taskId !== envelope.taskId) throw Error('Capture identity mismatch');
  if (!Number.isInteger(compact.totalNodes) || !Number.isInteger(compact.returnedNodes) ||
      compact.returnedNodes !== compact.nodes.length || compact.totalNodes < compact.returnedNodes ||
      compact.omittedNodes !== compact.totalNodes - compact.returnedNodes || typeof compact.truncated !== 'boolean') {
    throw Error('Invalid compact coverage counts');
  }
  const byPath = new Map();
  for (const source of compact.nodes) {
    if (typeof source.nodePath !== 'string' || !source.nodePath || byPath.has(source.nodePath) ||
        !(source.parentPath === null || typeof source.parentPath === 'string')) throw Error('Invalid compact node identity');
    const node = { nodePath: source.nodePath, parentPath: source.parentPath };
    for (const key of STRING_KEYS) {
      if (!Object.hasOwn(source, key)) continue;
      if (source[key] !== null && typeof source[key] !== 'string') throw Error('Invalid compact text or bounds');
      node[key] = source[key];
    }
    for (const key of STATE_KEYS) {
      if (!Object.hasOwn(source, key)) continue;
      if (source[key] !== null && typeof source[key] !== 'boolean') throw Error('Invalid compact state');
      node[key] = source[key];
    }
    for (const key of ['textTruncated', 'contentDescriptionTruncated']) {
      if (Object.hasOwn(source, key) && typeof source[key] !== 'boolean') throw Error('Invalid compact truncation');
      if (Object.hasOwn(source, key)) node[key] = source[key];
    }
    byPath.set(node.nodePath, node);
  }
  const nodes = [...byPath.values()];
  const missingParents = nodes.filter(n => n.parentPath !== null && !byPath.has(n.parentPath)).length;
  for (const node of nodes) ancestors(node, byPath);
  const textTruncated = nodes.some(n => n.textTruncated || n.contentDescriptionTruncated);
  const incomplete = compact.truncated || compact.omittedNodes > 0 || textTruncated || missingParents > 0;
  const viewport = context.viewport;
  if (viewport !== undefined && (!rectangle(viewport.bounds) || !viewport.reference || !viewport.observedAt)) throw Error('Invalid viewport evidence');
  return {
    schemaVersion: 1,
    provenance: {
      captureId: envelope.commandId, taskId: envelope.taskId,
      sourceKind: 'androperator-compact-v1', receivedAt: context.receivedAt ?? null,
      device: context.device ?? null, operatorPackage: context.operatorPackage ?? null,
      foregroundPackage: step.data?.foreground_package ?? null,
      sourceReference: context.sourceReference ?? null,
      rawReference: snapshot.rawArtifactPath ?? compact.rawArtifactPath ?? null,
      viewport: viewport ?? null,
    },
    coverage: { source: incomplete ? 'incomplete' : 'complete', scope: 'returned-accessibility-tree',
      totalNodes: compact.totalNodes, returnedNodes: nodes.length, omittedNodes: compact.omittedNodes,
      truncated: compact.truncated, textTruncated, missingParents },
    nodes,
  };
}
function targetEvidence(observation, node, kind) {
  const byPath = new Map(observation.nodes.map(n => [n.nodePath, n]));
  const chain = [node, ...ancestors(node, byPath)];
  const reasons = [];
  const geometry = bounds(node.bounds);
  const viewport = observation.provenance.viewport?.bounds;
  const viewportIntersection = geometry && viewport ? intersects(geometry, viewport) : null;
  if (observation.coverage.source !== 'complete') reasons.push('incomplete_source');
  if (node.visibleToUser !== true || chain.some(n => n.visibleToUser === false)) reasons.push('visibility_not_true');
  if (node.enabled !== true || chain.some(n => n.enabled === false)) reasons.push('enabled_not_true');
  if (chain.some(n => n.accessibilityDataSensitive === true)) reasons.push('sensitive_context');
  if (!geometry) reasons.push('invalid_or_missing_bounds');
  if (viewportIntersection !== true) reasons.push(viewportIntersection === false ? 'outside_viewport' : 'viewport_unknown');
  // Clipping containers matter even when the platform reports a descendant visible.
  if (geometry && chain.slice(1).some(n => bounds(n.bounds) && !intersects(geometry, bounds(n.bounds)))) reasons.push('outside_ancestor');
  let actionNode;
  let selector;
  if (kind === 'click') {
    actionNode = chain.find(n => n.clickable === true && n.enabled === true && n.visibleToUser === true);
    if (!actionNode) reasons.push('no_clickable_context');
    else if (!bounds(actionNode.bounds) || (viewport && !intersects(bounds(actionNode.bounds), viewport))) reasons.push('invalid_clickable_geometry');
    if (typeof node.text === 'string' && node.text.trim() && observation.nodes.filter(n => selectorLabel(n) === node.text).length === 1) selector = { textEquals: node.text };
  } else if (kind === 'scroll') {
    actionNode = node;
    if (node.scrollable !== true) reasons.push('not_scrollable');
    if (typeof node.resourceId === 'string' && node.resourceId.trim() && observation.nodes.filter(n => n.resourceId === node.resourceId).length === 1) selector = { resourceId: node.resourceId };
  } else throw Error('Unsupported candidate kind');
  if (!selector) reasons.push('selector_not_unique_or_supported');
  return { reasons, viewportIntersection, actionNodePath: actionNode?.nodePath ?? null, selector: selector ?? null };
}
function projectObservation(observation, { selectPaths, candidateSpecs = [], maxNodes = 64, maxBytes = 24000 } = {}) {
  if (!Array.isArray(selectPaths) || !Number.isInteger(maxNodes) || maxNodes < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) throw Error('Invalid projection limits or selection');
  const byPath = new Map(observation.nodes.map(n => [n.nodePath, n]));
  const selected = new Set();
  for (const path of [...selectPaths, ...candidateSpecs.map(c => c.nodePath)]) {
    const node = byPath.get(path);
    if (!node) throw Error('Projection selection references an unobserved node');
    selected.add(path);
    for (const parent of ancestors(node, byPath)) selected.add(parent.nodePath);
  }
  const ids = new Set();
  const candidates = [], hints = [];
  for (const spec of candidateSpecs) {
    if (typeof spec.id !== 'string' || !spec.id || ids.has(spec.id)) throw Error('Invalid candidate id');
    ids.add(spec.id);
    const evidence = targetEvidence(observation, byPath.get(spec.nodePath), spec.kind);
    const candidate = { id: spec.id, kind: spec.kind, nodePath: spec.nodePath, ...evidence };
    (evidence.reasons.length ? hints : candidates).push(candidate);
  }
  const result = {
    schemaVersion: 1, provenance: observation.provenance,
    coverage: { source: observation.coverage, projection: {
      selectedNodes: selected.size, retainedNodes: selected.size,
      deliberateOmissions: observation.nodes.length - selected.size, budgetOmissions: 0, truncated: false,
    } },
    nodes: observation.nodes.filter(n => selected.has(n.nodePath)), candidates, discoveryHints: hints,
    needsRicherEvidence: observation.coverage.source !== 'complete',
    recovery: 'Inspect sourceReference/rawReference or reacquire with task-appropriate limits; missing text is not proof of absence.',
  };
  // Keep the selected semantic group and its complete ancestry together or decline it.
  // Never shorten a value, silently orphan a node, or expose a half-proved action.
  if (selected.size > maxNodes || bytes(result) > maxBytes) {
    result.nodes = []; result.candidates = []; result.discoveryHints = [];
    Object.assign(result.coverage.projection, { retainedNodes: 0, budgetOmissions: selected.size, truncated: true });
    result.needsRicherEvidence = true;
  }
  if (bytes(result) > maxBytes) throw Error('Projection budget cannot hold coverage and provenance; increase maxBytes');
  return result;
}
module.exports = { normalizeCompact, projectObservation, targetEvidence, ancestors, bounds, bytes };
