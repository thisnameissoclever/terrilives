'use strict';

/**
 * The game window's only connection to the app: save file access and the
 * request to save before the window closes or minimizes. Runs sandboxed, so
 * it can use only contextBridge and ipcRenderer. The page detects the app by
 * this one global, never by its address or user agent.
 */

const { contextBridge, ipcRenderer } = require('electron');

let saveRequestHandler = null;
let updateHandler = null;
let lastUpdateStatus = null;

ipcRenderer.on('natural-causes:save-requested', async (_event, id) => {
  if (!Number.isSafeInteger(id)) return;
  if (saveRequestHandler !== null) {
    try {
      await saveRequestHandler();
    } catch {
      // The page reports its own save failures. The window still closes.
    }
  }
  ipcRenderer.send('natural-causes:save-finished', id);
});

ipcRenderer.on('natural-causes:update-status', (_event, status) => {
  if (!status || (status.kind !== 'ready' && status.kind !== 'available') || typeof status.version !== 'string') return;
  lastUpdateStatus = { kind: status.kind, version: status.version };
  if (updateHandler !== null) updateHandler(lastUpdateStatus);
});

contextBridge.exposeInMainWorld('naturalCausesDesktop', {
  saves: {
    read: (name) => ipcRenderer.invoke('natural-causes:saves:read', name),
    write: (name, bytes) => ipcRenderer.invoke('natural-causes:saves:write', name, bytes),
    remove: (name) => ipcRenderer.invoke('natural-causes:saves:remove', name),
  },
  onSaveRequested(handler) {
    if (typeof handler === 'function' && saveRequestHandler === null) saveRequestHandler = handler;
  },
  /** Update news: `{ kind: 'ready' | 'available', version }`, replayed if it came first. */
  onUpdateStatus(handler) {
    if (typeof handler !== 'function' || updateHandler !== null) return;
    updateHandler = handler;
    if (lastUpdateStatus !== null) handler(lastUpdateStatus);
  },
  /** Opens the newer release's page in the web browser. Mac only; the app chooses the address. */
  openReleasePage() {
    ipcRenderer.send('natural-causes:open-release-page');
  },
});
