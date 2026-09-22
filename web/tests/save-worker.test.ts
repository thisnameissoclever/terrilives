import { afterEach, describe, expect, it, vi } from 'vitest';

const PRIMARY = 'terri-save-1.bin';
const BACKUP = 'terri-save-1.v1-backup.bin';
const V2_BACKUP = 'terri-save-1.v2-backup.bin';
const V3_BACKUP = 'terri-save-1.v3-backup.bin';
// Independent wire fixture: ASCII TERRISAV, little-endian u16 version, payload.
const v1 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 1, 0, 17, 0, 255]);
const v2 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 2, 0, 29, 128]);
const v3 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 3, 0, 29, 128, 0]);
const v4 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 4, 0, 29, 128, 0, 0]);

type Response = { id: number; ok: boolean; bytes?: ArrayBuffer | null; error?: string };

/** Emulates only the browser filesystem. The production worker handles requests. */
async function workerSlot(initial: Uint8Array | null = v1) {
  const files = new Map<string, Uint8Array>();
  if (initial) files.set(PRIMARY, initial.slice());
  const events: string[] = [];
  const fail = { file: '', phase: '' };
  const root = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      events.push(`open ${name}`);
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          if (fail.file === name && fail.phase === 'read') throw new Error('read denied');
          return { async arrayBuffer() { return files.get(name)!.slice().buffer; } };
        },
        async createWritable() {
          events.push(`writable ${name}`);
          if (fail.file === name && fail.phase === 'open') throw new Error('open denied');
          let staged = new Uint8Array();
          return {
            async write(bytes: ArrayBuffer) {
              events.push(`write ${name}`);
              if (fail.file === name && fail.phase === 'write') throw new Error('disk full');
              staged = new Uint8Array(bytes).slice();
            },
            async close() {
              events.push(`close ${name}`);
              if (fail.file === name && fail.phase === 'close') throw new Error('close failed');
              files.set(name, staged);
            },
            async abort() { events.push(`abort ${name}`); },
          };
        },
      };
    },
    async removeEntry(name: string) {
      events.push(`remove ${name}`);
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    },
  };
  let lockTail = Promise.resolve();
  const locks = {
    request: vi.fn((_name: string, callback: () => Promise<void>) => {
      const result = lockTail.then(callback);
      lockTail = result.catch(() => undefined);
      return result;
    }),
  };
  async function connect(legacy: false | 'v2' | 'v3' = false) {
    const waiting = new Map<number, (response: Response) => void>();
    const port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(response: Response) { waiting.get(response.id)!(response); },
    };
    vi.stubGlobal('self', port);
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root }, locks });
    vi.resetModules();
    if (legacy === 'v2') await import('./fixtures/v2-worker/save-worker.js');
    else if (legacy === 'v3') await import('./fixtures/v3-worker/save-worker.js');
    else await import('../src/storage/save-worker.js');
    let id = 0;
    function request(kind: 'load' | 'save' | 'clear', bytes = v4): Promise<Response> {
      const requestId = ++id;
      return new Promise((resolve) => {
        waiting.set(requestId, resolve);
        port.onmessage!({ data: { id: requestId, kind, bytes: bytes.slice().buffer } });
      });
    }
    return request;
  }
  const request = await connect();
  return { files, events, fail, request, connect, locks };
}

afterEach(() => vi.unstubAllGlobals());

