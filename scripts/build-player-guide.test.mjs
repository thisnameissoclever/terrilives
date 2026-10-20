import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPlayerGuide, renderQuickHelp } from './build-player-guide.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'player-guide-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/player'), { recursive: true });
  mkdirSync(join(root, 'web/changelog'), { recursive: true });
  mkdirSync(join(root, 'web/guide'), { recursive: true });
  for (const name of ['style.css', 'template.html', 'controls.js']) copyFileSync(new URL('../web/changelog/' + name, import.meta.url), join(root, 'web/changelog', name));
  for (const name of ['style.css', 'controls.js']) copyFileSync(new URL('../web/guide/' + name, import.meta.url), join(root, 'web/guide', name));
  const put = (name, text) => writeFileSync(join(root, 'docs/player', name), text);
  put('navigation.json', JSON.stringify({ pages: [{ slug: 'start-here', title: 'Start here', file: 'start-here.md' }, { slug: 'ui-elements', title: 'UI elements', file: 'ui-elements.md' }] }));
  put('start-here.md', '# Start here\n\nSee [Options](ui-elements/#options).\n');
  put('ui-elements.md', '# UI elements\n\n## Options {#options}\n\nChoose New housemate.\n');
  return { root, put };
}

test('renders portable cross-page anchors and keeps Changelog outside topic navigation', (t) => {
  const { root } = fixture(t);
  const files = buildPlayerGuide(root);
  const html = files.get('guide/start-here/index.html');
  assert.match(html, /href="\.\.\/ui-elements\/#options"/);
  assert.match(files.get('guide/ui-elements/index.html'), /id="options"/);
  assert.match(files.get('guide/ui-elements/index.html'), /id="ui-elements"/);
  assert.doesNotMatch(html.match(/<nav[^>]*aria-label="Guide topics"[\s\S]*?<\/nav>/)?.[0] ?? '', /Changelog/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /Skip to guide/);
});

test('rejects missing fragments, duplicate anchors and unknown numeric references', (t) => {
  const { root, put } = fixture(t);
  put('start-here.md', '# Start here\n\n[Missing](ui-elements/#missing)\n');
  assert.throws(() => buildPlayerGuide(root), /missing.*fragment|fragment.*missing/i);
  put('start-here.md', '# Start here\n\n## One {#same}\n\n## Two {#same}\n');
  assert.throws(() => buildPlayerGuide(root), /duplicate.*anchor/i);
  put('start-here.md', '# Start here\n\n## Controls {#main}\n');
  assert.throws(() => buildPlayerGuide(root), /reserved anchor/);
  put('start-here.md', '# Start here\n\n## Controls {#guide-search-data}\n');
  assert.throws(() => buildPlayerGuide(root), /reserved anchor/);
  put('start-here.md', '# Start here\n\n{{number:does.not.exist}}\n');
  assert.throws(() => buildPlayerGuide(root), /number.*does.not.exist/i);
});

test('rejects unsafe links, missing images and executable markup', (t) => {
  const { root, put } = fixture(t);
  put('start-here.md', '# Start here\n\n[Click](javascript:alert)\n');
  assert.throws(() => buildPlayerGuide(root), /unsafe|unsupported.*link/i);
  put('start-here.md', '# Start here\n\n![Options](images/missing.png)\n');
  assert.throws(() => buildPlayerGuide(root), /missing.*image/i);
  put('start-here.md', '# Start here\n\n<script>alert(1)</script>\n');
  assert.throws(() => buildPlayerGuide(root), /raw HTML/i);
  mkdirSync(join(root, 'docs/player/images'));
  for (const file of ['attack.html', 'attack.svg', 'attack.png']) {
    writeFileSync(join(root, 'docs/player/images', file), '<script>alert(1)</script>');
    put('start-here.md', `# Start here\n\n![Open](images/${file})\n`);
    assert.throws(() => buildPlayerGuide(root), /unsupported image format|invalid image signature/);
  }
});

test('quick Help is authored once and uses the same validated Markdown parser', (t) => {
  const { root, put } = fixture(t);
  put('quick-help.md', '# Help\n\n## People and actions {#people}\n\n1. Select a name.\n\n2. Open [the guide](ui-elements/#options).\n');
  const html = renderQuickHelp(root);
  assert.match(html, /class="help-topic"/);
  assert.match(html, /href="\.\/guide\/ui-elements\/#options"/);
  assert.match(html, /Select a name/);
  assert.equal((html.match(/<ol>/g) ?? []).length, 1, 'blank-separated steps remain one ordered list');
  put('quick-help.md', '# Help\n\n## People {#people}\n\n[Jump](#people)\n');
  const local = renderQuickHelp(root);
  assert.match(local, /id="help-topic-people"/);
  assert.match(local, /href="#help-topic-people"/);
  put('quick-help.md', '# Help\n\n## People\n\n### Detail {#detail}\n\n[Jump](#detail)\n');
  const detail = renderQuickHelp(root);
  assert.match(detail, /id="help-topic-detail"/);
  assert.match(detail, /href="#help-topic-detail"/);
  put('quick-help.md', '# Help\n\n## People\n\n[Broken](ui-elements/#missing)\n');
  assert.throws(() => renderQuickHelp(root), /missing fragment/);
});

