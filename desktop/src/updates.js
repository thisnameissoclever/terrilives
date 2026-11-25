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
 */

const UPDATING_PLATFORMS = Object.freeze(['win32', 'darwin']);

/**
 * Starts the update check on Windows and macOS; does nothing elsewhere.
 * `notify` receives `{ kind: 'ready', version }` once a download is ready.
 */
async function startUpdateCheck({ platform, autoUpdater, notify, log = () => {} }) {
  if (!UPDATING_PLATFORMS.includes(platform)) return false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => log(error));
  autoUpdater.on('update-downloaded', (info) => notify({ kind: 'ready', version: String(info && info.version) }));
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log(error);
  }
  return true;
}

module.exports = {
  UPDATING_PLATFORMS,
  startUpdateCheck,
};
