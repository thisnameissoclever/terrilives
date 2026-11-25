'use strict';

/**
 * Update checks for the installed game. No Electron import: main.js passes
 * in the updater, a fetch function and a notifier, so both branches are
 * tested with fakes.
 *
 * Windows: electron-updater checks GitHub at launch, downloads in the
 * background and installs when the game quits. The player sees nothing until
 * the download is ready.
 *
 * macOS: the app is not signed, so Squirrel.Mac cannot install updates. The
 * app only compares its version with the latest GitHub release and, when a
 * newer one exists, offers that release's page. It never downloads or
 * installs anything on a Mac.
 */

const OWNER = 'thisnameissoclever';
const REPO = 'terrilives';
const LATEST_RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Whether `latest` is a higher major.minor.patch than `current`. */
function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** The release page for one version. Built here, never taken from a response. */
function releasePageUrl(version) {
  const parts = parseVersion(version);
  if (parts === null) throw new Error(`Not a release version: ${version}`);
  return `https://github.com/${OWNER}/${REPO}/releases/tag/v${parts.join('.')}`;
}

/**
 * Starts the platform's update check. Returns the release page URL the Mac
 * may open, or null. `notify` receives `{ kind: 'ready', version }` on Windows or
 * `{ kind: 'available', version, url }` on a Mac; main.js keeps the URL to itself.
 */
async function startUpdateCheck({ platform, arch, currentVersion, autoUpdater, fetchJson, notify, log = () => {} }) {
  if (platform === 'win32') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (error) => log(error));
    autoUpdater.on('update-downloaded', (info) => notify({ kind: 'ready', version: String(info && info.version) }));
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log(error);
    }
    return null;
  }
  if (platform === 'darwin') {
    try {
      const latest = await fetchJson(LATEST_RELEASE_API);
      const version = parseVersion(latest && latest.tag_name);
      if (version === null || !isNewerVersion(latest.tag_name, currentVersion)) return null;
      // The Mac disk images arrive minutes after publication, or not at all
      // if their build fails. Announce only a release this Mac can download.
      const image = `Natural-Causes-${version.join('.')}-${arch}.dmg`;
      if (!Array.isArray(latest.assets) || !latest.assets.some((asset) => asset && asset.name === image)) return null;
      const url = releasePageUrl(latest.tag_name);
      notify({ kind: 'available', version: version.join('.'), url });
      return url;
    } catch (error) {
      log(error);
      return null;
    }
  }
  return null;
}

module.exports = {
  LATEST_RELEASE_API,
  isNewerVersion,
  releasePageUrl,
  startUpdateCheck,
};
