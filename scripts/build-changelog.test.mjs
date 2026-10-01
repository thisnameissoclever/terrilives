import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildChangelog, parseEntry } from './build-changelog.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const note = (title, change = 'A visible change.') => `# ${title}\n\nWhat players see.\n\n## Fixed\n- ${change}\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'natural-causes-changelog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/changelog'), { recursive: true });
  mkdirSync(join(root, 'web/changelog'), { recursive: true });
  for (const name of ['template.html', 'style.css', 'controls.js', 'legacy-anchors.json']) {
    copyFileSync(join(ROOT, 'web/changelog', name), join(root, 'web/changelog', name));
  }
  return {
    root,
    put: (name, source) => writeFileSync(join(root, 'docs/changelog', name), source),
  };
}

test('newest notes come first and only the latest date starts open', (t) => {
  const { root, put } = fixture(t);
  put('2026-07-29-first.md', note('First'));
  put('2026-10-01-z-controls.md', note('Newest'));
  put('2026-09-30-middle.md', note('Middle'));
  const html = buildChangelog(root);
  const ids = [...html.matchAll(/<article class="entry" id="([^"]+)">[\s\S]*?<details([^>]*)>/g)];
  assert.deepEqual(ids.map((match) => [match[1], match[2]]), [
    ['update-2026-10-01', ' open'], ['update-2026-09-30', ''], ['update-2026-07-29', ''],
  ]);
  assert.equal((html.match(/class="latest"/g) ?? []).length, 1);
  assert.equal(ids.length, 3);
});

test('legacy anchors reject malformed collections and unsafe identifiers', (t) => {
  const { root, put } = fixture(t);
  put('2026-10-01-first.md', note('First'));
  for (const value of [{}, [null], ['<script>'], ['2026-10-01-unsafe"id']]) {
    writeFileSync(join(root, 'web/changelog/legacy-anchors.json'), JSON.stringify(value));
    assert.throws(() => buildChangelog(root), /Legacy changelog anchors/);
  }
});

test('editing, adding and deleting source notes changes the generated page', (t) => {
  const { root, put } = fixture(t);
  const filename = '2026-09-30-first.md';
  put(filename, note('Original', 'Before the fix.'));
  assert.ok(buildChangelog(root).includes('Before the fix.'));
  put(filename, note('Corrected', 'After the fix.'));
  const edited = buildChangelog(root);
  assert.ok(edited.includes('After the fix.'));
  assert.ok(!edited.includes('Before the fix.'));
  put('2026-10-01-next.md', note('New update'));
  assert.equal((buildChangelog(root).match(/<article class="entry"/g) ?? []).length, 2);
  rmSync(join(root, 'docs/changelog', filename));
  const deleted = buildChangelog(root);
  assert.ok(!deleted.includes('Corrected'));
  assert.equal((deleted.match(/<article class="entry"/g) ?? []).length, 1);
});

