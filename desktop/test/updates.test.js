'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { startUpdateCheck } = require('../src/updates.js');

/** A stand-in for electron-updater's autoUpdater that records every call. */
function fakeUpdater({ fails = false } = {}) {
  const updater = new EventEmitter();
  updater.calls = [];
  updater.checkForUpdates = async () => {
    updater.calls.push('checkForUpdates');
    if (fails) throw new Error('offline');
    return null;
  };
  updater.quitAndInstall = () => updater.calls.push('quitAndInstall');
  updater.downloadUpdate = async () => updater.calls.push('downloadUpdate');
  return updater;
}

for (const platform of ['win32', 'darwin']) {
  test(`${platform} checks at launch, downloads quietly and installs on quit`, async () => {
    const updater = fakeUpdater();
    const news = [];
    assert.equal(await startUpdateCheck({ platform, autoUpdater: updater, notify: (n) => news.push(n) }), true);
    assert.equal(updater.autoDownload, true);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.deepEqual(updater.calls, ['checkForUpdates']);
    // Nothing is shown while checking or downloading.
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '1.2.0' });
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-not-available', { version: '1.1.0' });
    assert.deepEqual(news, []);
    updater.emit('update-downloaded', { version: '1.2.0' });
    assert.deepEqual(news, [{ kind: 'ready', version: '1.2.0' }]);
    // It never restarts the game or downloads by hand.
    assert.deepEqual(updater.calls, ['checkForUpdates']);
  });

  test(`a failed ${platform} check is logged and shows nothing`, async () => {
    const updater = fakeUpdater({ fails: true });
    const news = [];
    const logged = [];
    await startUpdateCheck({ platform, autoUpdater: updater, notify: (n) => news.push(n), log: (e) => logged.push(e.message) });
    updater.emit('error', new Error('no update file'));
    assert.deepEqual(news, []);
    assert.deepEqual(logged, ['offline', 'no update file']);
  });
}

test('other systems check nothing', async () => {
  const untouchable = new Proxy({}, { get(_target, name) { throw new Error(`touched the updater: ${String(name)}`); } });
  assert.equal(await startUpdateCheck({ platform: 'linux', autoUpdater: untouchable, notify: () => assert.fail('notified') }), false);
});
