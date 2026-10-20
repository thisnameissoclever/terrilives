import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const headingLine = (line) => /^(#{1,3}) (.+?)(?: \{#([a-z][a-z0-9-]*)\})?$/.exec(line);

export function playerHeadingIds(source) {
  return new Set(source.replace(/\r\n/g, '\n').split('\n').map(headingLine).filter(Boolean).map((h) => h[3] ?? slug(h[2])));
}

/** A deliberately small Markdown format; author text never executes as HTML. */
export function parsePlayerMarkdown(source, context) {
  const { filename, pages, prefix, root, numbers = {}, links = [], assets = new Map() } = context;
  const headings = [], ids = new Set(), illustrations = [];
  function url(value, image = false) {
    if (image) {
      if (!value.startsWith('images/') || /[?#\\]/.test(value)) throw Error(`${filename}: unsupported image ${value}`);
      if (!/\.(png|jpe?g|gif|webp)$/i.test(value)) throw Error(`${filename}: unsupported image format ${value}`);
      const base = resolve(root, 'docs/player/images'), file = resolve(root, 'docs/player', value);
      if (!file.startsWith(base + sep) || !existsSync(file)) throw Error(`${filename}: missing image ${value}`);
      if (!assets.has('guide/' + value)) {
        const header = Buffer.alloc(12), descriptor = openSync(file, 'r');
        try { readSync(descriptor, header, 0, 12, 0); } finally { closeSync(descriptor); }
        const valid = /\.png$/i.test(value) ? header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : /\.jpe?g$/i.test(value) ? header[0] === 255 && header[1] === 216 && header[2] === 255
          : /\.gif$/i.test(value) ? /^GIF8[79]a/.test(header.toString('ascii'))
          : header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!valid) throw Error(`${filename}: invalid image signature ${value}`);
      }
      assets.set('guide/' + value, file);
      return prefix + value;
    }
    if (/^https:\/\//.test(value)) return value;
    if (/^(mailto:)/.test(value)) return value;
    if (value.startsWith('#')) { links.push({ from: filename, target: filename, fragment: value.slice(1) }); return value; }
    const match = /^([a-z0-9-]+)\/(?:#([a-z0-9-]+))?$/.exec(value);
    if (!match || !pages.has(match[1])) throw Error(`${filename}: unsafe or unsupported link ${value}`);
    links.push({ from: filename, target: match[1], fragment: match[2] });
    return prefix + value;
  }
  function inline(text) {
    const tokens = /\{\{number:([\w.-]+)\}\}|!\[([^\]]*)\]\(([^\s)]+)\)|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
    let out = '', end = 0;
    for (const m of text.matchAll(tokens)) {
      out += escapeHtml(text.slice(end, m.index));
      if (m[1]) {
        const value = m[1].split('.').reduce((v, k) => v?.[k], numbers);
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${filename}: unknown number ${m[1]}`);
        out += `<span class="reference-number">${escapeHtml(Number(value.toPrecision(6)))}</span>`;
      } else if (m[2] !== undefined) out += `<img class="guide-inline-image" loading="lazy" src="${escapeHtml(url(m[3], true))}" alt="${escapeHtml(m[2])}">`;
      else if (m[4]) out += `<a href="${escapeHtml(url(m[5]))}">${escapeHtml(m[4])}</a>`;
      else if (m[6]) out += `<strong>${escapeHtml(m[6])}</strong>`;
      else if (m[7]) out += `<code>${escapeHtml(m[7])}</code>`;
      else out += `<em>${escapeHtml(m[8])}</em>`;
      end = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(end));
  }
  const lines = source.replace(/\r\n/g, '\n').split('\n'), html = [];
  let paragraph = [], list, table = [], disclosure = false, title, titleId;
  function flush() {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
    if (list) html.push(`</${list}>`);
    list = undefined;
    if (table.length) {
      const rows = table.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row));
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      html.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(headings.at(-1)?.text ?? 'Reference table')}"><table><thead><tr>${cells(rows[0]).map((cell) => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      table = [];
    }
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (/<\/?[a-zA-Z][^>]*>/.test(line)) throw Error(`${filename}: raw HTML is unsupported`);
    const illustration = /^:::illustration ([a-z][a-z0-9-]*)$/.exec(line);
    if (illustration) {
      flush();
      if (!context.renderIllustration) throw Error(`${filename}: illustrations are unavailable`);
      illustrations.push({ id: illustration[1], heading: headings.at(-1)?.id });
      html.push(context.renderIllustration(illustration[1], (value) => url(value, true)));
      continue;
    }
    const disclosureStart = /^:::(numbers|screenshots)\s+(.+)$/.exec(line);
    if (disclosureStart) { flush(); if (disclosure) throw Error(`${filename}: nested disclosures`); disclosure = true; html.push(`<details class="${disclosureStart[1]}"><summary>${inline(disclosureStart[2])}</summary><div>`); continue; }
    if (line === ':::') { flush(); if (!disclosure) throw Error(`${filename}: unmatched disclosure`); disclosure = false; html.push('</div></details>'); continue; }
    const heading = headingLine(line);
    if (heading) {
      flush(); const text = heading[2], id = heading[3] ?? slug(text);
      if (!id || ids.has(id)) throw Error(`${filename}: duplicate anchor ${id}`);
      if (['main', 'guide-query', 'search-results', 'guide-search-data', 'theme-toggle', 'guide-image-viewer', 'guide-image-title'].includes(id)) throw Error(`${filename}: reserved anchor ${id}`);
      ids.add(id);
      if (heading[1].length === 1) { if (title) throw Error(`${filename}: more than one title`); title = text; titleId = id; continue; }
      headings.push({ id, text, level: heading[1].length });
      html.push(`<h${heading[1].length} id="${id}" tabindex="-1">${escapeHtml(text)} <a class="heading-link" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a></h${heading[1].length}>`); continue;
    }
    if (!line.trim()) {
      const next = lines.slice(lineIndex + 1).find((candidate) => candidate.trim()) ?? '';
      if (list && (list === 'ol' ? /^\d+\. / : /^[-*] /).test(next)) continue;
      flush(); continue;
    }
    if (line.startsWith('|')) { if (paragraph.length || list) flush(); table.push(line); continue; }
    const item = /^(?:([-*]) |\d+\. )(.+)$/.exec(line);
    if (item) {
      if (paragraph.length || table.length) flush();
      const tag = item[1] ? 'ul' : 'ol';
      if (list !== tag) { if (list) html.push(`</${list}>`); html.push(`<${tag}>`); list = tag; }
      html.push(`<li>${inline(item[2])}</li>`); continue;
    }
    if (list || table.length) flush();
    paragraph.push(line.trim());
  }
  flush();
  if (disclosure) throw Error(`${filename}: unclosed numbers disclosure`);
  if (!title) throw Error(`${filename}: missing title`);
  return { title, titleId, headings, ids, illustrations, html: html.join('\n') };
}
