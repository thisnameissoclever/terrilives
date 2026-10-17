import { CURRENT_SAVE_VERSION } from '../src/storage/save-header.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PRIMARY = 'terri-save-1.bin';
const BACKUP = 'terri-save-1.v1-backup.bin';
const V2_BACKUP = 'terri-save-1.v2-backup.bin';
const V3_BACKUP = 'terri-save-1.v3-backup.bin';
const V4_BACKUP = 'terri-save-1.v4-backup.bin';
const V5_BACKUP = 'terri-save-1.v5-backup.bin';
const V6_BACKUP = 'terri-save-1.v6-backup.bin';
const V7_BACKUP = 'terri-save-1.v7-backup.bin';
const v7 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 7, 0, 29, 128, 0, 0, 0, 1]);
// Independent wire fixture: ASCII TERRISAV, little-endian u16 version, payload.
const v1 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 1, 0, 17, 0, 255]);
const v2 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 2, 0, 29, 128]);
const v3 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 3, 0, 29, 128, 0]);
const v4 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 4, 0, 29, 128, 0, 0]);
const v5 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 5, 0, 29, 128, 0, 0, 0]);
const v6 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 6, 0, 29, 128, 0, 0, 0, 1]);
const V8_BACKUP = 'terri-save-1.v8-backup.bin';
const v8 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 8, 0, 29, 128, 0, 0, 0, 1]);
const V9_BACKUP = 'terri-save-1.v9-backup.bin';
const v9 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 9, 0, 29, 128, 0, 0, 0, 1]);
const v10 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 10, 0, 29, 128, 0, 0, 0, 1]);
const V10_BACKUP = 'terri-save-1.v10-backup.bin';
const v11 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 11, 0, 29, 128, 0, 0, 0, 1]);
const V11_BACKUP = 'terri-save-1.v11-backup.bin';
const v12 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 12, 0, 29, 128, 0, 0, 0, 1]);
const V12_BACKUP = 'terri-save-1.v12-backup.bin';
const v13 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 13, 0, 29, 128, 0, 0, 0, 1]);
const V13_BACKUP = 'terri-save-1.v13-backup.bin';
const v14 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 14, 0, 29, 128, 0, 0, 0, 1]);
const V14_BACKUP = 'terri-save-1.v14-backup.bin';
const v15 = new Uint8Array([84, 69, 82, 82, 73, 83, 65, 86, 15, 0, 29, 128, 0, 0, 0, 1]);

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
  async function connect(legacy: false | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12' | 'v13' | 'v14' = false) {
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
    else if (legacy === 'v4') await import('./fixtures/v4-worker/save-worker.js');
    else if (legacy === 'v5') await import('./fixtures/v5-worker/save-worker.js');
    else if (legacy === 'v6') await import('./fixtures/v6-worker/save-worker.js');
    else if (legacy === 'v7') await import('./fixtures/v7-worker/save-worker.js');
    else if (legacy === 'v8') await import('./fixtures/v8-worker/save-worker.js');
    else if (legacy === 'v9') await import('./fixtures/v9-worker/save-worker.js');
    else if (legacy === 'v10') await import('./fixtures/v10-worker/save-worker.js');
    else if (legacy === 'v11') await import('./fixtures/v11-worker/save-worker.js');
    else if (legacy === 'v12') await import('./fixtures/v12-worker/save-worker.js');
    else if (legacy === 'v13') await import('./fixtures/v13-worker/save-worker.js');
    else if (legacy === 'v14') await import('./fixtures/v14-worker/save-worker.js');
    else await import('../src/storage/save-worker.js');
    let id = 0;
    function request(kind: 'load' | 'save' | 'clear', bytes: Uint8Array = v15): Promise<Response> {
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
  it('closes an exact V14 backup before writing V15 and refuses the cached V14 writer', async () => {
    const slot = await workerSlot(v14);
    expect(await slot.request('save', v15)).toMatchObject({ok:true});
    expect(slot.files.get(V14_BACKUP)).toEqual(v14);
    expect(slot.events.indexOf(`close ${V14_BACKUP}`)).toBeLessThan(slot.events.indexOf(`writable ${PRIMARY}`));
    const cached=await slot.connect('v14');
    expect(await cached('save',v14)).toMatchObject({ok:false});
    expect(slot.files.get(PRIMARY)).toEqual(v15);
    expect(slot.files.get(V14_BACKUP)).toEqual(v14);
  });
  it('preserves exact V8 bytes before a current write and refuses a cached V8 overwrite', async () => {
    const slot = await workerSlot(v8);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V8_BACKUP)).toEqual(v8);
    const cached = await slot.connect('v8');
    expect(await cached('save', v8)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
    expect(slot.events.indexOf(`close ${V8_BACKUP}`)).toBeLessThan(slot.events.indexOf(`writable ${PRIMARY}`));
  });
  it('preserves V7 before a current write and refuses a cached V7 overwrite', async () => {
    const slot = await workerSlot(v7);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V7_BACKUP)).toEqual(v7);
    const cached = await slot.connect('v7');
    expect(await cached('save', v7)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it('preserves V9 before a current write and refuses a cached V9 writer', async () => {
    const slot = await workerSlot(v9);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V9_BACKUP)).toEqual(v9);
    const cached = await slot.connect('v9');
    expect(await cached('save', v9)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it('preserves V10 before a current write and refuses a cached V10 writer', async () => {
    const slot = await workerSlot(v10);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V10_BACKUP)).toEqual(v10);
    const cached = await slot.connect('v10');
    expect(await cached('save', v10)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it('preserves V11 before a current write and refuses a cached V11 writer', async () => {
    const slot = await workerSlot(v11);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V11_BACKUP)).toEqual(v11);
    const cached = await slot.connect('v11');
    expect(await cached('save', v11)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it('preserves V12 before V15 and refuses a cached V12 writer', async () => {
    const slot = await workerSlot(v12);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V12_BACKUP)).toEqual(v12);
    const cached = await slot.connect('v12');
    expect(await cached('save', v12)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it('preserves V13 before V15 and refuses a cached V13 writer', async () => {
    const slot = await workerSlot(v13);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V13_BACKUP)).toEqual(v13);
    const cached = await slot.connect('v13');
    expect(await cached('save', v13)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
  });
  it.each(['local-character-0', 'main-social-active'])(
    'preserves exact %s V9 recovery bytes before writing a real current save', async (name) => {
      const { readFileSync } = await import('node:fs');
      const { default: init, SimHandle } = await import('../src/wasm/terri_wasm.js');
      await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
      const previous = new Uint8Array(readFileSync(new URL(
        `../../crates/terri-wasm/tests/fixtures/schema-v9/${name}.sav`, import.meta.url)));
      const sim = SimHandle.from_lot();
      try {
        expect(sim.load_bytes(previous)).toBe(true);
        const current = sim.save_bytes();
        const slot = await workerSlot(previous);
        expect(await slot.request('save', current)).toMatchObject({ ok: true });
        expect(slot.files.get(V9_BACKUP)).toEqual(previous);
        const cached = await slot.connect('v9');
        expect(await cached('save', previous)).toMatchObject({ ok: false });
        expect(slot.files.get(PRIMARY)).toEqual(current);
        expect(slot.files.get(V9_BACKUP)).toEqual(previous);
      } finally { sim.free(); }
    },
  );
  it('stores the current simulation save without changing its bytes', async () => {
    const { readFileSync } = await import('node:fs');
    const { default: init, SimHandle } = await import('../src/wasm/terri_wasm.js');
    await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
    const sim = SimHandle.from_lot();
    try {
      const bytes = sim.save_bytes();
      const slot = await workerSlot(null);
      expect(await slot.request('save', bytes)).toMatchObject({ ok: true });
      expect(slot.files.get(PRIMARY)).toEqual(bytes);
      expect(new Uint8Array((await slot.request('load')).bytes!)).toEqual(bytes);
    } finally {
      sim.free();
    }
  });

  it('backs up exact V5 bytes before the first current write', async () => {
    const slot = await workerSlot(v5);
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V5_BACKUP)).toEqual(v5);
    expect(slot.files.get(PRIMARY)).toEqual(v15);
    expect(slot.events.indexOf(`close ${V5_BACKUP}`)).toBeLessThan(slot.events.indexOf(`writable ${PRIMARY}`));
  });

  it.each(['open', 'write', 'close'])('preserves V5 after backup %s failure', async (phase) => {
    const slot = await workerSlot(v5);
    slot.fail.file = V5_BACKUP;
    slot.fail.phase = phase;
    expect(await slot.request('save', v15)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v5);
    expect(slot.files.has(V5_BACKUP)).toBe(false);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
    slot.fail.file = '';
    expect(await slot.request('save', v15)).toMatchObject({ ok: true });
    expect(slot.files.get(V5_BACKUP)).toEqual(v5);
  });

  it('the published V5 worker refuses a V6 slot', async () => {
    const slot = await workerSlot(v6);
    const oldWorker = await slot.connect('v5');
    expect(await oldWorker('save', v5)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v6);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });
  it('the previous V6 worker refuses a current slot', async () => {
    const slot = await workerSlot(v15);
    const oldWorker = await slot.connect('v6');
    expect(await oldWorker('save', v6)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v15);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it('the actual V2 worker refuses a V3 slot installed by a newer tab', async () => {
    const slot = await workerSlot(v3);
    const oldWorker = await slot.connect('v2');
    expect(await oldWorker('save', v2)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v3);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  // [SL-save]: a tab still running the V3 build must not overwrite a V4
  // slot a newer tab wrote.
  it('the actual V3 worker refuses a V4 slot installed by a newer tab', async () => {
    const slot = await workerSlot(v4);
    const oldWorker = await slot.connect('v3');
    expect(await oldWorker('save', v3)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v4);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  // [RC-save]: a tab still running the V4 build must not overwrite a V5
  // slot a newer tab wrote.
  it('the actual V4 worker refuses a V5 slot installed by a newer tab', async () => {
    const slot = await workerSlot(v5);
    const oldWorker = await slot.connect('v4');
    expect(await oldWorker('save', v4)).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v5);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
  });

  it.each([v1, v2, v3, v4, v5, v6, v7, v8, v9, new Uint8Array([2, 0]), new Uint8Array([...v5.slice(0, 8), CURRENT_SAVE_VERSION + 1, 0])])(
    'refuses non-current outgoing headers before touching storage', async (next) => {
      const slot = await workerSlot(v5);
      expect(await slot.request('save', next)).toMatchObject({ ok: false });
      expect(slot.files.get(PRIMARY)).toEqual(v5);
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

  it.each([new Uint8Array(), v3, v5])('refuses a damaged or mismatched V4 recovery copy', async (backup) => {
    const slot = await workerSlot(v4);
    slot.files.set(V4_BACKUP, backup);
    expect(await slot.request('save')).toMatchObject({ ok: false });
    expect(slot.files.get(PRIMARY)).toEqual(v4);
    expect(slot.files.get(V4_BACKUP)).toEqual(backup);
    expect(slot.events).not.toContain(`writable ${PRIMARY}`);
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

  it.each([[v1, BACKUP], [v2, V2_BACKUP], [v3, V3_BACKUP], [v4, V4_BACKUP], [v5, V5_BACKUP], [v6, V6_BACKUP], [v7, V7_BACKUP], [v8, V8_BACKUP], [v9, V9_BACKUP], [v10, V10_BACKUP], [v11, V11_BACKUP], [v12, V12_BACKUP], [v13, V13_BACKUP]] as const)(
    'preserves original historical bytes before a current overwrite', async (previous, backup) => {
      const slot = await workerSlot(previous);
      expect(await slot.request('save', v15)).toMatchObject({ ok: true });
      expect(slot.files.get(backup)).toEqual(previous);
      expect(slot.files.get(PRIMARY)).toEqual(v15);
      expect(slot.events.indexOf(`close ${backup}`)).toBeLessThan(
        slot.events.indexOf(`writable ${PRIMARY}`),
      );
    },
  );

  it.each([new Uint8Array([1, 0]), new Uint8Array([...v1.slice(0, 8), CURRENT_SAVE_VERSION + 1, 0, 77]),
    new Uint8Array([...v1.slice(0, 8), 0, 0, 77])])(
    'refuses unknown primary headers before a current write', async (previous) => {
      const slot = await workerSlot(previous);
      expect(await slot.request('save', v15)).toMatchObject({ ok: false });
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
      expect(slot.files.get(PRIMARY)).toEqual(v15);
    },
  );

  it('closes a byte-exact V1 backup before opening the primary for a current write', async () => {
    const slot = await workerSlot();
    expect(await slot.request('save')).toMatchObject({ ok: true });
    expect(slot.files.get(BACKUP)).toEqual(v1);
    expect(slot.files.get(PRIMARY)).toEqual(v15);
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
    { previous: v15, next: v15 },
    { previous: null, next: v15 },
  ])('writes the current schema without a historical backup when none is needed: %j', async ({ previous, next }) => {
    const slot = await workerSlot(previous);
    expect(await slot.request('save', next)).toMatchObject({ ok: true });
    expect(slot.files.get(PRIMARY)).toEqual(next);
    expect(slot.files.has(BACKUP)).toBe(false);
    expect(slot.files.has(V4_BACKUP)).toBe(false);
  });

  it.each([new Uint8Array([1, 0]), new Uint8Array([...v1.slice(0, 8), CURRENT_SAVE_VERSION + 1, 0, 77])])(
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
    const newerV15 = new Uint8Array([...v15, 42]);
    const responses = await Promise.all([slot.request('save'), other('save', newerV15)]);
    expect(responses.map((response) => response.ok)).toEqual([true, true]);
    expect(slot.files.get(PRIMARY)).toEqual(newerV15);
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
