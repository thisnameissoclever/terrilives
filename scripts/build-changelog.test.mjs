import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildChangelog, parseEntry } from './build-changelog.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const note = (title, change = 'A visible change.') => `# ${title}\n\nWhat players see.\n\n## Bug fixes\n- ${change}\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'natural-causes-changelog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/changelog'), { recursive: true });
  mkdirSync(join(root, 'web/changelog'), { recursive: true });
  for (const name of ['template.html', 'style.css', 'controls.js']) {
    copyFileSync(join(ROOT, 'web/changelog', name), join(root, 'web/changelog', name));
  }
  return {
    root,
    put: (name, source) => writeFileSync(join(root, 'docs/changelog', name), source),
  };
}

test('newest notes come first and only the newest two start open', (t) => {
  const { root, put } = fixture(t);
  put('2026-07-29-first.md', note('First'));
  put('2026-10-01-z-controls.md', note('Newest'));
  put('2026-09-30-middle.md', note('Middle'));
  const html = buildChangelog(root);
  const ids = [...html.matchAll(/<article class="entry" id="([^"]+)">\s*<details([^>]*)>/g)];
  assert.deepEqual(ids.map((match) => [match[1], match[2]]), [
    ['2026-10-01-z-controls', ' open'], ['2026-09-30-middle', ' open'], ['2026-07-29-first', ''],
  ]);
  assert.equal((html.match(/class="latest"/g) ?? []).length, 1);
  assert.ok(html.includes('3 updates so far.'));
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
  assert.ok(buildChangelog(root).includes('2 updates so far.'));
  rmSync(join(root, 'docs/changelog', filename));
  const deleted = buildChangelog(root);
  assert.ok(!deleted.includes('Corrected'));
  assert.ok(deleted.includes('1 updates so far.'));
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
    ['2026-10-01-bad.md', '# Title\n\n## Bug fixes\n- Change'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Bug fixes'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Future plans\n- Not implemented'],
    ['2026-10-01-bad.md', '# Title\n\nSummary\n\n## Bug fixes\n- Change\n\n## Bug fixes\n- Repeated'],
  ]) assert.throws(() => parseEntry(name, source), Error, name);
  put('undated.md', note('Should fail the entire build'));
  put('2026-10-01-good.md', note('Valid entry'));
  assert.throws(() => buildChangelog(root), /undated.md/);
});

test('wrapped summaries and continued list items preserve their meaning', () => {
  const entry = parseEntry('2026-10-01-wrapped.md', '# Title\r\n\r\nFirst line\r\nsecond line.\r\n\r\n## Bug fixes\r\n- First part\r\n  continued here.\r\n');
  assert.equal(entry.summary, 'First line second line.');
  assert.deepEqual(entry.sections[0].items, ['First part continued here.']);
});

test('the repository history renders and the CLI writes the same standalone page', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'natural-causes-changelog-cli-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const output = join(folder, 'changelog/index.html');
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-changelog.mjs'), output]);
  const html = readFileSync(output, 'utf8');
  assert.equal(html, buildChangelog());
  assert.ok(html.includes('The first playable alpha'));
  assert.ok(html.includes('Read the game&#39;s update history'));
  assert.ok(html.includes('window.addEventListener'));
  assert.ok(html.includes('href="../"'));
  assert.equal(new URL('../', 'https://thisnameissoclever.github.io/terrilives/changelog/').pathname, '/terrilives/');
});
