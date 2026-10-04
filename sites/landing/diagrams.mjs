import mermaid from 'mermaid';

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    primaryColor: dark ? '#203323' : '#edf7df',
    primaryTextColor: dark ? '#e8eef9' : '#172033',
    primaryBorderColor: '#78ad24',
    lineColor: dark ? '#a9cb7c' : '#527526',
    secondaryColor: dark ? '#182536' : '#f3f6fb',
    tertiaryColor: dark ? '#182536' : '#f3f6fb',
    fontFamily: 'system-ui, sans-serif',
  },
});
// Keep readable source visible if rendering fails or JavaScript is disabled.
for (const diagram of document.querySelectorAll('.diagram')) {
  try {
    const original = diagram.querySelector('code').textContent;
    const source = matchMedia('(max-width: 760px)').matches ? original.replace('flowchart LR', 'flowchart TB') : original;
    const { svg } = await mermaid.render(`diagram-${diagram.dataset.index}`, source);
    const visual = document.createElement('div');
    visual.className = 'diagram-visual';
    visual.innerHTML = svg;
    diagram.prepend(visual);
    diagram.classList.add('rendered');
  } catch (error) {
    console.error('Could not render flowchart', error);
  }
}
