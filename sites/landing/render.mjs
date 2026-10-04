import MarkdownIt from 'markdown-it';

const repository = 'https://github.com/androperator/androperator';
const docs = 'https://docs.androperator.com';

export function publicUrl(value) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value)) return value;
  const url = new URL(value, 'https://repository.invalid/');
  const path = decodeURIComponent(url.pathname).slice(1);
  if (path === 'assets/androperator-logo.png' || path === 'docs/img/androperator-logo.png') return `/logo.png${url.search}${url.hash}`;
  if (path === 'docs/internal' || path.startsWith('docs/internal/')) return `${repository}/blob/main/${path}${url.search}${url.hash}`;
  if (path.startsWith('docs/') && path.endsWith('.md')) {
    const page = path.slice(5, -3).replace(/(?:^|\/)index$/, '');
    return `${docs}/${page}${!page || page.endsWith('/') ? '' : '/'}${url.search}${url.hash}`;
  }
  return `${repository}/blob/main/${path}${url.search}${url.hash}`;
}

export function renderMarkdown(source, { omitSections = [] } = {}) {
  // Input is the repository-owned README, including its inline logo HTML.
  const markdown = new MarkdownIt({ html: true });
  const defaultFence = markdown.renderer.rules.fence;
  let diagramIndex = 0;
  markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    if (tokens[index].info.trim() !== 'mermaid') return defaultFence(tokens, index, options, env, renderer);
    const code = markdown.utils.escapeHtml(tokens[index].content);
    const title = markdown.utils.escapeHtml(tokens[index].content.match(/^\s*accTitle: (.+)$/m)?.[1] ?? 'Agent workflow');
    return `<figure class="diagram" data-index="${diagramIndex++}"><pre><code>${code}</code></pre><figcaption>${title}</figcaption></figure>\n`;
  };
  const parsed = markdown.parse(source, {});
  let omitted = false;
  const tokens = parsed.filter((token, index) => {
    if (token.type === 'heading_open' && ['h1', 'h2'].includes(token.tag)) {
      omitted = omitSections.includes(parsed[index + 1].content);
    }
    return !omitted;
  });
  const headings = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const slug = tokens[i + 1].content.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
    const count = headings.get(slug) ?? 0;
    headings.set(slug, count + 1);
    tokens[i].attrSet('id', count ? `${slug}-${count}` : slug);
  }
  function visit(items) {
    for (const token of items) {
      if (token.type === 'link_open') token.attrSet('href', publicUrl(token.attrGet('href')));
      if (token.type === 'image') token.attrSet('src', publicUrl(token.attrGet('src')));
      if (token.type === 'html_inline' || token.type === 'html_block') {
        token.content = rewriteHtmlUrls(token.content, markdown.utils.escapeHtml);
      }
      if (token.children) visit(token.children);
    }
  }
  visit(tokens);
  const html = markdown.renderer.render(tokens, markdown.options, {});
  return html.split(/(?=<h2\b)/).map((section, index) =>
    `<section class="${index === 0 ? 'intro' : 'content-section'}">${section}</section>`
  ).join('\n');
}

function rewriteHtmlUrls(source, escape = value => value) {
  return source.replace(/\b(href|src)=(["'])(.*?)\2/g, (_, attribute, quote, url) => `${attribute}=${quote}${escape(publicUrl(url))}${quote}`);
}

// Keep README Markdown readable at its new URL without rewriting shell examples.
export function publicMarkdown(source) {
  let fence;
  return source.split('\n').map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    return rewriteHtmlUrls(line.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (_, start, url, end) => `${start}${publicUrl(url)}${end}`));
  }).join('\n');
}
