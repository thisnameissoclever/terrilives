'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { MAX_SAVE_BYTES, SaveFiles, isSaveName } = require('../src/save-files.js');

function folder() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nc-saves-')), 'saves');
}

test('accepts every name the save code can write', () => {
  const names = [
    'terri-save-1.bin',
    'terri-save-1.previous.bin',
    'terri-save-1.damaged.bin',
    'terri-save-1.damaged-1764000000000-3.bin',
    'terri-save-1.v1-backup.bin',
    'terri-save-1.v30-backup.bin',
    'terri-save-1.v22-backup.bin',
    'terri-save-1.v22-editable-backup.bin',
    'terri-save-1.v22-published-backup.bin',
    'terri-save-1.v23-editable-backup.bin',
    'terri-save-1.v23-published-backup.bin',
    'terri-save-1.v23-standard-backup.bin',
    'terri-save-1.v99999-backup.bin',
  ];
  for (const name of names) assert.ok(isSaveName(name), name);
});

test('refuses every other name', () => {
  for (const name of [
    '', 'terri-save-1', 'terri-save-2.bin', 'terri-save-1.bin.tmp-1-1', '../terri-save-1.bin', 'saves/terri-save-1.bin',
    'terri-save-1.v-backup.bin', 'terri-save-1.v123456-backup.bin', 'terri-save-1.v23-other-backup.bin',
    'terri-save-1.damaged-1.bin', 'TERRI-SAVE-1.BIN', 'terri-save-1.bin\0', 'terri-save-1.previous.bin/..', 42, null,
  ]) {
    assert.equal(isSaveName(name), false, String(name));
  }
});

test('reads nothing from a folder that does not exist yet', async () => {
  const saves = new SaveFiles({ directory: folder() });
  assert.equal(await saves.read('terri-save-1.bin'), null);
  await saves.remove('terri-save-1.bin');
  assert.deepEqual(await saves.removeStrayTemporaryFiles(), []);
});

test('writes, reads and removes a file, creating the folder on first write', async () => {
  const directory = folder();
  const saves = new SaveFiles({ directory });
  await saves.write('terri-save-1.bin', new Uint8Array([84, 69, 82, 82]));
  assert.deepEqual([...await saves.read('terri-save-1.bin')], [84, 69, 82, 82]);
  assert.ok((await saves.read('terri-save-1.bin')) instanceof Uint8Array);
  await saves.write('terri-save-1.bin', new Uint8Array([1]));
  assert.deepEqual([...await saves.read('terri-save-1.bin')], [1]);
  assert.deepEqual(fs.readdirSync(directory), ['terri-save-1.bin']);
  await saves.remove('terri-save-1.bin');
  assert.equal(await saves.read('terri-save-1.bin'), null);
});

test('refuses a bad name or bad bytes before touching the disk', async () => {
  const directory = folder();
  const saves = new SaveFiles({ directory });
  await assert.rejects(saves.write('../escape.bin', new Uint8Array(1)), /not a save file name/);
  await assert.rejects(saves.read('notes.txt'), /not a save file name/);
  await assert.rejects(saves.remove('terri-save-1.bin.tmp-1-1'), /not a save file name/);
  await assert.rejects(saves.write('terri-save-1.bin', 'text'), /must be bytes/);
  await assert.rejects(saves.write('terri-save-1.bin', [1, 2]), /must be bytes/);
  const tooLarge = { byteLength: MAX_SAVE_BYTES + 1 };
  Object.setPrototypeOf(tooLarge, Uint8Array.prototype);
  await assert.rejects(saves.write('terri-save-1.bin', tooLarge), /larger than 256 MiB/);
  assert.equal(fs.existsSync(directory), false);
});

/** A file system that records calls and fails where told. */
function recordingFs(overrides = {}) {
  const calls = [];
  const real = fs.promises;
  const wrap = (name) => async (...args) => {
    calls.push(`${name} ${path.basename(String(args[0]))}${name === 'rename' ? ` ${path.basename(String(args[1]))}` : ''}`);
    if (overrides[name]) return overrides[name](...args);
    return real[name](...args);
  };
  return {
    calls,
    fs: {
      readFile: wrap('readFile'),
      mkdir: wrap('mkdir'),
      unlink: wrap('unlink'),
      readdir: wrap('readdir'),
      rename: wrap('rename'),
      open: async (...args) => {
        calls.push(`open ${path.basename(String(args[0]))}`);
        const handle = await real.open(...args);
        return {
          writeFile: async (bytes) => { calls.push('writeFile'); if (overrides.writeFile) await overrides.writeFile(bytes); return handle.writeFile(bytes); },
          sync: async () => { calls.push('sync'); return handle.sync(); },
          close: async () => { calls.push('close'); return handle.close(); },
        };
      },
    },
  };
}

