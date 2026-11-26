'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { createExportFile } = require('../src/export-file.js');

const NAME = 'natural-causes-save-2026-11-26.ncsave';

function setup(overrides = {}) {
  const calls = { dialog: [], writes: [] };
  const exportFile = createExportFile({
    showSaveDialog: async (options) => {
      calls.dialog.push(options);
      return { canceled: false, filePath: path.join('chosen', 'my-save.ncsave') };
    },
    writeFile: async (filePath, bytes) => { calls.writes.push({ filePath, bytes }); },
    downloadsDirectory: () => 'downloads',
    join: path.join,
    maxBytes: 8,
    ...overrides,
  });
  return { exportFile, calls };
}

test('a cancelled dialog writes nothing and says cancelled', async () => {
  const { exportFile, calls } = setup({ showSaveDialog: async () => ({ canceled: true }) });
  assert.equal(await exportFile(NAME, new Uint8Array([1])), 'cancelled');
  assert.deepEqual(calls.writes, []);
});

test('a chosen path receives the bytes and says saved', async () => {
  const { exportFile, calls } = setup();
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await exportFile(NAME, bytes), 'saved');
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].filePath, path.join('chosen', 'my-save.ncsave'));
  assert.equal(calls.writes[0].bytes, bytes);
  assert.equal(calls.dialog[0].title, 'Export save');
  assert.equal(calls.dialog[0].defaultPath, path.join('downloads', NAME));
  assert.deepEqual(calls.dialog[0].filters, [{ name: 'Natural Causes save', extensions: ['ncsave'] }]);
});

test('names other than the save file pattern are rejected before any dialog', async () => {
  const { exportFile, calls } = setup();
  const bad = ['../' + NAME, 'save.ncsave', 'natural-causes-save-2026-11-26.json', NAME + 'x', 5, undefined];
  for (const name of bad) {
    await assert.rejects(exportFile(name, new Uint8Array([1])), /save file name/);
  }
  assert.deepEqual(calls.dialog, []);
});

test('bytes that are not a Uint8Array are rejected', async () => {
  const { exportFile, calls } = setup();
  for (const bytes of ['abc', [1, 2], new ArrayBuffer(2), null]) {
    await assert.rejects(exportFile(NAME, bytes), /must be bytes/);
  }
  assert.deepEqual(calls.dialog, []);
});

test('bytes over the limit are rejected', async () => {
  const { exportFile, calls } = setup();
  await assert.rejects(exportFile(NAME, new Uint8Array(9)), /larger than 256 MiB/);
  assert.equal(await exportFile(NAME, new Uint8Array(8)), 'saved');
  assert.equal(calls.dialog.length, 1);
});

test('a second export while a dialog is open is refused as cancelled', async () => {
  let release;
  const open = new Promise((resolve) => { release = resolve; });
  const dialogs = [];
  const { exportFile, calls } = setup({
    showSaveDialog: async (options) => {
      dialogs.push(options);
      await open;
      return { canceled: false, filePath: 'chosen.ncsave' };
    },
  });
  const first = exportFile(NAME, new Uint8Array([1]));
  assert.equal(await exportFile(NAME, new Uint8Array([2])), 'cancelled');
  assert.equal(dialogs.length, 1);
  release();
  assert.equal(await first, 'saved');
  assert.equal(calls.writes.length, 1);
  assert.equal(await exportFile(NAME, new Uint8Array([3])), 'saved');
});

test('a write failure rejects and frees the next export', async () => {
  let fail = true;
  const { exportFile } = setup({
    writeFile: async () => { if (fail) throw new Error('disk full'); },
  });
  await assert.rejects(exportFile(NAME, new Uint8Array([1])), /disk full/);
  fail = false;
  assert.equal(await exportFile(NAME, new Uint8Array([1])), 'saved');
});
