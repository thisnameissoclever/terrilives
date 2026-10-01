import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SECTIONS = new Set(['Features & changes', 'Bug fixes', 'Art & sound']);

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

/** Render the documented inline subset; source HTML always stays text. */
function inline(text) {
  const tokens = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let result = '';
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    result += escapeHtml(text.slice(end, match.index));
    if (match[1]) result += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2]) result += `<strong>${escapeHtml(match[2])}</strong>`;
    else {
      const url = new URL(match[4]);
      if (url.protocol !== 'https:') throw new Error('Changelog links must use HTTPS');
      result += `<a href="${escapeHtml(url.href)}">${escapeHtml(match[3])}</a>`;
    }
    end = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(end));
}

/** Read one dated entry. Refuse malformed notes rather than silently omit them. */
export function parseEntry(filename, source) {
  const match = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(filename);
  if (!match || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) {
    throw new Error(`${filename}: use a real YYYY-MM-DD date and a lowercase slug`);
  }
  const lines = source.replace(/\r\n/g, '\n').trim().split('\n');
  const title = /^# (\S.*)$/.exec(lines.shift() ?? '')?.[1];
  if (!title) throw new Error(`${filename}: start with one # title`);
  const summary = [];
  const sections = [];
  let section;
  let summaryEnded = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (summary.length) summaryEnded = true;
      continue;
    }
    if (line.startsWith('## ')) {
      const heading = line.slice(3);
      if (!SECTIONS.has(heading) || sections.some((item) => item.heading === heading)) {
        throw new Error(`${filename}: unsupported or repeated section ${heading}`);
      }
      section = { heading, items: [] };
      sections.push(section);
    } else if (section && line.startsWith('- ')) {
      if (!line.slice(2).trim()) throw new Error(`${filename}: empty change`);
      section.items.push(line.slice(2));
    } else if (section && /^\s{2,}\S/.test(raw) && section.items.length) {
      section.items[section.items.length - 1] += ` ${line}`;
    } else if (!section && !summaryEnded && !/^[#*-]/.test(line)) {
      summary.push(line);
    } else {
      throw new Error(`${filename}: use a summary paragraph, ## sections and - changes`);
    }
  }
  if (!summary.length || !sections.length || sections.some((item) => !item.items.length)) {
    throw new Error(`${filename}: each entry needs a summary and nonempty change sections`);
  }
  return { id: filename.slice(0, -3), date: match[1], title, summary: summary.join(' '), sections };
}

function entryHtml(entry, index) {
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${entry.date}T00:00:00Z`));
  const title = escapeHtml(entry.title);
  return `<article class="entry" id="${entry.id}">
    <details${index < 2 ? ' open' : ''}>
      <summary>
        <span class="entry-heading"><span class="entry-meta"><time datetime="${entry.date}">${date}</time>${index === 0 ? '<span class="latest">Latest</span>' : ''}</span><h2>${title}</h2></span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="entry-body"><p>${inline(entry.summary)}</p>${entry.sections.map((section) =>
        `<h3>${escapeHtml(section.heading)}</h3><ul>${section.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`,
      ).join('')}</div>
    </details>
    <a class="permalink" href="#${entry.id}" aria-label="Permalink to ${title}" title="Permalink"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></svg></a>
  </article>`;
}

/** Produce the complete page from source documents, with no runtime fetches. */
export function buildChangelog(root = ROOT) {
  const folder = join(root, 'docs/changelog');
  const entries = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort().reverse()
    .map((name) => parseEntry(name, readFileSync(join(folder, name), 'utf8')));
  if (!entries.length) throw new Error('The changelog must contain at least one dated entry');
  const template = readFileSync(join(root, 'web/changelog/template.html'), 'utf8');
  const replacements = new Map([
    ['{{COUNT}}', String(entries.length)],
    ['{{ENTRIES}}', entries.map(entryHtml).join('\n')],
    ['{{STYLE}}', readFileSync(join(root, 'web/changelog/style.css'), 'utf8')],
    ['{{SCRIPT}}', readFileSync(join(root, 'web/changelog/controls.js'), 'utf8')],
  ]);
  for (const token of replacements.keys()) {
    if (!template.includes(token)) throw new Error(`Changelog template is missing ${token}`);
  }
  return template.replace(/\{\{(?:COUNT|ENTRIES|STYLE|SCRIPT)\}\}/g, (token) => replacements.get(token));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve(process.argv[2] ?? join(ROOT, 'web/dist/changelog/index.html'));
  const html = buildChangelog();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  console.log(`Built changelog: ${output}`);
}
