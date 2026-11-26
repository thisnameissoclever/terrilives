'use strict';

/**
 * Update checks for the installed game, the same on Windows and macOS. No
 * Electron import: main.js passes in electron-updater's autoUpdater and a
 * notifier, so the flow is tested with a fake.
 *
 * At launch the app asks GitHub for the newest published release
 * (latest.yml on Windows, latest-mac.yml on macOS), downloads it in the
 * background, and installs it when the player closes the game. The player
 * sees nothing until the download is ready. Nothing restarts the game.
 * The Mac build is signed and notarized, which Squirrel.Mac requires.
 *
 * On a Mac, electron-updater reports a download before Squirrel.Mac has
 * fetched and staged it, so the notice waits for Electron's own updater
 * (`nativeUpdater`) to report the staged update. If staging fails, for
 * example when the app runs from the disk image, nothing is shown.
 */

const UPDATING_PLATFORMS = Object.freeze(['win32', 'darwin']);

/**
 * Starts the update check on Windows and macOS; does nothing elsewhere.
 * `notify` receives `{ kind: 'ready', version }` once an update will install
 * on quit. `nativeUpdater` is Electron's autoUpdater, required on macOS.
 */
async function startUpdateCheck({ platform, autoUpdater, nativeUpdater = null, notify, log = () => {} }) {
  if (!UPDATING_PLATFORMS.includes(platform)) return false;
  if (platform === 'darwin' && !nativeUpdater) {
    log(new Error('The Mac update check needs the native autoUpdater from Electron.'));
    return false;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => log(error));
  if (platform === 'darwin') {
    let version = null;
    autoUpdater.on('update-downloaded', (info) => { version = String(info && info.version); });
    nativeUpdater.on('error', (error) => log(error));
    nativeUpdater.on('update-downloaded', () => {
      if (version !== null) notify({ kind: 'ready', version });
    });
  } else {
    autoUpdater.on('update-downloaded', (info) => notify({ kind: 'ready', version: String(info && info.version) }));
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    // The background download settles later. Its failure is already reported
    // through the 'error' event, so only keep it from going unhandled.
    if (result && result.downloadPromise) result.downloadPromise.catch(() => {});
  } catch (error) {
    log(error);
  }
  return true;
}

module.exports = {
  UPDATING_PLATFORMS,
  startUpdateCheck,
};
