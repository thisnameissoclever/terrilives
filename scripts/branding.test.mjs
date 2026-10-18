import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildChangelog } from './build-changelog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicFile = (name) => new URL(`../web/public/${name}`, import.meta.url);

for (const [name, path, read] of [
  ['game', '', () => readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')],
  ['changelog', 'changelog/', () => buildChangelog(root)],
  ['audio review', 'audio-review.html', () => readFileSync(publicFile('audio-review.html'), 'utf8')],
]) {
  test(`${name} resolves its icons inside the deployed project path`, () => {
    const html = read();
    const links = [...html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)];
    assert.equal(links.length, 2, 'Declare a favicon and a touch icon');
    for (const [tag] of links) {
      const href = tag.match(/href="([^"]+)"/)?.[1];
      assert.ok(href);
      const url = new URL(href, `https://example.test/terrilives/${path}`);
      assert.ok(url.pathname.startsWith('/terrilives/'), 'Keep the GitHub Pages project prefix');
      assert.ok(existsSync(publicFile(url.pathname.slice('/terrilives/'.length))), url.pathname);
    }
  });
}

test('the favicon contains real small and desktop-sized icon frames', () => {
  const ico = readFileSync(publicFile('favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + 16*i;
    const width = ico[entry] || 256;
    assert.equal(ico[entry+1] || 256, width);
    assert.ok(ico.readUInt32LE(entry+12) + ico.readUInt32LE(entry+8) <= ico.length);
    sizes.push(width);
  }
  assert.deepEqual(sizes, [16,24,32,48,64,128,256]);
});

test('both theme logos are transparent and have identical dimensions', () => {
  const logos = ['light','dark'].map((theme) => readFileSync(publicFile(`branding/logo-${theme}.png`)));
  for (const png of logos) assert.equal(png[25], 6, 'Use RGBA PNG, without a baked review background');
  assert.equal(logos[0].readUInt32BE(16), logos[1].readUInt32BE(16));
  assert.equal(logos[0].readUInt32BE(20), logos[1].readUInt32BE(20));
});
