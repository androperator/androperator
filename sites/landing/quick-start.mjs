const section = document.querySelector('#quick-start')?.closest('section');
if (section) {
  const methods = [
    ['One-liner', 'curl -fsSL', false],
    ['npm', 'npm install -g', false],
    ['brew', 'brew install', true],
  ];
  const snippets = [...section.querySelectorAll('.code-snippet')];
  const entries = methods.map(([name, prefix, hasNote]) => {
    const snippet = snippets.find(node => node.querySelector('code').textContent.startsWith(prefix));
    return { name, snippet, description: snippet?.previousElementSibling, note: hasNote ? snippet?.nextElementSibling : null };
  });
  // Keep the readable Markdown layout if any installation method is missing.
  if (entries.every(entry => entry.snippet && entry.description)) {
    const card = document.createElement('div');
    card.className = 'install-card';
    card.innerHTML = '<div class="install-toolbar"><span class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></span><div class="install-switch" role="radiogroup" aria-label="Installation method"></div></div>';
    entries[0].description.before(card);
    const controls = card.querySelector('.install-switch');
    const panels = entries.map((entry, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'installation-method';
      input.checked = index === 0;
      input.setAttribute('aria-controls', `install-method-${index}`);
      const text = document.createElement('span');
      text.textContent = entry.name;
      label.append(input, text);
      controls.append(label);
      const panel = document.createElement('div');
      panel.id = `install-method-${index}`;
      panel.className = 'install-panel';
      panel.hidden = index !== 0;
      panel.append(entry.description, entry.snippet);
      if (entry.note) panel.append(entry.note);
      card.append(panel);
      input.addEventListener('change', () => {
        panels.forEach((item, selected) => { item.hidden = selected !== index; });
      });
      return panel;
    });
    const emulator = snippets.find(node => node.querySelector('code').textContent.startsWith('androperator emulator provision'));
    if (emulator) {
      const row = document.createElement('div');
      row.className = 'install-panel';
      row.append(emulator.previousElementSibling, emulator);
      card.append(row);
    }
  }
}
