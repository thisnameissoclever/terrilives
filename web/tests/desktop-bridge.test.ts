import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge, registerDesktopSaveRequests, type DesktopBridge } from '../src/storage/desktop-bridge.js';
import { createSaveStore } from '../src/storage/save-store.js';

function validBridge() {
  const files = new Map<string, Uint8Array>();
  let handler: (() => Promise<unknown>) | null = null;
  const bridge = {
    saves: {
      read: vi.fn(async (name: string) => files.get(name) ?? null),
      write: vi.fn(async (name: string, bytes: Uint8Array) => { files.set(name, bytes); }),
      remove: vi.fn(async (name: string) => { files.delete(name); }),
    },
    exportFile: vi.fn(async () => 'saved' as const),
    onSaveRequested: vi.fn((next: () => Promise<unknown>) => { handler = next; }),
  };
  return { bridge, files, request: () => handler!() };
}

afterEach(() => vi.unstubAllGlobals());

describe('desktopBridge', () => {
  it('finds nothing in an ordinary browser', () => {
    expect(desktopBridge({})).toBeNull();
    expect(desktopBridge(globalThis)).toBeNull();
  });

  it('accepts the shape the app exposes', () => {
    const { bridge } = validBridge();
    expect(desktopBridge({ naturalCausesDesktop: bridge })).toBe(bridge);
  });

  it.each([
    ['a string', 'desktop'],
    ['null', null],
    ['no saves', { onSaveRequested() {} }],
    ['saves that are not an object', { saves: 'files', onSaveRequested() {} }],
    ['no read', { saves: { write() {}, remove() {} }, onSaveRequested() {} }],
    ['no write', { saves: { read() {}, remove() {} }, onSaveRequested() {} }],
    ['no remove', { saves: { read() {}, write() {} }, onSaveRequested() {} }],
    ['a read that is not a function', { saves: { read: 1, write() {}, remove() {} }, onSaveRequested() {} }],
    ['no save request hook', { saves: { read() {}, write() {}, remove() {} }, exportFile() {} }],
    ['no export channel', { saves: { read() {}, write() {}, remove() {} }, onSaveRequested() {} }],
    ['an export channel that is not a function', { saves: { read() {}, write() {}, remove() {} }, exportFile: 1, onSaveRequested() {} }],
  ])('rejects %s', (_label, value) => {
    expect(desktopBridge({ naturalCausesDesktop: value })).toBeNull();
  });
});

describe('createSaveStore', () => {
  it('uses the app files and starts no worker when the bridge exists', async () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    const { bridge } = validBridge();
    const store = createSaveStore(bridge as DesktopBridge);
    expect(await store.load()).toBeNull();
    expect(bridge.saves.read).toHaveBeenCalledWith('terri-save-1.bin');
    expect(worker).not.toHaveBeenCalled();
    store.close();
  });

  it('starts the storage worker on the website', () => {
    const worker = vi.fn(function FakeWorker(this: { addEventListener: () => void; terminate: () => void }, _url: unknown, _options: unknown) {
      this.addEventListener = () => {};
      this.terminate = () => {};
    });
    vi.stubGlobal('Worker', worker);
    const store = createSaveStore(null);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker.mock.calls[0][1]).toMatchObject({ type: 'module', name: 'terrilives-save-store' });
    store.close();
  });
});

describe('registerDesktopSaveRequests', () => {
  it('saves when the app asks', async () => {
    const { bridge, request } = validBridge();
    const save = vi.fn(async () => true);
    registerDesktopSaveRequests(bridge as DesktopBridge, save, () => false);
    expect(bridge.onSaveRequested).toHaveBeenCalledTimes(1);
    await request();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips the save while a new game is starting', async () => {
    const { bridge, request } = validBridge();
    const save = vi.fn(async () => true);
    let starting = true;
    registerDesktopSaveRequests(bridge as DesktopBridge, save, () => starting);
    await request();
    expect(save).not.toHaveBeenCalled();
    starting = false;
    await request();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('waits for a running operation before saving, then checks for a new game again', async () => {
    const { bridge, request } = validBridge();
    const save = vi.fn(async () => true);
    let idle!: () => void;
    let starting = false;
    registerDesktopSaveRequests(bridge as DesktopBridge, save, () => starting,
      () => new Promise<void>((resolve) => { idle = resolve; }));
    const answered = request();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    starting = true;
    idle();
    await answered;
    expect(save).not.toHaveBeenCalled();
    starting = false;
    const second = request();
    idle();
    await second;
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets the app wait for the save to finish', async () => {
    const { bridge, request } = validBridge();
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    registerDesktopSaveRequests(bridge as DesktopBridge, save, () => false);
    let settled = false;
    const answered = request().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await answered;
    expect(settled).toBe(true);
  });
});

describe("the installed game's Export save", () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf("exportSaveButton.addEventListener('click'"));

  it('delivers through the app export dialog and counts only saved as done', () => {
    const exporting = handler.slice(0, handler.indexOf('syncPersistenceButtons();'));
    const compact = exporting.replace(/\s+/g, ' ');
    const branch = compact.indexOf('desktop !== null ?');
    const throughApp = compact.indexOf('.exportFile(', branch + 1);
    const throughSite = compact.indexOf(': downloadSaveFile(', throughApp + 1);
    expect(branch).toBeGreaterThanOrEqual(0);
    expect(throughApp).toBeGreaterThan(branch);
    expect(throughSite).toBeGreaterThan(throughApp);
    expect(exporting).toContain("(result) => result === 'saved'");
  });
});
