import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, parsePlayerMarkdown, playerHeadingIds } from './player-markdown.mjs';
import { baselineHtml, validatePlayerCoverage } from './player-coverage.mjs';
import { addScreenshotGalleries } from './player-screenshots.mjs';
import { addActivityFilters } from './player-activity-filters.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
function searchText(html) {
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&quot;': '"' };
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;|&lt;|&gt;|&#39;|&quot;/g, (entity) => entities[entity]).replace(/\s+/g, ' ').trim();
}
function load(root) {
  const folder = join(root, 'docs/player');
  const pages = JSON.parse(readFileSync(join(folder, 'navigation.json'), 'utf8')).pages;
  if (!Array.isArray(pages) || !pages.length) throw Error('Guide navigation needs pages');
  const ids = new Set();
  for (const page of pages) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug) || ids.has(page.slug) || page.slug === 'changelog' || !/^[a-z0-9-]+\.md$/.test(page.file)) throw Error('Invalid or duplicate guide topic ' + page.slug);
    ids.add(page.slug);
  }
  const data = join(folder, 'generated/reference.json');
  return { folder, pages, numbers: existsSync(data) ? JSON.parse(readFileSync(data, 'utf8')) : {} };
}

function shell(root, pages, title, prefix, body, current, toc, titleId = 'player-guide') {
  const template = readFileSync(join(root, 'web/changelog/template.html'), 'utf8');
  let header = template.slice(template.indexOf('<header'), template.indexOf('<main'));
  const game = current ? '../../' : '../';
  header = header.replaceAll('href="../"', `href="${game}"`).replaceAll('src="../branding/', `src="${game}branding/`)
    .replace('<h1>Changelog</h1>', `<h1 id="${escapeHtml(titleId)}" tabindex="-1">${escapeHtml(title)}</h1>`)
    .replace('New features, improvements and fixes.', current ? '<a href="../">Player guide</a>' : 'Controls, needs and household life.')
    .replace(/<div class="view-controls"[\s\S]*?<\/div>/, '');
  const nav = pages.map((p) => `<a href="${prefix}${p.slug}/"${p.slug === current ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>`).join('');
  const styles = readFileSync(join(root, 'web/changelog/style.css'), 'utf8') + '\n' + readFileSync(join(root, 'web/guide/style.css'), 'utf8');
  const script = readFileSync(join(root, 'web/guide/controls.js'), 'utf8');
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#11161d"><title>${escapeHtml(title)} | Natural Causes</title><link rel="icon" href="${game}favicon.ico"><style>${styles}</style></head><body><a class="skip-link" href="#main">Skip to guide</a>${header}<main id="main" tabindex="-1"><nav class="guide-topics" aria-label="Guide topics">${nav}</nav><form class="guide-search" role="search" action="${prefix}" data-prefix="${prefix}"><label for="guide-query">Search the player guide</label><div><input id="guide-query" name="q" type="search" autocomplete="off" placeholder="Try New housemate, snow or Social"><button type="submit">Search</button><button type="reset">Clear</button></div><section id="search-results" aria-live="polite" hidden></section><noscript><p>Browse the topics above and each page's contents to find an answer.</p></noscript></form>${toc}<article class="guide-article">${body}</article><footer><a href="${game}">Play the game</a><a href="${game}changelog/">Changelog</a></footer></main><script>${script}</script></body></html>`;
}

