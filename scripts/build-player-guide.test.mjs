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

test('UI screenshot coverage requires a complete desktop and phone pair', (t) => {
  const { root, put } = fixture(t);
  put('screenshots.json', JSON.stringify({ entries: [{ id: 'options', section: 'options', desktop: 'images/options-desktop.png', description: 'Options', access: 'Choose Options.' }] }));
  assert.throws(() => buildPlayerGuide(root), /Incomplete desktop\/mobile screenshot pair/);
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  mkdirSync(join(root, 'docs/player/images'));
  writeFileSync(join(root, 'docs/player/images/options-desktop.png'), png);
  writeFileSync(join(root, 'docs/player/images/options-mobile.png'), png);
  put('screenshots.json', JSON.stringify({ entries: [{ id: 'options', section: 'options', desktop: 'images/options-desktop.png', mobile: 'images/options-mobile.png', description: 'Options', access: 'Choose Options.' }] }));
  const files = buildPlayerGuide(root);
  assert.match(files.get('guide/ui-elements/index.html'), /<details class="screenshots">/);
  assert.match(files.get('guide/ui-elements/index.html'), /Phone location/);
  assert.ok(files.has('guide/images/options-mobile.png'));
});
