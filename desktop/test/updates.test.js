'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { LATEST_RELEASE_API, isNewerVersion, releasePageUrl, startUpdateCheck } = require('../src/updates.js');

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

/** Any use of the updater on a Mac fails the test. */
const untouchable = new Proxy({}, { get(_target, name) { throw new Error(`The Mac branch touched the updater: ${String(name)}`); } });

test('Windows checks at launch, downloads quietly and installs on quit', async () => {
  const updater = fakeUpdater();
  const news = [];
  const fetchJson = async () => { throw new Error('Windows must not query the releases API'); };
  const url = await startUpdateCheck({ platform: 'win32', currentVersion: '1.1.0', autoUpdater: updater, fetchJson, notify: (n) => news.push(n) });
  assert.equal(url, null);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(updater.calls, ['checkForUpdates']);
  // Nothing is shown while checking or downloading.
  updater.emit('checking-for-update');
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('download-progress', { percent: 50 });
  assert.deepEqual(news, []);
  updater.emit('update-downloaded', { version: '1.2.0' });
  assert.deepEqual(news, [{ kind: 'ready', version: '1.2.0' }]);
  // It never restarts the game itself.
  assert.ok(!updater.calls.includes('quitAndInstall'));
});

test('a failed Windows check is logged and shows nothing', async () => {
  const updater = fakeUpdater({ fails: true });
  const news = [];
  const logged = [];
  await startUpdateCheck({ platform: 'win32', currentVersion: '1.1.0', autoUpdater: updater, fetchJson: null, notify: (n) => news.push(n), log: (e) => logged.push(e.message) });
  updater.emit('error', new Error('no latest.yml'));
  assert.deepEqual(news, []);
  assert.deepEqual(logged, ['offline', 'no latest.yml']);
});

test('a Mac offers the release page of a newer version and never touches the updater', async () => {
  const asked = [];
  const news = [];
  const url = await startUpdateCheck({
    platform: 'darwin', currentVersion: '1.1.0', autoUpdater: untouchable,
    fetchJson: async (address) => { asked.push(address); return { tag_name: 'v1.2.0', html_url: 'https://evil.example/' }; },
    notify: (n) => news.push(n),
  });
  assert.deepEqual(asked, [LATEST_RELEASE_API]);
  assert.equal(url, 'https://github.com/thisnameissoclever/terrilives/releases/tag/v1.2.0');
  assert.deepEqual(news, [{ kind: 'available', version: '1.2.0', url }]);
});

test('a Mac shows nothing for the same, an older or a malformed release, or when offline', async () => {
  for (const release of [{ tag_name: 'v1.1.0' }, { tag_name: 'v1.0.9' }, { tag_name: 'nightly' }, { tag_name: 'v2.0.0-beta.1' }, null]) {
    const news = [];
    const url = await startUpdateCheck({ platform: 'darwin', currentVersion: '1.1.0', autoUpdater: untouchable, fetchJson: async () => release, notify: (n) => news.push(n) });
    assert.equal(url, null, JSON.stringify(release));
    assert.deepEqual(news, []);
  }
  const logged = [];
  const url = await startUpdateCheck({ platform: 'darwin', currentVersion: '1.1.0', autoUpdater: untouchable,
    fetchJson: async () => { throw new Error('offline'); }, notify: () => assert.fail('notified'), log: (e) => logged.push(e.message) });
  assert.equal(url, null);
  assert.deepEqual(logged, ['offline']);
});

test('other systems check nothing', async () => {
  const url = await startUpdateCheck({ platform: 'linux', currentVersion: '1.1.0', autoUpdater: untouchable,
    fetchJson: async () => assert.fail('fetched'), notify: () => assert.fail('notified') });
  assert.equal(url, null);
});

test('versions compare by major, minor and patch', () => {
  assert.equal(isNewerVersion('v1.2.0', '1.1.0'), true);
  assert.equal(isNewerVersion('v1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('v2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('v1.1.0', '1.1.0'), false);
  assert.equal(isNewerVersion('v1.0.10', '1.1.0'), false);
  assert.equal(isNewerVersion('latest', '1.1.0'), false);
});

test('the release page address is built from the version alone', () => {
  assert.equal(releasePageUrl('v3.4.5'), 'https://github.com/thisnameissoclever/terrilives/releases/tag/v3.4.5');
  assert.equal(releasePageUrl('3.4.5'), 'https://github.com/thisnameissoclever/terrilives/releases/tag/v3.4.5');
  assert.throws(() => releasePageUrl('v1.2.3/../../evil'));
});
