const header = document.querySelector('.site-header');
const links = [...document.querySelectorAll('[data-section]')];
const sections = links.map(link => ({ link, target: document.getElementById(link.dataset.section) }))
  .filter(section => section.target);

if (sections.length) {
  let pending = false;
  function update() {
    pending = false;
    const headerHeight = header.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--header-offset', `${headerHeight + 24}px`);
    const focusLine = headerHeight + Math.min(innerHeight * 0.22, 180);
    const ordered = sections.filter(section => section.link.getClientRects().length > 0)
      .map(section => ({ ...section, top: section.target.getBoundingClientRect().top }))
      .sort((first, second) => first.top - second.top);
    const active = ordered.filter(section => section.top <= focusLine).at(-1) ?? ordered[0];
    for (const section of sections) {
      if (section.link === active?.link) section.link.setAttribute('aria-current', 'location');
      else section.link.removeAttribute('aria-current');
    }
  }
  function requestUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }
  addEventListener('scroll', requestUpdate, { passive: true });
  addEventListener('resize', requestUpdate);
  new ResizeObserver(requestUpdate).observe(header);
  // Diagrams can change section positions after the initial page load.
  new ResizeObserver(requestUpdate).observe(document.querySelector('main'));
  update();
}
