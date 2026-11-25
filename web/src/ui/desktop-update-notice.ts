/**
 * The installed game's update notice, a quiet line under the time and funds.
 *
 * Nothing shows until the app has news. On Windows that is an update already
 * downloaded, which installs when the game closes. On a Mac, where the app
 * cannot update itself, it is a newer release, with a Download button that
 * opens the release page in the web browser. Play is never interrupted.
 * The website never shows this: it has no desktop bridge.
 */

import type { DesktopBridge, DesktopUpdateStatus } from '../storage/desktop-bridge.js';

export const UPDATE_READY_TEXT = 'Update ready. It installs when you close the game.';
export const UPDATE_AVAILABLE_TEXT = 'New version available';

interface NoticeElements {
  readonly row: { hidden: boolean };
  readonly text: { textContent: string | null };
  readonly download: { hidden: boolean; addEventListener(type: 'click', listener: () => void): void };
}

/** Shows one piece of update news. Unknown kinds leave the notice hidden. */
export function showDesktopUpdate(status: DesktopUpdateStatus, elements: NoticeElements): void {
  if (status.kind === 'ready') {
    elements.text.textContent = UPDATE_READY_TEXT;
    elements.download.hidden = true;
  } else if (status.kind === 'available') {
    elements.text.textContent = UPDATE_AVAILABLE_TEXT;
    elements.download.hidden = false;
  } else {
    return;
  }
  elements.row.hidden = false;
}

/** Listens for the app's update news. Does nothing for an app without update support. */
export function connectDesktopUpdates(bridge: DesktopBridge, elements: NoticeElements): void {
  if (typeof bridge.onUpdateStatus !== 'function') return;
  elements.download.addEventListener('click', () => bridge.openReleasePage?.());
  bridge.onUpdateStatus((status) => showDesktopUpdate(status, elements));
}