test('HTML is escaped while bold, code and HTTPS links remain usable', (t) => {
  const { root, put } = fixture(t);
  put('2026-10-01-safe.md', note('<script>bad</script>', '**Save** keeps `<b>progress</b>`. [Evidence](https://example.com/?a=1&b=2)'));
  const html = buildChangelog(root);
  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(html.includes('<strong>Save</strong>'));
  assert.ok(html.includes('<code>&lt;b&gt;progress&lt;/b&gt;</code>'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  put('2026-10-01-safe.md', note('Unsafe URL', '[Bad](javascript:alert(1))'));
  assert.throws(() => buildChangelog(root), /HTTPS/);
});

test('literal template markers in a note cannot expand into presentation code', (t) => {
  const { root, put } = fixture(t);
  put('2026-10-01-tokens.md', note('Literal tokens', 'The value is {{STYLE}}.'));
  assert.ok(buildChangelog(root).includes('<li>The value is {{STYLE}}.</li>'));
});

test('invalid notes and empty collections fail instead of silently dropping content', (t) => {
  const { root, put } = fixture(t);
  assert.throws(() => buildChangelog(root), /at least one/);
  for (const [name, source] of [
    ['2026-02-31-bad.md', note('Invalid date')],
    ['undated.md', note('No date')],
    ['2026-10-01-bad.md', '# Title\n\n## Fixed\n- Change'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Fixed'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Future plans\n- Not implemented'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Fixed\n- Change\n\n## Fixed\n- Repeated'],
  ]) assert.throws(() => parseEntry(name, source), Error, name);
  put('undated.md', note('Should fail the entire build'));
  put('2026-10-01-good.md', note('Valid entry'));
  assert.throws(() => buildChangelog(root), /undated.md/);
});

test('wrapped summaries and continued list items preserve their meaning', () => {
  const entry = parseEntry('2026-10-01-wrapped.md', '# Title\r\n\r\nFirst line\r\nsecond line.\r\n\r\n## Fixed\r\n- First part\r\n  continued here.\r\n');
  assert.equal(entry.summary, 'First line second line.');
  assert.deepEqual(entry.sections[0].items, ['First part continued here.']);
});

test('public notes reject development references instead of publishing them', () => {
  for (const reference of ['PR #123', 'pull request 123', 'Commit abc123', 'CI passed', 'WASM memory', '[Details](https://github.com/owner/game/pull/12)']) {
    assert.throws(() => parseEntry('2026-10-01-note.md', note('Update', reference)), /write for players/);
  }
  assert.doesNotThrow(() => parseEntry('2026-10-01-note.md', note('Doors close quietly', 'Save your household and resume it later.')));
});

test('same-day notes must be consolidated and former links reach the dated update', (t) => {
  const { root, put } = fixture(t);
  put('2026-10-01-one.md', note('One'));
  const html = buildChangelog(root);
  assert.ok(html.includes('id="2026-10-01-walking-bubble"'));
  assert.ok(html.includes('id="2026-10-01-one"'));
  assert.ok(html.includes('href="#update-2026-10-01"'));
  put('2026-10-01-two.md', note('Two'));
  assert.throws(() => buildChangelog(root), /one changelog entry per date/);
});

function controls({ saved = null, blocked = false, hash = '' } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, open: false, attributes: {}, listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      focus() { this.focused = true; },
      closest() { return null; },
    });
    return elements.get(id);
  }
  const details = [element('first'), element('second')];
  details[0].open = true;
  const linked = { querySelector: () => details[1], scrollIntoView() { this.scrolled = true; } };
  element('old-link').closest = () => linked;
  const root = { dataset: {} };
  const window = { addEventListener(name, listener) { this[name] = listener; } };
  const storage = { value: saved, getItem() { if (blocked) throw new Error('Blocked'); return this.value; }, setItem(_key, value) { if (blocked) throw new Error('Blocked'); this.value = value; } };
  runInNewContext(readFileSync(join(ROOT, 'web/changelog/controls.js'), 'utf8'), {
    document: { documentElement: root, getElementById: element, querySelector: element, querySelectorAll: () => details },
    localStorage: storage, location: { hash }, window,
    matchMedia: () => ({ matches: true }),
  });
  return { root, element, details, linked, storage, window };
}

test('dark is the default even on a light system; theme choices persist and blocked storage stays usable', () => {
  const page = controls();
  assert.equal(page.root.dataset.theme, 'dark');
  page.element('theme-toggle').listeners.click();
  assert.equal(page.root.dataset.theme, 'light');
  assert.equal(page.storage.value, 'light');
  assert.equal(page.element('theme-toggle').attributes['aria-pressed'], 'true');
  assert.equal(controls({ saved: page.storage.value }).root.dataset.theme, 'light');
  assert.equal(controls({ saved: 'unexpected' }).root.dataset.theme, 'dark');
  const blocked = controls({ blocked: true });
  blocked.element('theme-toggle').listeners.click();
  assert.equal(blocked.root.dataset.theme, 'light');
});

test('expand and collapse switch controls and keep keyboard focus; old links open the right update', () => {
  const page = controls();
  const expand = page.element('expand-all');
  const collapse = page.element('collapse-all');
  assert.equal(collapse.hidden, true);
  expand.listeners.click();
  assert.ok(page.details.every((entry) => entry.open));
  assert.equal(expand.hidden, true);
  assert.equal(collapse.focused, true);
  collapse.listeners.click();
  assert.ok(page.details.every((entry) => !entry.open));
  assert.equal(expand.focused, true);
  const linked = controls({ hash: '#old-link' });
  assert.equal(linked.details[1].open, true);
  assert.equal(linked.linked.scrolled, true);
  assert.doesNotThrow(() => controls({ hash: '#%not-a-valid-escape' }));
});

test('the repository history renders and the CLI writes the same standalone page', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'natural-causes-changelog-cli-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const output = join(folder, 'changelog/index.html');
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-changelog.mjs'), output]);
  const html = readFileSync(output, 'utf8');
  assert.equal(html, buildChangelog());
  assert.ok(html.includes('The first playable alpha'));
  assert.ok(html.includes('Build controls, meals, shared beds and solid doors'));
  assert.doesNotMatch(html, /github\.com|\bPRs?\b|pull request|\bcommits?\b/i);
  assert.ok(html.includes('window.addEventListener'));
  assert.ok(html.includes('href="../"'));
  assert.equal(new URL('../', 'https://thisnameissoclever.github.io/terrilives/changelog/').pathname, '/terrilives/');
});