export function buildPlayerGuide(root = ROOT) {
  const { folder, pages, numbers } = load(root), names = new Set(pages.map((p) => p.slug));
  const links = [], assets = new Map(), rendered = new Map(), files = new Map();
  for (const page of pages) {
    const source = addScreenshotGalleries(root, readFileSync(join(folder, page.file), 'utf8'), page.slug, !!numbers.actions);
    rendered.set(page.slug, parsePlayerMarkdown(source, { root, filename: page.slug, pages: names, prefix: '../', links, assets, numbers }));
  }
  const activities = rendered.get('activities');
  const activityFilters = join(folder, 'activity-filters.json');
  if (activities && existsSync(activityFilters)) activities.html = addActivityFilters(activities.html, JSON.parse(readFileSync(activityFilters, 'utf8')));
  else if (activities && numbers.actions) throw Error('Missing reviewed activity filter tags');
  if (activities && numbers.actions) {
    if (activities.ids.has('baseline-values')) throw Error('activities: reserved generated anchor baseline-values');
    activities.ids.add('baseline-values');
    activities.headings.push({ id: 'baseline-values', text: 'Numbers and reference durations', level: 2 });
    activities.html += baselineHtml(numbers);
  }
  for (const link of links) {
    if (link.fragment && !rendered.get(link.target)?.ids.has(link.fragment)) throw Error(`${link.from}: missing fragment ${link.target}/#${link.fragment}`);
  }
  validatePlayerCoverage(root, numbers, rendered);
  const index = [];
  for (const page of pages) {
    const content = rendered.get(page.slug);
    const toc = content.headings.length ? `<nav class="page-contents" aria-label="On this page"><p>On this page</p>${content.headings.filter((h) => h.level === 2).map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`).join('')}</nav>` : '';
    files.set(`guide/${page.slug}/index.html`, shell(root, pages, page.title, '../', content.html, page.slug, toc, content.titleId));
    for (const h of content.headings) {
      const heading = new RegExp(`<h[23] id="${h.id}"[^>]*>[\\s\\S]*?<\\/h[23]>`).exec(content.html);
      const section = heading ? content.html.slice(heading.index + heading[0].length).split(/<h[23] /)[0] : '';
      const text = searchText(section);
      index.push({ title: h.text, page: page.title, url: `${page.slug}/#${h.id}`, excerpt: text.slice(0, 320), text });
    }
    const pageText = searchText(content.html);
    index.push({ title: page.title, page: page.title, url: page.slug + '/', excerpt: pageText.slice(0, 200), text: pageText });
  }
  const shortcuts = [['ui-elements', 'new-housemate', 'Add a housemate'], ['ui-elements', 'sim-details', "Find a person's needs"], ['home-and-controls', 'saves', 'Save or load a household']].filter(([slug, id]) => rendered.get(slug)?.ids.has(id));
  const home = `<p>Find the controls and activities you need to care for the household, build a home and understand what changes people's needs and relationships.</p><nav class="guide-shortcuts" aria-label="Common tasks">${shortcuts.map(([slug, id, label]) => `<a href="${slug}/#${id}">${label}</a>`).join('')}</nav><section class="guide-index">${pages.map((p) => `<a class="guide-index-item" href="${p.slug}/"><h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.description ?? rendered.get(p.slug).headings.slice(0, 3).map((h) => h.text).join('; '))}</p></a>`).join('')}</section>`;
  files.set('guide/index.html', shell(root, pages, 'Player guide', './', home, undefined, ''));
  files.set('guide/search-index.json', JSON.stringify(index));
  const searchData = JSON.stringify(index).replaceAll('<', '\\u003c');
  for (const [name, html] of files) if (name.endsWith('.html')) files.set(name, html.replace('<script>', `<script type="application/json" id="guide-search-data">${searchData}</script><script>`));
  for (const [name, file] of assets) files.set(name, readFileSync(file));
  return files;
}

export function renderQuickHelp(root = ROOT) {
  const { folder, pages, numbers } = load(root);
  const md = readFileSync(join(folder, 'quick-help.md'), 'utf8');
  const links = [];
  const parsed = parsePlayerMarkdown(md, { root, filename: 'quick-help', pages: new Set(pages.map((p) => p.slug)), prefix: './guide/', numbers, links });
  for (const link of links) {
    const target = pages.find((page) => page.slug === link.target);
    const ids = target ? playerHeadingIds(readFileSync(join(folder, target.file), 'utf8')) : parsed.ids;
    const generated = link.target === 'activities' && link.fragment === 'baseline-values' && numbers.actions;
    if (link.fragment && !ids.has(link.fragment) && !generated) throw Error(`quick-help: missing fragment ${link.target}/#${link.fragment}`);
  }
  return (`<span id="${parsed.titleId}"></span>` + parsed.html.split(/(?=<h2 )/).filter(Boolean).map((part, index) => {
    const heading = /^<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/.exec(part);
    if (!heading) return part;
    const title = heading[2].replace(/ <a class="heading-link"[\s\S]*$/, '');
    return `<details id="${heading[1]}" class="help-topic"${index === 0 ? ' open' : ''}><summary>${title}</summary>${part.slice(heading[0].length)}</details>`;
  }).join('')).replace(/\bid="([^"]+)"/g, 'id="help-topic-$1"').replace(/href="#([^"]+)"/g, 'href="#help-topic-$1"').replaceAll('<a href="./guide/', '<a target="_blank" rel="noopener" href="./guide/');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve(process.argv[2] ?? join(ROOT, 'web/dist'));
  for (const [name, source] of buildPlayerGuide()) { const file = join(output, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); }
  console.log(`Built player guide: ${join(output, 'guide/index.html')}`);
}