test('a write goes to a synced temporary file that replaces the target in one rename', async () => {
  const directory = folder();
  const recorder = recordingFs();
  const saves = new SaveFiles({ directory, fs: recorder.fs, pid: 77 });
  await saves.write('terri-save-1.previous.bin', new Uint8Array([9]));
  assert.deepEqual(recorder.calls, [
    'mkdir saves',
    'open terri-save-1.previous.bin.tmp-77-1',
    'writeFile',
    'sync',
    'close',
    'rename terri-save-1.previous.bin.tmp-77-1 terri-save-1.previous.bin',
  ]);
});

test('a failed write leaves the old file and no temporary file, and reports the original error', async () => {
  const directory = folder();
  const plain = new SaveFiles({ directory });
  await plain.write('terri-save-1.bin', new Uint8Array([1, 2, 3]));
  const recorder = recordingFs({ writeFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
  const saves = new SaveFiles({ directory, fs: recorder.fs });
  await assert.rejects(saves.write('terri-save-1.bin', new Uint8Array([4])), /disk full/);
  assert.deepEqual(fs.readdirSync(directory), ['terri-save-1.bin']);
  assert.deepEqual([...fs.readFileSync(path.join(directory, 'terri-save-1.bin'))], [1, 2, 3]);
});

test('Windows retries a briefly locked rename, then gives up with the original error', async () => {
  const directory = folder();
  let refusals = 2;
  const busy = recordingFs({
    rename: async (from, to) => {
      if (refusals-- > 0) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      return fs.promises.rename(from, to);
    },
  });
  const waits = [];
  const saves = new SaveFiles({ directory, fs: busy.fs, platform: 'win32', wait: async (ms) => { waits.push(ms); } });
  await saves.write('terri-save-1.bin', new Uint8Array([5]));
  assert.equal(waits.length, 2);
  assert.deepEqual([...fs.readFileSync(path.join(directory, 'terri-save-1.bin'))], [5]);

  const stuck = recordingFs({ rename: async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } });
  const attempts = [];
  const failing = new SaveFiles({ directory, fs: stuck.fs, platform: 'win32', wait: async (ms) => { attempts.push(ms); } });
  await assert.rejects(failing.write('terri-save-1.bin', new Uint8Array([6])), /denied/);
  assert.equal(stuck.calls.filter((call) => call.startsWith('rename')).length, 6);
  assert.deepEqual(fs.readdirSync(directory), ['terri-save-1.bin']);

  const other = recordingFs({ rename: async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } });
  const posix = new SaveFiles({ directory, fs: other.fs, platform: 'darwin' });
  await assert.rejects(posix.write('terri-save-1.bin', new Uint8Array([7])), /denied/);
  assert.equal(other.calls.filter((call) => call.startsWith('rename')).length, 1);
});

test('operations run one at a time in the order they were asked for', async () => {
  const directory = folder();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const recorder = recordingFs({
    writeFile: async () => { order.push('write starts'); await gate; order.push('write ends'); },
  });
  const saves = new SaveFiles({ directory, fs: recorder.fs });
  const writing = saves.write('terri-save-1.bin', new Uint8Array([1]));
  const reading = saves.read('terri-save-1.bin').then((bytes) => { order.push(`read ${bytes && bytes[0]}`); });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['write starts']);
  release();
  await Promise.all([writing, reading]);
  assert.deepEqual(order, ['write starts', 'write ends', 'read 1']);
});

test('idle settles after every queued operation, including a failed one', async () => {
  const directory = folder();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const recorder = recordingFs({ writeFile: async () => { await gate; } });
  const saves = new SaveFiles({ directory, fs: recorder.fs });
  const writing = saves.write('terri-save-1.bin', new Uint8Array([1]));
  const refused = saves.write('bad name', new Uint8Array([1])).catch(() => 'refused');
  let idle = false;
  const waiting = saves.idle().then(() => { idle = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(idle, false);
  release();
  await Promise.all([writing, waiting]);
  assert.equal(await refused, 'refused');
  assert.equal(idle, true);
  assert.deepEqual([...fs.readFileSync(path.join(directory, 'terri-save-1.bin'))], [1]);
});

test('startup removes temporary files left by an unfinished write, and nothing else', async () => {
  const directory = folder();
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['terri-save-1.bin', 'terri-save-1.bin.tmp-12-3', 'terri-save-1.previous.bin.tmp-4-1', 'notes.txt.tmp-1-1', 'keep.txt']) {
    fs.writeFileSync(path.join(directory, name), 'x');
  }
  const removed = await new SaveFiles({ directory }).removeStrayTemporaryFiles();
  assert.deepEqual(removed.sort(), ['terri-save-1.bin.tmp-12-3', 'terri-save-1.previous.bin.tmp-4-1']);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['keep.txt', 'notes.txt.tmp-1-1', 'terri-save-1.bin']);
});
