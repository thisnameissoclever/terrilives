'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  CONTENT_TYPES, ISOLATION_HEADERS, OPAQUE_EXTENSIONS, START_URL, contentType, resolveRequestPath, respond,
} = require('../src/app-protocol.js');

function bundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-protocol-'));
  fs.mkdirSync(path.join(root, 'guide'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Natural Causes</title>');
  fs.writeFileSync(path.join(root, 'guide', 'index.html'), 'guide');
  fs.writeFileSync(path.join(root, 'assets', 'game.js'), 'export {};');
  fs.writeFileSync(path.join(root, 'assets', 'atlas.r8.gz'), Buffer.from([0x1f, 0x8b, 8, 0]));
  fs.writeFileSync(path.join(root, 'game.wasm'), Buffer.from([0, 97, 115, 109]));
  fs.writeFileSync(path.join(path.dirname(root), `${path.basename(root)}-secret.txt`), 'outside');
  return root;
}

function assertIsolated(response) {
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get('Content-Encoding'), null);
}

test('the game starts at natural-causes://game/index.html', () => {
  assert.equal(START_URL, 'natural-causes://game/index.html');
});

test('a file is streamed with its type and the isolation headers', async () => {
  const root = bundle();
  const page = await respond(root, 'natural-causes://game/index.html');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assertIsolated(page);
  assert.match(await page.text(), /Natural Causes/);
  const wasm = await respond(root, 'natural-causes://game/game.wasm');
  assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())], [0, 97, 115, 109]);
});

test('a gzip file is sent as its own bytes, never with Content-Encoding', async () => {
  const response = await respond(bundle(), 'natural-causes://game/assets/atlas.r8.gz');
  assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  assertIsolated(response);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x1f, 0x8b, 8, 0]);
});

test('a folder or trailing slash serves its index.html', async () => {
  const root = bundle();
  for (const url of ['natural-causes://game/guide/', 'natural-causes://game/guide', 'natural-causes://game/']) {
    const response = await respond(root, url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8', url);
  }
});

test('anything outside the bundle or another host is a 404 with the isolation headers', async () => {
  const root = bundle();
  const secret = `${path.basename(root)}-secret.txt`;
  for (const url of [
    `natural-causes://game/../${secret}`,
    `natural-causes://game/%2e%2e/${secret}`,
    `natural-causes://game/%2E%2E%2F${secret}`,
    `natural-causes://game/guide%5c..%5c..%5c${secret}`,
    'natural-causes://game/%00index.html',
    'natural-causes://game/index.html::$DATA',
    'natural-causes://game/index.html%3A%3A%24DATA',
    'natural-causes://game/C:/Windows/win.ini',
    'natural-causes://game/missing.js',
    'natural-causes://other/index.html',
    'https://game/index.html',
    `natural-causes://game/${encodeURIComponent(path.join(path.dirname(root), secret))}`,
  ]) {
    const response = await respond(root, url);
    assert.equal(response.status, 404, url);
    assertIsolated(response);
  }
});

test('request paths are resolved inside the root only', () => {
  const root = path.resolve('/bundle');
  assert.equal(resolveRequestPath(root, 'natural-causes://game/assets/a.js'), path.join(root, 'assets', 'a.js'));
  assert.equal(resolveRequestPath(root, 'natural-causes://game/a%20b.png'), path.join(root, 'a b.png'));
  assert.equal(resolveRequestPath(root, 'natural-causes://game/guide/'), path.join(root, 'guide', 'index.html'));
  assert.equal(resolveRequestPath(root, 'natural-causes://game/%E0%A4%A'), null);
  assert.equal(resolveRequestPath(root, 'not a url'), null);
});

test('content types cover the table and fall back to opaque bytes', () => {
  assert.equal(contentType('a.MJS'), 'text/javascript');
  assert.equal(contentType('a.md'), 'text/markdown; charset=utf-8');
  assert.equal(contentType('a.rgba'), 'application/octet-stream');
  assert.equal(contentType('a.bin'), 'application/octet-stream');
});

test('every file extension in the built game has a deliberate content type', () => {
  const dist = path.resolve(__dirname, '../../web/dist');
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Build web/dist first: npm --prefix web run build');
  const extensions = new Set();
  for (const name of fs.readdirSync(dist, { recursive: true })) {
    const file = path.join(dist, String(name));
    if (fs.statSync(file).isFile()) extensions.add(path.extname(file).toLowerCase());
  }
  // An empty or partial build must not pass by having nothing to check.
  for (const required of ['.html', '.js', '.wasm', '.png']) assert.ok(extensions.has(required), `web/dist has no ${required} file`);
  const known = new Set([...Object.keys(CONTENT_TYPES), ...OPAQUE_EXTENSIONS]);
  const unknown = [...extensions].filter((extension) => !known.has(extension));
  assert.deepEqual(unknown, [], 'Add these extensions to CONTENT_TYPES or OPAQUE_EXTENSIONS in desktop/src/app-protocol.js');
});
