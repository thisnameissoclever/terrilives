/**
 * The installed game's update notice, a quiet line under the time and funds.
 *
 * On Windows and Mac alike, the app downloads a new version in the
 * background. Nothing shows until that download is ready; then this line
 * says the update installs when the game closes. Play is never interrupted.
 * The website never shows this: it has no desktop bridge.
 */

import type { DesktopBridge, DesktopUpdateStatus } from '../storage/desktop-bridge.js';

export const UPDATE_READY_TEXT = 'Update ready. It installs when you close the game.';

interface NoticeElements {
  readonly row: { hidden: boolean };
  readonly text: { textContent: string | null };
}

/** Shows one piece of update news. Unknown kinds leave the notice hidden. */
export function showDesktopUpdate(status: DesktopUpdateStatus, elements: NoticeElements): void {
  if (status.kind !== 'ready') return;
  elements.text.textContent = UPDATE_READY_TEXT;
  elements.row.hidden = false;
}

/** Listens for the app's update news. Does nothing for an app without update support. */
export function connectDesktopUpdates(bridge: DesktopBridge, elements: NoticeElements): void {
  if (typeof bridge.onUpdateStatus !== 'function') return;
  bridge.onUpdateStatus((status) => showDesktopUpdate(status, elements));
}
