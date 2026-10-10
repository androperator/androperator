// Example-owned policy. The Node verifier has no Settings strings or OCR dependency.
const {createHash} = require('node:crypto');
function metadata(snapshot) {
  if (snapshot?.envelope?.status !== 'success' || !Array.isArray(snapshot.compact?.nodes)
      || snapshot.compact.truncated !== false) throw Error('Complete successful compact snapshot required');
  const data = snapshot.envelope.stepResults.find(step => step.actionType === 'snapshot' && step.success)?.data;
  if (typeof data?.foreground_package !== 'string' || !data.foreground_package.trim() || data.has_overlay !== 'false') {
    throw Error('Unambiguous foreground without an overlay is required');
  }
  return data;
}
// On the tested build the painted heading has zero-width, invisible accessibility
// bounds. Use independently visible page content, not a claim that this heading is visible.
function semanticLabels(labels) {
  const content = labels.filter(label => label !== 'About phone');
  return content.length ? content : ['Basic info', 'Device name'];
}
function semantic(snapshot, labels) {
  const data = metadata(snapshot);
  return data.foreground_package === 'com.android.settings' && semanticLabels(labels).every(label => snapshot.compact.nodes.some(node => node.visibleToUser === true && node.text === label));
}
function contextKey(snapshot, labels, display) {
  const data = metadata(snapshot);
  const relevant = snapshot.compact.nodes.filter(node => node.visibleToUser === true && semanticLabels(labels).includes(node.text))
    .map(node => [node.nodePath, node.resourceId, node.text, node.bounds]);
  return createHash('sha256').update(JSON.stringify([data.foreground_package, data.has_overlay,
    data.window_count, display, relevant])).digest('hex');
}
function visual(rows, labels) {
  if (!Array.isArray(rows)) throw Error('Pixel recognizer must return rows');
  // A Settings-list entry saying About phone is not its destination header.
  const title = rows.some(row => row.text === 'About phone' && row.confidence >= 0.5 && row.top > 0.05 && row.top < 0.18);
  return title && labels.filter(label => label !== 'About phone').every(label => rows.some(row => row.text === label && row.confidence >= 0.5));
}
module.exports = {metadata, semantic, contextKey, visual};
