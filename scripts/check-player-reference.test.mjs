import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refreshReview, checkReference } from './check-player-reference.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'player-reference-'));
  const write = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    write('content/tuning.toml', 'scale = 1\n');
    write('crates/terri-sim/src/social.rs', 'fn reward() {}\n');
    write('crates/terri-sim/src/social/helper.rs', 'fn scale() {}\n');
    write('docs/player/generated/reference.json', '{"schema_version":1,"actions":[],"needs":{},"tuning":{}}\n');
    refreshReview(root);
    run(root, write);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('reviewed source and snapshot pass without invoking Rust', () => fixture(root => {
  assert.deepEqual(checkReference(root), []);
}));

test('browser-boundary Rust and HTML changes require guide review', () => fixture((root, write) => {
  write('crates/terri-wasm/src/browser.rs', 'pub fn labels() {}\n');
  write('web/index.html', '<button>Options</button>\n');
  assert.match(checkReference(root).join('\n'), /Unreviewed source: crates\/terri-wasm\/src\/browser.rs/);
  assert.match(checkReference(root).join('\n'), /Unreviewed source: web\/index.html/);
}));

test('generated WASM declarations are build products rather than reviewed sources', () => fixture((root, write) => {
  write('web/src/wasm/terri_wasm.d.ts', 'export function generated(): void;\n');
  assert.deepEqual(checkReference(root), []);
}));

test('editing a nested gameplay helper requires review', () => fixture((root, write) => {
  write('crates/terri-sim/src/social/helper.rs', 'fn scale() { changed(); }\n');
  assert.match(checkReference(root).join('\n'), /Changed reviewed source:.*helper.rs/);
}));

test('new gameplay files cannot bypass source inventory', () => fixture((root, write) => {
  write('crates/terri-sim/src/new_effect.rs', 'fn surprise() {}\n');
  assert.match(checkReference(root).join('\n'), /Unreviewed source:.*new_effect.rs/);
}));

test('changing only a generated numeric value fails snapshot integrity', () => fixture((root, write) => {
  write('docs/player/generated/reference.json', '{"schema_version":1,"actions":[],"needs":{},"tuning":{"scale":999}}\n');
  assert.match(checkReference(root).join('\n'), /Generated reference changed/);
}));

test('deleting a reviewed source requires review', () => fixture(root => {
  rmSync(join(root, 'content/tuning.toml'));
  assert.match(checkReference(root).join('\n'), /Missing reviewed source:.*tuning.toml/);
}));

test('line ending differences are portable across checkouts', () => fixture((root, write) => {
  write('content/tuning.toml', 'scale = 1\r\n');
  assert.deepEqual(checkReference(root), []);
}));

test('missing review and malformed reference fail with useful messages', () => fixture((root, write) => {
  write('docs/player/generated/reference.json', '{broken');
  assert.match(checkReference(root).join('\n'), /Invalid generated player reference JSON/);
  rmSync(join(root, 'docs/player/reviewed-sources.json'));
  assert.deepEqual(checkReference(root), ['Missing player guide source review record.']);
}));

test('CLI rejects unknown arguments even when invoked from another directory', () => {
  const command = fileURLToPath(new URL('./check-player-reference.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [command, '--unknown'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: --unknown/);
  assert.equal(result.stdout, '');
});
