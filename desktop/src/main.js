'use strict';

/**
 * Electron wiring only. Decisions live in the pure modules beside this file:
 * app-protocol.js serves the game, window-policy.js decides where links go,
 * and save-files.js stores the save files.
 *
 * Switches used for verification:
 * - `--user-data-dir=<path>` keeps the profile and saves in a throwaway folder.
 * - `--mute-audio` mutes every window as well as Chromium's own audio output.
 * - `--no-update-check` skips the update check, for verification runs.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEME, SCHEME_PRIVILEGES, START_URL, createProtocolHandler } = require('./app-protocol.js');
const { SaveFiles } = require('./save-files.js');
const policy = require('./window-policy.js');
const { startUpdateCheck } = require('./updates.js');

const CLOSE_SAVE_TIMEOUT_MS = 10_000;
const QUIT_WRITE_TIMEOUT_MS = 5_000;

// The profile folder must be chosen before anything reads it, including the
// single-instance lock below.
const userDataSwitch = app.commandLine.getSwitchValue('user-data-dir');
if (userDataSwitch) app.setPath('userData', path.resolve(userDataSwitch));
const muteAudio = app.commandLine.hasSwitch('mute-audio');
const skipUpdateCheck = app.commandLine.hasSwitch('no-update-check');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { ...SCHEME_PRIVILEGES } }]);

const bundleRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '../../web/dist');

let gameWindow = null;
let saves = null;
let quitting = false;
/** The latest update news for the page. */
let updateStatus = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusGameWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', holdQuitForSaveWrites);
  app.on('window-all-closed', () => app.quit());
  app.on('web-contents-created', (_event, contents) => applyContentsPolicy(contents));
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('Natural Causes cannot start', String(error && error.stack ? error.stack : error));
    app.quit();
  });
}

async function start() {
  if (!fs.existsSync(path.join(bundleRoot, 'index.html'))) {
    dialog.showErrorBox('Natural Causes cannot start', `The game files are missing. They should be in this folder:\n${bundleRoot}`);
    app.quit();
    return;
  }
  setApplicationMenu();
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(policy.allowPermission(permission));
  });
  protocol.handle(SCHEME, createProtocolHandler(bundleRoot));
  // Export save downloads a file. Keep the system's save dialog, but give it a
  // title instead of the download's internal blob: address.
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Export save',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });
  saves = new SaveFiles({ directory: path.join(app.getPath('userData'), 'saves') });
  try {
    await saves.removeStrayTemporaryFiles();
  } catch {
    // A leftover temporary file is harmless; the next write uses a new name.
  }
  registerSaveChannels();
  createGameWindow();
  if (app.isPackaged && !skipUpdateCheck) checkForUpdates();
}

/** Never in the unpackaged app: it has no release to compare with. */
function checkForUpdates() {
  void startUpdateCheck({
    platform: process.platform,
    autoUpdater: require('electron-updater').autoUpdater,
    notify: ({ kind, version }) => {
      updateStatus = { kind, version };
      sendUpdateStatus();
    },
    log: (error) => console.warn('Update check:', error && error.message ? error.message : error),
  });
}

function sendUpdateStatus() {
  if (updateStatus === null || gameWindow === null || gameWindow.isDestroyed()) return;
  gameWindow.webContents.send('natural-causes:update-status', updateStatus);
}


function setApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function secureWebPreferences(extra = {}) {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    spellcheck: false,
    ...extra,
  };
}

function createGameWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'Natural Causes',
    backgroundColor: '#11161d',
    webPreferences: secureWebPreferences({ preload: path.join(__dirname, 'preload.js') }),
  });
  gameWindow = window;
  window.once('ready-to-show', () => window.show());
  // A reload or a slow first load must not miss news that already arrived.
  window.webContents.on('did-finish-load', sendUpdateStatus);
  installCloseSave(window);
  // A minimized or hidden window keeps running, so the page may never see
  // `visibilitychange`. Ask it to save without waiting for the answer.
  window.on('minimize', () => requestSave(window));
  window.on('hide', () => requestSave(window));
  window.on('closed', () => {
    if (gameWindow === window) gameWindow = null;
  });
  void window.loadURL(START_URL);
}

