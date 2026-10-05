export async function copySnippet(button, clipboard = globalThis.navigator?.clipboard) {
  const snippet = button.closest('.code-snippet');
  const status = snippet.querySelector('.copy-status');
  button.disabled = true;
  try {
    await clipboard.writeText(snippet.querySelector('pre code').textContent);
    button.textContent = 'Copied';
    status.textContent = 'Code copied to clipboard.';
  } catch {
    button.textContent = 'Retry copy';
    status.textContent = 'Copy failed. Select the code and copy it manually.';
  } finally {
    button.disabled = false;
  }
}

globalThis.document?.addEventListener('click', event => {
  const button = event.target.closest('.copy-code');
  if (button) void copySnippet(button);
});