test('search indexes words after the displayed excerpt without leaking markup', (t) => {
  const { root, put } = fixture(t);
  put('start-here.md', '# Start here\n\n## Company {#company}\n\nAlex\'s feelings & needs. ' + 'A useful explanation. '.repeat(30) + 'Still lonely? Try correspondence.\n');
  const rows = JSON.parse(buildPlayerGuide(root).get('guide/search-index.json'));
  const row = rows.find((item) => item.url === 'start-here/#company');
  assert.match(row.text, /lonely/);
  assert.doesNotMatch(row.excerpt, /tabindex|id=/);
  for (const item of rows) {
    assert.doesNotMatch(item.text, /&#39;|&amp;/, 'search text uses readable characters for sections and whole pages');
    assert.doesNotMatch(item.excerpt, /&#39;|&amp;/);
  }
});

function illustratedFixture(t) {
  const { root, put } = fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  mkdirSync(join(root, 'docs/player/images'));
  for (const name of ['options-desktop', 'options-mobile', 'needs-desktop', 'needs-mobile', 'unused-desktop', 'unused-mobile']) {
    put(`images/${name}.png`, png);
  }
  const figures = Object.fromEntries(['options', 'needs', 'unused'].map((id) => [id, {
    title: `${id} panel`,
    desktop: `images/${id}-desktop.png`,
    mobile: `images/${id}-mobile.png`,
    caption: `${id} illustration caption`,
  }]));
  const registry = () => put('illustrations.json', JSON.stringify({ version: 1, figures }));
  registry();
  put('ui-elements.md', '# UI elements\n\n## Options {#options}\n\nChoose New housemate.\n\n:::illustration options\n\n## Needs {#needs}\n\nSelect Sim details.\n\n:::illustration needs\n');
  return { root, put, figures, registry };
}

test('publishes only authored illustrations and provides one article viewer and layout switch', (t) => {
  const { root, put } = illustratedFixture(t);
  put('screenshots.json', JSON.stringify({ entries: [{ id: 'capture-only', section: 'options', desktop: 'images/unused-desktop.png', mobile: 'images/unused-mobile.png', description: 'Inventory-only capture', access: 'Capture access instructions.' }] }));
  const files = buildPlayerGuide(root);
  const html = files.get('guide/ui-elements/index.html');
  const article = html.match(/<article class="guide-article">([\s\S]*?)<\/article>/)?.[1] ?? '';
  assert.equal((article.match(/<aside class="guide-illustration"/g) ?? []).length, 2);
  assert.match(article, /data-illustration="options"/);
  assert.match(article, /data-illustration="needs"/);
  assert.match(article, /width="1" height="1" src="\.\.\/images\/options-desktop.png"/);
  assert.equal((article.match(/<dialog id="guide-image-viewer"/g) ?? []).length, 1);
  assert.equal((html.match(/<fieldset class="screenshot-layout"/g) ?? []).length, 1);
  assert.equal((html.match(/<input type="radio" name="screenshot-layout"/g) ?? []).length, 2);
  assert.doesNotMatch(article, /target="_blank"|<a[^>]+href="[^"]+\.(?:png|jpe?g)"/);
  assert.doesNotMatch(article, /unused|capture-only|Inventory-only capture|Capture access instructions/);
  assert.ok(files.has('guide/images/options-desktop.png'));
  assert.ok(files.has('guide/images/options-mobile.png'));
  assert.ok(files.has('guide/images/needs-desktop.png'));
  assert.ok(files.has('guide/images/needs-mobile.png'));
  assert.ok(!files.has('guide/images/unused-desktop.png'));
  assert.ok(!files.has('guide/images/unused-mobile.png'));
  assert.doesNotMatch(files.get('guide/start-here/index.html'), /<dialog id="guide-image-viewer"|<fieldset class="screenshot-layout"/);
  const search = JSON.parse(files.get('guide/search-index.json'));
  const options = search.find((row) => row.url === 'ui-elements/#options');
  assert.match(options.text, /Choose New housemate/);
  for (const row of search) {
    assert.doesNotMatch(`${row.text} ${row.excerpt}`, /illustration caption|options panel|needs panel|Desktop|Phone|Enlarge|Screenshot layout|Select image|Inventory-only capture/);
  }
});

test('authored illustrations reject incomplete pairs, unknown IDs and missing image files', (t) => {
  const { root, put, figures, registry } = illustratedFixture(t);
  const mobile = figures.options.mobile;
  delete figures.options.mobile;
  registry();
  assert.throws(() => buildPlayerGuide(root), /Incomplete desktop\/mobile illustration: options/);
  figures.options.mobile = mobile;
  registry();
  put('ui-elements.md', '# UI elements\n\n## Options {#options}\n\n:::illustration unknown\n');
  assert.throws(() => buildPlayerGuide(root), /illustration: unknown/);
  put('ui-elements.md', '# UI elements\n\n## Options {#options}\n\n:::illustration options\n');
  figures.options.mobile = 'images/missing.png';
  registry();
  assert.throws(() => buildPlayerGuide(root), /missing image images\/missing.png/);
});

test('illustration sizing rejects truncated PNGs and zero dimensions', (t) => {
  const { root, put } = illustratedFixture(t);
  const truncated = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  put('images/options-desktop.png', truncated);
  assert.throws(() => buildPlayerGuide(root), /valid PNG or JPEG with dimensions/);
  const zeroWidth = Buffer.alloc(24);
  truncated.copy(zeroWidth);
  zeroWidth.writeUInt32BE(1, 20);
  put('images/options-desktop.png', zeroWidth);
  assert.throws(() => buildPlayerGuide(root), /Invalid illustration dimensions: options/);
});
