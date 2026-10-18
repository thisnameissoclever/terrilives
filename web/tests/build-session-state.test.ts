import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildSession } from '../src/ui/build-session.js';
import { PersistenceController } from '../src/ui/persistence-controller.js';
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
function fixture() {
  const handle = SimHandle.from_lot(), source = new SimBridge(handle, memory);
  const hooks = { prepare: () => true, settled: () => true, restored: vi.fn(), replaced: vi.fn() };
  return { handle, source, hooks, session: new BuildSession(source, hooks) };
}
it('uses native semantic dirty state while every public save remains committed', () => {
  const f = fixture();
  try {
    const before = f.source.saveBytes(); expect(f.session.begin()).toBe(true);
    expect(f.source.buildActive()).toBe(true); expect(f.session.hasChanges()).toBe(false);
    f.source.stageRoomName(0, 'Garden'); expect(f.session.hasChanges()).toBe(true);
    expect(f.source.saveBytes()).toEqual(before); expect(f.session.saveBytes()).toEqual(before);
    f.source.stageRoomName(0, 'Outside'); expect(f.session.hasChanges()).toBe(false);
    f.source.stageRoomName(0, 'Garden'); expect(f.session.confirm()).toBe(true);
    const confirmed = f.source.saveBytes(); expect(confirmed).not.toEqual(before);
    f.source.stageRoomName(0, 'Later'); expect(f.session.cancel()).toBe(true);
    expect(f.source.saveBytes()).toEqual(confirmed); expect(f.session.active).toBe(true);
    expect(f.session.end()).toBe(true); expect(f.session.active).toBe(false);
  } finally { f.handle.free(); }
});
it('preserves local state on refused Load and replaces it only after accepted native adoption', () => {
  const f = fixture();
  try {
    f.session.begin(); const saved = f.source.saveBytes(); f.source.stageRoomName(0, 'Garden');
    expect(f.session.loadBytes(new Uint8Array())).toBe(false); expect(f.hooks.replaced).not.toHaveBeenCalled();
    expect(f.session.hasChanges()).toBe(true);
    expect(f.session.loadBytes(saved)).toBe(true); expect(f.hooks.replaced).toHaveBeenCalledOnce();
    expect(f.session.active).toBe(true); expect(f.session.hasChanges()).toBe(false);
  } finally { f.handle.free(); }
});
it('manual persistence writes the native confirmed bytes during editing and preparation', async () => {
  const f = fixture();
  const store = { save: vi.fn(async (_bytes: Uint8Array) => {}), load: async () => null, clear: async () => {}, close() {} };
  const status = { textContent: '', setAttribute() {}, removeAttribute() {} };
  const persistence = new PersistenceController(store, f.session, status, error => { throw error; });
  try {
    f.session.begin(); const before = f.source.saveBytes(); f.source.stageRoomName(0, 'Garden');
    f.source.prepareBuildCommit(); expect(await persistence.save()).toBe(true); expect(store.save).toHaveBeenLastCalledWith(before);
    expect(f.session.confirm()).toBe(true); expect(await persistence.save()).toBe(true);
    expect(store.save).toHaveBeenLastCalledWith(f.source.saveBytes()); expect(f.source.saveBytes()).not.toEqual(before);
  } finally { f.handle.free(); }
});