describe('save worker recovery backup', () => {
  it('the actual V2 worker refuses a V3 slot installed by a newer tab', async () => {
    const slot = await workerSlot(v3);
    const oldWorker = await slot.connect('v2');
    expect(await oldWorker('save', v2)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v3);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  // Review finding [K1] on the sell branch: a tab still running the V3
  // build must not overwrite a V4 slot a newer tab wrote.
  it('the actual V3 worker refuses a V4 slot installed by a newer tab', async () => {
    const slot = await workerSlot(v4);
    const oldWorker = await slot.connect('v3');
    expect(await oldWorker('save', v3)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v4);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it.each([v1, v2, v3, new Uint8Array([2, 0]), new Uint8Array([...v4.slice(0, 8), 5, 0])])(
    'refuses non-current outgoing headers before touching storage', async (next) => {
      const slot = await workerSlot(v4);
      expect(await slot.request('save', next)).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(v4);
      expect(slot.events).toEqual([]);
    },
  );

  it.each(['open', 'write', 'close'])(
    'preserves a V2 primary after backup %s failure and allows retry', async (phase) => {
      const slot = await workerSlot(v2);
      slot.fail.file = V2_BACKUP;
      slot.fail.phase = phase;
      expect(await slot.request('save')).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(v2);
      expect(slot.files.has(V2_BACKUP)).toBe(false);
      expect(slot.events).not.toContain(`writable ${PRIMARY}`);
      slot.fail.file = '';
      expect(await slot.request('save')).toMatchObject({ ok: true });
      expect(slot.files.get(V2_BACKUP)).toEqual(v2);
    },
  );

  it('keeps both original recovery files immutable through writes and clear', async () => {
    const slot = await workerSlot(v2);
    const original = new Uint8Array([...v2, 42]);
    slot.files.set(BACKUP, v1);
    slot.files.set(V2_BACKUP, original);
    expect(await slot.request('save')).toMatchObject({ ok: true });
    expect(await slot.request('clear')).toMatchObject({ ok: true });
    expect(slot.files.get(BACKUP)).toEqual(v1);
    expect(slot.files.get(V2_BACKUP)).toEqual(original);
    expect(slot.events).not.toContain(`writable ${V2_BACKUP}`);
    expect(slot.events).not.toContain(`writable ${BACKUP}`);
  });

  it.each([new Uint8Array(), v2, v4])('refuses a damaged or mismatched V3 recovery copy', async (backup) => {
    const slot = await workerSlot(v3);
    slot.files.set(V3_BACKUP, backup);
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v3);
    expect(slot.files.get(V3_BACKUP)).toEqual(backup);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it.each([new Uint8Array(), v1, v3])('refuses a damaged or mismatched V2 recovery copy', async (backup) => {
    const slot = await workerSlot(v2);
    slot.files.set(V2_BACKUP, backup);
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v2);
    expect(slot.files.get(V2_BACKUP)).toEqual(backup);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it('does not replace V2 when its existing backup cannot be read', async () => {
    const slot = await workerSlot(v2);
    slot.files.set(V2_BACKUP, v2);
    slot.fail.file = V2_BACKUP;
    slot.fail.phase = 'read';
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v2);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it.each([[v1, BACKUP], [v2, V2_BACKUP], [v3, V3_BACKUP]] as const)(
    'preserves original historical bytes before a V4 overwrite', async (previous, backup) => {
      const slot = await workerSlot(previous);
      expect(await slot.request('save', v4)).toMatchObject({ ok: true });
      expect(slot.files.get(backup)).toEqual(previous);
      expect(slot.files.get(PRIMARY)).toEqual(v4);
      expect(slot.events.indexOf(`close ${backup}`)).toBeLessThan(
        slot.events.indexOf(`writable ${PRIMARY}`),
      );
    },
  );

  it.each([new Uint8Array([1, 0]), new Uint8Array([...v1.slice(0, 8), 5, 0, 77])])(
    'refuses unknown primary headers before a V4 write', async (previous) => {
      const slot = await workerSlot(previous);
      expect(await slot.request('save', v4)).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(previous);
      expect(slot.events).not.toContain(`writable ${PRIMARY}`);
    },
  );

  it.each(['open', 'write', 'close'])(
    'keeps the primary untouched after backup %s failure and makes retry safe',
    async (phase) => {
      const slot = await workerSlot();
      slot.fail.file = BACKUP;
      slot.fail.phase = phase;
      expect(await slot.request('save')).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(v1);
      expect(slot.events).not.toContain(`writable ${PRIMARY}`);
      expect(slot.files.has(BACKUP)).toBe(false);

      slot.fail.file = '';
      expect(await slot.request('save')).toMatchObject({ ok: true });
      expect(slot.files.get(BACKUP)).toEqual(v1);
      expect(slot.files.get(PRIMARY)).toEqual(v4);
    },
  );

  it('closes a byte-exact V1 backup before opening the primary for a V4 write', async () => {
    const slot = await workerSlot();
    expect(await slot.request('save')).toMatchObject({ ok: true });
    expect(slot.files.get(BACKUP)).toEqual(v1);
    expect(slot.files.get(PRIMARY)).toEqual(v4);
    expect(slot.events.indexOf(`close ${BACKUP}`)).toBeGreaterThan(-1);
    expect(slot.events.indexOf(`close ${BACKUP}`)).toBeLessThan(
      slot.events.indexOf(`writable ${PRIMARY}`),
    );
  });

  it('preserves an existing V1 recovery copy through later writes and clear', async () => {
    const slot = await workerSlot();
    const firstBackup = new Uint8Array([...v1, 77]);
    slot.files.set(BACKUP, firstBackup);
    expect(await slot.request('save')).toMatchObject({ ok: true });
    expect(await slot.request('save')).toMatchObject({ ok: true });
    expect(slot.files.get(BACKUP)).toEqual(firstBackup);
    expect(slot.events).not.toContain(`writable ${BACKUP}`);
    expect(await slot.request('clear')).toMatchObject({ ok: true });
    expect(slot.files.has(PRIMARY)).toBe(false);
    expect(slot.files.get(BACKUP)).toEqual(firstBackup);
    expect(await slot.request('load')).toMatchObject({ ok: true, bytes: null });
  });

  it('fails closed on an empty backup left by an interrupted creation', async () => {
    const slot = await workerSlot();
    slot.files.set(BACKUP, new Uint8Array());
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v1);
    expect(slot.files.get(BACKUP)).toEqual(new Uint8Array());
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it.each([PRIMARY, BACKUP])('does not write when reading %s fails', async (name) => {
    const slot = await workerSlot();
    slot.files.set(BACKUP, v1.slice());
    slot.fail.file = name;
    slot.fail.phase = 'read';
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v1);
    expect(slot.events.filter((event) => event.startsWith('writable'))).toEqual([]);
  });

  it('retains the completed backup when the primary write fails', async () => {
    const slot = await workerSlot();
    slot.fail.file = PRIMARY;
    slot.fail.phase = 'write';
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v1);
    expect(slot.files.get(BACKUP)).toEqual(v1);
    expect(slot.events).toContain(`abort ${PRIMARY}`);
  });

  it.each([
    { previous: v4, next: v4 },
    { previous: null, next: v4 },
  ])('writes V4 without a historical backup when none is needed: %j', async ({ previous, next }) => {
    const slot = await workerSlot(previous);
    expect(await slot.request('save', next)).toMatchObject({ ok: true });
    expect(slot.files.get(PRIMARY)).toEqual(next);
    expect(slot.files.has(BACKUP)).toBe(false);
    expect(slot.files.has(V3_BACKUP)).toBe(false);
  });

  it.each([new Uint8Array([1, 0]), new Uint8Array([...v1.slice(0, 8), 5, 0, 77])])(
    'does not overwrite an unreadable or newer slot installed after this tab loaded', async (previous) => {
      const slot = await workerSlot(previous);
      expect(await slot.request('save')).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(previous);
      expect(slot.events).not.toContain(`writable ${PRIMARY}`);
    },
  );

  it('serializes simultaneous first saves from two worker instances under one origin lock', async () => {
    const slot = await workerSlot();
    const other = await slot.connect();
    const newerV4 = new Uint8Array([...v4, 42]);
    const responses = await Promise.all([slot.request('save'), other('save', newerV4)]);
    expect(responses.map((response) => response.ok)).toEqual([true, true]);
    expect(slot.files.get(PRIMARY)).toEqual(newerV4);
    expect(slot.files.get(BACKUP)).toEqual(v1);
    expect(slot.events.filter((event) => event === `writable ${BACKUP}`)).toHaveLength(1);
    expect(slot.locks.request).toHaveBeenCalledTimes(2);
    for (const [name] of slot.locks.request.mock.calls) expect(name).toBe('terrilives-save-slot');
  });

  it.each(['load', 'save', 'clear'] as const)('keeps bytes untouched when the %s lock fails', async (kind) => {
    const slot = await workerSlot();
    slot.locks.request.mockRejectedValue(new Error('lock denied'));
    expect(await slot.request(kind)).toMatchObject({ ok: false, error: 'lock denied' });
    expect(slot.events).toEqual([]);
    expect(slot.files.get(PRIMARY)).toEqual(v1);
  });

  it('reports unsupported Web Locks without touching storage', async () => {
    const slot = await workerSlot();
    vi.stubGlobal('navigator', {});
    expect(await slot.request('save')).toMatchObject({
      ok: false,
      error: 'Browser Web Locks are unavailable. Saved data has not been changed.',
    });
    expect(slot.events).toEqual([]);
    expect(slot.files.get(PRIMARY)).toEqual(v1);
  });
});
