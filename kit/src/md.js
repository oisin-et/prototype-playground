// Markdown to HTML for the reader (after Studio's): headings, paragraphs,
// lists, tables, code, emphasis, links and images with their captions.
// Everything is escaped first, so nothing in a file can run in the page.
// Relative images resolve against `base`; a link to another file keeps its
// target in data-href, for the reader to follow. Part of the
// prototype-playground kit.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const resolve = (src, base) => {
  if (/^(https?:|data:)/.test(src) || !base) return src;
  try { return new URL(src, base).href; } catch { return src; }
};

const inline = (s, base) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  // ![caption](src "credit"): a picture with its caption and credit under it.
  .replace(/!\[([^\]]*)\]\(\s*([^)"\s][^)"]*?)\s*(?:&quot;([^)]*?)&quot;)?\s*\)/g, (_, alt, src, credit) =>
    `<span class="md-fig"><img alt="${alt}" src="${resolve(src.trim(), base)}">${alt || credit ? `<span class="md-cap">${alt}${credit ? `<small>${credit}</small>` : ''}</span>` : ''}</span>`)
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => (/^https?:/.test(href) ? `<a href="${href}" target="_blank" rel="noreferrer">${t}</a>` : `<span class="link" data-href="${href}">${t}</span>`))
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

export const md = (text, base) => {
  const lines = String(text || '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hd = l.match(/^(#{1,4})\s+(.*)$/);
    if (hd) { out.push(`<h${hd[1].length}>${inline(hd[2], base)}</h${hd[1].length}>`); i++; continue; }
    if (/^\|/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const row = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, base)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item, base)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para = [l];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '), base)}</p>`);
  }
  return out.join('\n');
};
