import test from 'node:test';
import assert from 'node:assert/strict';
import { copySnippet } from '../../sites/landing/copy.mjs';
import { renderMarkdown } from '../../sites/landing/render.mjs';

test('copy preserves multiline code literally and reports clipboard failures', async () => {
  const code = 'echo "<device>"\nsecond command\n';
  const status = { textContent: '' };
  const button = { dataset: {}, setAttribute(name, value) { this[name] = value; }, closest: () => ({ querySelector: selector => selector === 'pre code' ? { textContent: code } : status }) };
  let copied;
  await copySnippet(button, { writeText: async text => { copied = text; } });
  assert.equal(copied, code);
  assert.equal(button['aria-label'], 'Copied');
  assert.equal(button.disabled, false);
  await copySnippet(button, { writeText: async () => { throw new Error('Denied'); } });
  assert.equal(button['aria-label'], 'Retry copy');
  assert.match(status.textContent, /Copy failed/);
  assert.equal(button.disabled, false);
});

test('only ordinary code fences receive copy controls', () => {
  const html = renderMarkdown('```bash\necho <value>\n```\n```mermaid\nflowchart LR\n A --> B\n```');
  assert.equal((html.match(/class="copy-code"/g) ?? []).length, 1);
  assert.match(html, /echo &lt;value&gt;/);
});
