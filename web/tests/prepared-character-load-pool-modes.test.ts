import { expect, it } from 'vitest';
import { defaultAppearance } from '../src/character/schema.js';
import { CharacterContactRoster } from '../src/render/character/contact-admission.js';
import { loadPreparedCharacterState } from '../src/render/character/prepared-character-load.js';
import { AdmissionTestService } from './fixtures/contact-admission-service.js';

it('adopts a pool-free household without requesting swimming contacts', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const incoming = new Uint8Array([3, 5]);
  let saved: Uint8Array | undefined;
  try {
    const pending = loadPreparedCharacterState(incoming, { loadBytes(bytes) { saved = bytes; return true; } }, () => ({
      loadBytes: () => true,
      characterAppearances: () => [{ entity: 1, appearance }],
      poolContactRequired: () => false,
      flushCommands() {},
      free() {},
    }), roster);
    void pending.catch(() => {});
    expect([...service.entries.values()].map(row => row.mode)).toEqual(['base']);
    expect(saved).toBeUndefined();
    service.finish(appearance, 'base');
    expect(await pending).toBe(true);
    expect(saved).toEqual(incoming);
    expect(roster.require(1, appearance).pool).toBeUndefined();
  } finally {
    roster.dispose();
  }
});

it('holds import until swimming contacts are ready for a queued first pool', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const rows = [{ entity: 1, appearance }];
  let flushed = false, adopted = false;
  try {
    const pending = loadPreparedCharacterState(new Uint8Array([5]), { loadBytes() { adopted = true; return true; } }, () => ({
      loadBytes: () => true,
      characterAppearances: () => rows,
      poolContactRequired: () => flushed,
      flushCommands() { flushed = true; },
      free() {},
    }), roster);
    void pending.catch(() => {});
    service.finish(appearance, 'base');
    await Promise.resolve();
    expect(adopted).toBe(false);
    service.finish(appearance, 'pool-required');
    expect(await pending).toBe(true);
    expect(roster.mode).toBe('base');
    expect(roster.hasQueued).toBe(true);
    roster.afterCommands(rows, 'pool-required');
    expect(roster.require(1, appearance).pool).toBeDefined();
  } finally {
    roster.dispose();
  }
});

it('installs post-command swimming contacts when a paused Build load settles the incoming queue', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const rows = [{ entity: 1, appearance }];
  let flushed = false;
  try {
    const pending = loadPreparedCharacterState(new Uint8Array([5]), {
      loadBytes: () => true, settlesQueuedOnLoad: () => true,
    }, () => ({
      loadBytes: () => true,
      characterAppearances: () => rows,
      poolContactRequired: () => flushed,
      flushCommands() { flushed = true; },
      free() {},
    }), roster);
    service.finish(appearance, 'pool-required');
    expect(await pending).toBe(true);
    expect(roster.require(1, appearance).pool).toBeDefined();
    expect(roster.hasQueued).toBe(false);
  } finally {
    roster.dispose();
  }
});
