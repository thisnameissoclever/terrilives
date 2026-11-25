import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopBridge, DesktopUpdateStatus } from '../src/storage/desktop-bridge.js';
import { UPDATE_READY_TEXT, connectDesktopUpdates, showDesktopUpdate } from '../src/ui/desktop-update-notice.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function elements() {
  return { row: { hidden: true }, text: { textContent: '' as string | null } };
}

function bridge() {
  let handler: ((status: DesktopUpdateStatus) => void) | null = null;
  const value = {
    saves: { read: vi.fn(), write: vi.fn(), remove: vi.fn() },
    onSaveRequested: vi.fn(),
    onUpdateStatus: vi.fn((next: (status: DesktopUpdateStatus) => void) => { handler = next; }),
  };
  return { value, send: (status: DesktopUpdateStatus) => handler!(status) };
}

describe('the installed game update notice', () => {
  it('starts hidden in the page and has no controls', () => {
    const row = /<div id="desktop-update" class="summary-row" role="status" hidden>([\s\S]*?)<\/div>/.exec(INDEX_HTML);
    expect(row).not.toBeNull();
    expect(row![1]).not.toMatch(/<button|<a\b/);
  });

  it('stays hidden until a download is ready, then says it installs on close', () => {
    const { value, send } = bridge();
    const view = elements();
    connectDesktopUpdates(value as unknown as DesktopBridge, view);
    expect(value.onUpdateStatus).toHaveBeenCalledTimes(1);
    expect(view.row.hidden).toBe(true);
    send({ kind: 'ready', version: '1.2.0' });
    expect(view.row.hidden).toBe(false);
    expect(view.text.textContent).toBe(UPDATE_READY_TEXT);
    expect(UPDATE_READY_TEXT).toBe('Update ready. It installs when you close the game.');
  });

  it('ignores news it does not know and an app without update support', () => {
    const view = elements();
    showDesktopUpdate({ kind: 'available' } as unknown as DesktopUpdateStatus, view);
    expect(view.row.hidden).toBe(true);
    const { value } = bridge();
    const older = { saves: value.saves, onSaveRequested: value.onSaveRequested };
    expect(() => connectDesktopUpdates(older as unknown as DesktopBridge, view)).not.toThrow();
    expect(view.row.hidden).toBe(true);
  });
});
