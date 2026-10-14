import { expect, it, vi } from 'vitest';
import { BuildSession } from '../src/ui/build-session.js';
import { PersistenceController } from '../src/ui/persistence-controller.js';

function fixture() {
  let state = 1;
  let queued: number | null = null;
  const source = {
    saveBytes: () => Uint8Array.of(state),
    loadBytes: (bytes: Uint8Array) => { state = bytes[0]; queued = null; return true; },
    flushCommands: () => { if (queued !== null) { state = queued; queued = null; } },
    clockTick: () => 0, dayTicks: () => 1440,
  };
  const hooks = { prepare: () => true, settled: () => true, restored: vi.fn() };
  return { source, hooks, session: new BuildSession(source, hooks), edit: (value: number) => { queued = value; } };
}

it('keeps draft saves isolated, rolls back queued edits, and preserves confirmed batches', () => {
  const f = fixture();
  expect(f.session.begin()).toBe(true);
  f.edit(2); f.source.flushCommands();
  expect(f.source.saveBytes()).toEqual(Uint8Array.of(2));
  expect(f.session.saveBytes()).toEqual(Uint8Array.of(1));
  expect(f.session.confirm()).toBe(true);
  f.edit(3);
  expect(f.session.end()).toBe(true);
  f.source.flushCommands();
  expect(f.source.saveBytes()).toEqual(Uint8Array.of(2));
});

it('does not expose mutable baseline bytes or lose the checkpoint on failed cancellation', () => {
  const f = fixture(); f.session.begin();
  f.session.saveBytes()[0] = 99;
  expect(f.session.saveBytes()[0]).toBe(1);
  vi.spyOn(f.source, 'loadBytes').mockReturnValue(false);
  expect(f.session.end()).toBe(false);
  expect(f.session.active).toBe(true);
  expect(f.hooks.restored).not.toHaveBeenCalled();
});

it('will not confirm unfinished or invalid edits', () => {
  const f = fixture(); f.session.begin(); f.edit(2);
  f.hooks.prepare = () => false;
  expect(f.session.confirm()).toBe(false);
  expect(f.session.saveBytes()[0]).toBe(1);
  f.hooks.prepare = () => true;
  f.hooks.settled = () => false;
  expect(f.session.confirm()).toBe(false);
  expect(f.session.saveBytes()[0]).toBe(1);
});

it('manual persistence writes the confirmed world while draft commands are applied', async () => {
  const f = fixture();
  const store = { save: vi.fn(async (_bytes: Uint8Array) => {}),
    load: async () => null, clear: async () => {}, close() {} };
  const status = { textContent: '', setAttribute() {}, removeAttribute() {} };
  const persistence = new PersistenceController(store, f.session, status, error => { throw error; });
  f.session.begin(); f.edit(2); f.source.flushCommands();
  expect(await persistence.save()).toBe(true);
  expect(store.save).toHaveBeenLastCalledWith(Uint8Array.of(1));
  f.session.confirm();
  expect(await persistence.save()).toBe(true);
  expect(store.save).toHaveBeenLastCalledWith(Uint8Array.of(2));
});
