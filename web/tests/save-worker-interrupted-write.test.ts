import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';

/**
 * A page closing during a save can leave the slot half written. These tests
 * model a browser whose writable stream is NOT atomic (the file is emptied when
 * the stream opens, and bytes land as they are written), which is the worst
 * case the worker must survive. An atomic browser only makes it safer.
 */

const PRIMARY = 'terri-save-1.bin';
const PREVIOUS = 'terri-save-1.previous.bin';
const DAMAGED = 'terri-save-1.damaged.bin';

function save(marker: number): Uint8Array {
  return new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, CURRENT_SAVE_VERSION, 0, 29, 128, 0, 0, 0, marker, marker, marker]);
}

type Response = { id: number; ok: boolean; bytes?: ArrayBuffer | null; restored?: boolean; error?: string };

function bytesOf(response: Response): Uint8Array | null {
  return response.bytes ? new Uint8Array(response.bytes) : null;
}

async function slot(initial: Uint8Array | null) {
  const files = new Map<string, Uint8Array>();
  if (initial) files.set(PRIMARY, initial.slice());
  // `crash` models the page closing mid-write: half the bytes land, then the
  // worker is gone, so nothing it would do afterwards (cleanup, restore) runs.
  // `broken` models an ordinary write error: half the bytes land and the worker
  // keeps running. It fires `times` times.
  const crash = { file: '', dead: false };
  const broken = { file: '', times: 1 };
  const fail = { file: '' };
  const root = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (crash.dead) throw new Error('worker terminated');
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          return { async arrayBuffer() { return files.get(name)!.slice().buffer; } };
        },
        async createWritable() {
          if (crash.dead) throw new Error('worker terminated');
          if (fail.file === name) throw new Error('open denied');
          files.set(name, new Uint8Array());
          return {
            async write(bytes: ArrayBuffer) {
              if (crash.dead) throw new Error('worker terminated');
              const whole = new Uint8Array(bytes);
              if (crash.file === name || broken.file === name) {
                files.set(name, whole.slice(0, Math.floor(whole.length / 2)));
                if (crash.file === name) crash.dead = true;
                else if (--broken.times <= 0) broken.file = '';
                throw new Error('page closed');
              }
              files.set(name, whole.slice());
            },
            async close() {},
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (crash.dead) throw new Error('worker terminated');
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    },
  };
  let lockTail = Promise.resolve();
  const locks = {
    request: (_name: string, callback: () => Promise<void>) => {
      const result = lockTail.then(callback);
      lockTail = result.catch(() => undefined);
      return result;
    },
  };
  const waiting = new Map<number, (response: Response) => void>();
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(response: Response) { waiting.get(response.id)!(response); },
  };
  vi.stubGlobal('self', port);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks });
  vi.resetModules();
  await import('../src/storage/save-worker.js');
  let id = 0;
  function request(
    kind: 'load' | 'save' | 'clear' | 'previous' | 'restore',
    bytes?: Uint8Array,
    expected?: Uint8Array,
  ): Promise<Response> {
    const requestId = ++id;
    return new Promise((resolve) => {
      waiting.set(requestId, resolve);
      port.onmessage!({
        data: {
          id: requestId,
          kind,
          ...(bytes ? { bytes: bytes.slice().buffer } : {}),
          ...(expected ? { expected: expected.slice().buffer } : {}),
        },
      });
    });
  }
  /** The page is reloaded: a fresh worker sees whatever the dead one left. */
  function reload(): void {
    crash.file = '';
    crash.dead = false;
  }
  /** What the controller does: read the copy, then restore it over the slot it saw. */
  async function recover(): Promise<boolean | null> {
    const copy = bytesOf(await request('previous'));
    if (copy === null) return null;
    const seen = new Uint8Array((await request('load')).bytes!);
    const response = await request('restore', copy, seen);
    if (!response.ok) throw new Error(response.error);
    return response.restored === true;
  }
  return { files, crash, broken, fail, request, reload, recover };
}

afterEach(() => vi.unstubAllGlobals());