let saveWritesDrained = false;

/**
 * A save file write the page asked for keeps running in this process after
 * the window is gone. Quitting waits for it, for up to five seconds, so the
 * process does not exit in the middle of a write.
 */
function holdQuitForSaveWrites(event) {
  if (saves === null || saveWritesDrained) return;
  event.preventDefault();
  const limit = new Promise((resolve) => setTimeout(resolve, QUIT_WRITE_TIMEOUT_MS));
  void Promise.race([saves.idle(), limit]).then(() => {
    saveWritesDrained = true;
    app.quit();
  });
}

let nextSaveRequest = 1;

function requestSave(window) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return null;
  const id = nextSaveRequest++;
  window.webContents.send('natural-causes:save-requested', id);
  return id;
}

/**
 * Close waits once for the page to save, then closes on its answer or after
 * ten seconds, whichever comes first. A crashed page closes at once.
 */
function installCloseSave(window) {
  let pending = null;
  let closing = false;
  const finish = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    closing = true;
    if (!window.isDestroyed()) window.destroy();
    if (quitting) app.quit();
  };
  window.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    if (pending) return;
    if (window.webContents.isCrashed()) {
      finish();
      return;
    }
    const id = requestSave(window);
    if (id === null) {
      finish();
      return;
    }
    pending = { id, timer: setTimeout(finish, CLOSE_SAVE_TIMEOUT_MS) };
  });
  ipcMain.on('natural-causes:save-finished', (event, id) => {
    if (window.isDestroyed() || event.sender !== window.webContents) return;
    if (pending && pending.id === id) finish();
  });
}

function trustedSaveRequest(event) {
  const frame = event.senderFrame;
  const fromGameWindow = gameWindow !== null && !gameWindow.isDestroyed()
    && event.sender === gameWindow.webContents
    && frame !== null && frame === event.sender.mainFrame;
  if (!policy.isTrustedSaveSender({ fromGameWindow, frameUrl: frame ? frame.url : undefined })) {
    throw new Error('Save files are available only to the game window.');
  }
}

function registerSaveChannels() {
  ipcMain.handle('natural-causes:saves:read', (event, name) => {
    trustedSaveRequest(event);
    return saves.read(name);
  });
  ipcMain.handle('natural-causes:saves:write', (event, name, bytes) => {
    trustedSaveRequest(event);
    return saves.write(name, bytes);
  });
  ipcMain.handle('natural-causes:saves:remove', (event, name) => {
    trustedSaveRequest(event);
    return saves.remove(name);
  });
}

function focusGameWindow() {
  if (gameWindow === null || gameWindow.isDestroyed()) return;
  if (gameWindow.isMinimized()) gameWindow.restore();
  gameWindow.show();
  gameWindow.focus();
}

function openExternal(url) {
  void shell.openExternal(url).catch(() => undefined);
}

/** Every page the app shows gets the same navigation and new-window rules. */
function applyContentsPolicy(contents) {
  if (muteAudio) contents.setAudioMuted(true);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event) => {
    const isGameWindow = gameWindow !== null && !gameWindow.isDestroyed() && contents === gameWindow.webContents;
    const decision = policy.navigationDecision(event.url, { isGameWindow });
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') openExternal(event.url);
    else if (decision === 'focus-game') focusGameWindow();
  });
  contents.setWindowOpenHandler(({ url }) => {
    switch (policy.windowOpenDecision(url)) {
      case 'app-window':
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1100,
            height: 850,
            parent: gameWindow ?? undefined,
            backgroundColor: '#11161d',
            webPreferences: secureWebPreferences(),
          },
        };
      case 'focus-game':
        focusGameWindow();
        return { action: 'deny' };
      case 'external':
        openExternal(url);
        return { action: 'deny' };
      default:
        return { action: 'deny' };
    }
  });
}
