import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopBridge, DesktopUpdateStatus } from '../src/storage/desktop-bridge.js';
import { UPDATE_AVAILABLE_TEXT, UPDATE_READY_TEXT, connectDesktopUpdates, showDesktopUpdate } from '../src/ui/desktop-update-notice.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function elements() {
  let click: (() => void) | null = null;
  return {
    row: { hidden: true },
    text: { textContent: '' as string | null },
    download: { hidden: true, addEventListener: (_type: 'click', listener: () => void) => { click = listener; } },
    click: () => click?.(),
  };
}

function bridge() {
  let handler: ((status: DesktopUpdateStatus) => void) | null = null;
  const value = {
    saves: { read: vi.fn(), write: vi.fn(), remove: vi.fn() },
    onSaveRequested: vi.fn(),
    onUpdateStatus: vi.fn((next: (status: DesktopUpdateStatus) => void) => { handler = next; }),
    openReleasePage: vi.fn(),
  };
  return { value, send: (status: DesktopUpdateStatus) => handler!(status) };
}

describe('the installed game update notice', () => {
  it('starts hidden in the page, with a plain Download button', () => {
    expect(INDEX_HTML).toMatch(/<div id="desktop-update" class="summary-row" role="status" hidden>/);
    expect(INDEX_HTML).toMatch(/<button id="desktop-update-download" class="hud-button" type="button" hidden>Download<\/button>/);
  });

  it('says a Windows update installs when the game closes, with no button', () => {
    const view = elements();
    showDesktopUpdate({ kind: 'ready', version: '1.2.0' }, view);
    expect(view.row.hidden).toBe(false);
    expect(view.text.textContent).toBe(UPDATE_READY_TEXT);
    expect(UPDATE_READY_TEXT).toBe('Update ready. It installs when you close the game.');
    expect(view.download.hidden).toBe(true);
  });

  it('offers a Mac player the release page', () => {
    const { value, send } = bridge();
    const view = elements();
    connectDesktopUpdates(value as unknown as DesktopBridge, view);
    expect(view.row.hidden).toBe(true);
    send({ kind: 'available', version: '1.2.0' });
    expect(view.text.textContent).toBe(UPDATE_AVAILABLE_TEXT);
    expect(UPDATE_AVAILABLE_TEXT).toBe('New version available');
    expect(view.download.hidden).toBe(false);
    view.click();
    expect(value.openReleasePage).toHaveBeenCalledTimes(1);
    expect(value.openReleasePage).toHaveBeenCalledWith();
  });

  it('ignores news it does not know and an app without update support', () => {
    const view = elements();
    showDesktopUpdate({ kind: 'later' } as unknown as DesktopUpdateStatus, view);
    expect(view.row.hidden).toBe(true);
    const { value } = bridge();
    const older = { saves: value.saves, onSaveRequested: value.onSaveRequested };
    expect(() => connectDesktopUpdates(older as unknown as DesktopBridge, view)).not.toThrow();
    expect(view.row.hidden).toBe(true);
  });
});