describe('an interrupted save never costs the player their game', () => {
  async function twoGoodThenCutOff() {
    const s = await slot(null);
    await s.request('save', save(1));
    await s.request('save', save(2));
    s.crash.file = PRIMARY;
    await s.request('save', save(3));
    const half = s.files.get(PRIMARY)!.slice();
    s.reload();
    return { s, half };
  }

  it('keeps the last good copy when a write over a good save is cut off', async () => {
    const s = await slot(null);
    expect(await s.request('save', save(1))).toMatchObject({ ok: true });
    expect(await s.request('save', save(2))).toMatchObject({ ok: true });
    s.crash.file = PRIMARY;
    expect(await s.request('save', save(3))).toMatchObject({ ok: false });
    expect(s.files.get(PRIMARY)).not.toEqual(save(3));
    expect(s.files.get(PREVIOUS)).toEqual(save(2));
  });

  it('keeps the slot good when the last good copy itself is cut off', async () => {
    const s = await slot(null);
    await s.request('save', save(1));
    await s.request('save', save(2));
    s.crash.file = PREVIOUS;
    expect(await s.request('save', save(3))).toMatchObject({ ok: false });
    expect(s.files.get(PRIMARY)).toEqual(save(2));
  });

  it('restores the last good copy over a half-written slot and keeps the damaged bytes', async () => {
    const { s, half } = await twoGoodThenCutOff();
    expect(await s.recover()).toBe(true);
    expect(s.files.get(PRIMARY)).toEqual(save(2));
    expect(s.files.get(DAMAGED)).toEqual(half);
  });

  it('changes nothing until the caller restores, and never overwrites an earlier damaged copy', async () => {
    const { s, half } = await twoGoodThenCutOff();
    expect(bytesOf(await s.request('previous'))).toEqual(save(2));
    expect(s.files.get(PRIMARY)).toEqual(half);
    expect(s.files.has(DAMAGED)).toBe(false);

    expect(await s.recover()).toBe(true);
    // The restored slot is cut off again, and a second recovery runs.
    s.files.set(PRIMARY, save(2).slice(0, 7));
    expect(await s.recover()).toBe(true);
    expect(s.files.get(DAMAGED)).toEqual(half);
    const kept = [...s.files.keys()].filter((name) => name.startsWith('terri-save-1.damaged'));
    expect(kept).toHaveLength(2);
    expect(s.files.get(PRIMARY)).toEqual(save(2));
  });

  it('leaves a slot that changed since the caller read it, such as one another tab just saved', async () => {
    const { s } = await twoGoodThenCutOff();
    const copy = bytesOf(await s.request('previous'))!;
    const seen = new Uint8Array((await s.request('load')).bytes!);
    s.files.set(PRIMARY, save(9));
    expect(await s.request('restore', copy, seen)).toMatchObject({ ok: true, restored: false });
    expect(s.files.get(PRIMARY)).toEqual(save(9));
    expect(s.files.has(DAMAGED)).toBe(false);
  });

  it('refuses to restore a copy that is not the stored last good copy', async () => {
    const { s, half } = await twoGoodThenCutOff();
    expect(await s.request('restore', save(7), half)).toMatchObject({ ok: true, restored: false });
    expect(s.files.get(PRIMARY)).toEqual(half);
  });

  it('keeps the slot untouched when the damaged copy cannot be kept', async () => {
    const { s, half } = await twoGoodThenCutOff();
    s.fail.file = DAMAGED;
    await expect(s.recover()).rejects.toThrow();
    expect(s.files.get(PRIMARY)).toEqual(half);
  });

  it('lets saving continue after a first save into an empty slot was cut off', async () => {
    const s = await slot(null);
    s.crash.file = PRIMARY;
    expect(await s.request('save', save(1))).toMatchObject({ ok: false });
    s.reload();
    // Closed before any byte landed: the file exists but holds nothing.
    s.files.set(PRIMARY, new Uint8Array());

    expect(await s.request('save', save(1))).toMatchObject({ ok: true });
    expect(s.files.get(PRIMARY)).toEqual(save(1));
  });

  it('restores the slot when a write fails without the page closing', async () => {
    const s = await slot(null);
    await s.request('save', save(1));
    await s.request('save', save(2));
    s.broken.file = PRIMARY;
    expect(await s.request('save', save(3))).toMatchObject({ ok: false });
    expect(s.files.get(PRIMARY)).toEqual(save(2));

    // The previous copy still holds the older good save, not a damaged one.
    expect(await s.request('save', save(3))).toMatchObject({ ok: true });
    expect(s.files.get(PREVIOUS)).toEqual(save(2));
    expect(s.files.get(PRIMARY)).toEqual(save(3));
  });

  it('does not let a slot it failed to put back replace the last good copy', async () => {
    const s = await slot(null);
    await s.request('save', save(1));
    await s.request('save', save(2));
    s.broken.file = PRIMARY;
    s.broken.times = 2; // the write fails, and so does putting the slot back
    expect(await s.request('save', save(3))).toMatchObject({ ok: false });
    expect(s.files.get(PRIMARY)).not.toEqual(save(2));

    s.broken.file = PRIMARY;
    s.broken.times = 1;
    expect(await s.request('save', save(4))).toMatchObject({ ok: false });
    expect(s.files.get(PREVIOUS)).toEqual(save(2));
  });

  it('keeps the previous copy through a normal save and never rotates an empty slot', async () => {
    const s = await slot(new Uint8Array());
    await s.request('save', save(1));
    expect(s.files.has(PREVIOUS)).toBe(false);
    await s.request('save', save(2));
    expect(s.files.get(PREVIOUS)).toEqual(save(1));
    expect(s.files.get(PRIMARY)).toEqual(save(2));
  });

  it('offers nothing to restore when there is no usable previous copy', async () => {
    for (const previous of [null, new Uint8Array(), new Uint8Array([1, 2, 3])]) {
      const damaged = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86]);
      const s = await slot(damaged);
      if (previous) s.files.set(PREVIOUS, previous);
      expect(await s.request('previous')).toMatchObject({ ok: true, bytes: null });
      expect(s.files.get(PRIMARY)).toEqual(damaged);
      expect(s.files.has(DAMAGED)).toBe(false);
    }
  });

  it('removes the previous copy with the slot on New game so an old game cannot come back', async () => {
    const s = await slot(null);
    await s.request('save', save(1));
    await s.request('save', save(2));
    expect(await s.request('clear')).toMatchObject({ ok: true });
    expect(s.files.has(PRIMARY)).toBe(false);
    expect(s.files.has(PREVIOUS)).toBe(false);
    expect(await s.request('previous')).toMatchObject({ ok: true, bytes: null });
  });

  it('does not save over the previous copy with an unsupported slot', async () => {
    const newer = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, CURRENT_SAVE_VERSION + 1, 0, 9]);
    const s = await slot(newer);
    s.files.set(PREVIOUS, save(1));
    expect(await s.request('save', save(2))).toMatchObject({ ok: false });
    expect(s.files.get(PRIMARY)).toEqual(newer);
    expect(s.files.get(PREVIOUS)).toEqual(save(1));
  });
});
