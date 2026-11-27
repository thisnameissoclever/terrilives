'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');

test('the export channel checks the sender before it reaches the dialog', () => {
  const start = MAIN.indexOf("ipcMain.handle('natural-causes:export'");
  assert.notEqual(start, -1, 'the export channel is registered');
  const handler = MAIN.slice(start, MAIN.indexOf('});', start));
  const trusted = handler.indexOf('trustedSaveRequest(event);');
  const exported = handler.indexOf('exportSaveFile(name, bytes)');
  assert.notEqual(trusted, -1);
  assert.notEqual(exported, -1);
  assert.ok(trusted < exported, 'trustedSaveRequest runs first');
});

test('the preload exposes the export channel the page calls', () => {
  assert.match(PRELOAD, /exportFile: \(name, bytes\) => ipcRenderer\.invoke\('natural-causes:export', name, bytes\)/);
});

test('the export file writer limits saves to MAX_SAVE_BYTES', () => {
  const start = MAIN.indexOf('createExportFile({');
  assert.notEqual(start, -1, 'createExportFile is called');
  const call = MAIN.slice(start, MAIN.indexOf('});', start));
  assert.match(call, /maxBytes:\s*MAX_SAVE_BYTES\b/);
});
