import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';

it('loads the captured historical save through release WASM and preserves continuation', async () => {
  await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  const hex = readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/pre-voice-157.hex',
    import.meta.url), 'utf8').replace(/\s/g, '');
  const bytes = new Uint8Array(Buffer.from(hex, 'hex'));
  expect(bytes).toHaveLength(2607);
  const loaded = SimHandle.from_lot();
  const resumed = SimHandle.from_lot();
  try {
    expect(loaded.load_bytes(bytes)).toBe(true);
    expect(loaded.sim_tick()).toBe(157n);
    expect(loaded.entity_count()).toBe(37);
    const before = loaded.save_bytes();
    expect(loaded.load_bytes(bytes.slice(0, -1))).toBe(false);
    expect(loaded.save_bytes()).toEqual(before);
    const current = loaded.save_bytes();
    expect([...current.slice(8, 10)]).toEqual([22, 0]);
    expect(resumed.load_bytes(current)).toBe(true);
    for (let tick = 0; tick < 300; tick += 1) { loaded.tick(); resumed.tick(); }
    expect(loaded.sim_tick()).toBe(457n);
    expect(resumed.sim_tick()).toBe(457n);
    expect(loaded.save_bytes()).toEqual(resumed.save_bytes());
  } finally { loaded.free(); resumed.free(); }
});


it.each(['local-character-0', 'local-character-400', 'local-character-1200',
  'main-social-0', 'main-social-400', 'main-social-1200', 'main-social-active'])(
  'migrates authentic %s V9 bytes through release WASM', async (name) => {
    await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
    const bytes = new Uint8Array(readFileSync(new URL(
      `../../crates/terri-wasm/tests/fixtures/schema-v9/${name}.sav`, import.meta.url)));
    const loaded = SimHandle.from_lot();
    const resumed = SimHandle.from_lot();
    try {
      expect([...bytes.slice(8, 10)]).toEqual([9, 0]);
      expect(loaded.load_bytes(bytes)).toBe(true);
      const current = loaded.save_bytes();
      expect([...current.slice(8, 10)]).toEqual([22, 0]);
      expect(resumed.load_bytes(current)).toBe(true);
      expect(resumed.save_bytes()).toEqual(current);
      for (let tick = 0; tick < 100; tick += 1) { loaded.tick(); resumed.tick(); }
      expect(loaded.save_bytes()).toEqual(resumed.save_bytes());
      expect(loaded.appearance_hash()).toBe(resumed.appearance_hash());
    } finally { loaded.free(); resumed.free(); }
  },
);

it.each(['initial', 'running-fight'])(
  'continues authentic published V19 %s through the release V22 reader', async (name) => {
    await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
    const original = new Uint8Array(readFileSync(new URL(
      `../../crates/terri-wasm/tests/fixtures/published-v19/${name}.sav`, import.meta.url)));
    expect([...original.slice(8, 10)]).toEqual([19, 0]);
    const migrated = SimHandle.from_lot();
    const resumed = SimHandle.from_lot();
    try {
      expect(migrated.load_bytes(original)).toBe(true);
      const current = migrated.save_bytes();
      expect([...current.slice(8, 10)]).toEqual([22, 0]);
      expect(resumed.load_bytes(current)).toBe(true);
      expect(resumed.save_bytes()).toEqual(current);
      for (let tick = 0; tick < 100; tick += 1) { migrated.tick(); resumed.tick(); }
      expect(resumed.world_hash()).toBe(migrated.world_hash());
      expect(resumed.save_bytes()).toEqual(migrated.save_bytes());
    } finally { migrated.free(); resumed.free(); }
  },
);

it.each(['shipped-household', 'queued-setting'])(
  'continues main\'s V20 %s through the release V22 reader on standard shifts', async (name) => {
    await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
    const original = new Uint8Array(readFileSync(new URL(
      `../../crates/terri-wasm/tests/fixtures/shifts-v20/${name}.sav`, import.meta.url)));
    expect([...original.slice(8, 10)]).toEqual([20, 0]);
    const migrated = SimHandle.from_lot();
    const resumed = SimHandle.from_lot();
    try {
      expect(migrated.load_bytes(original)).toBe(true);
      const current = migrated.save_bytes();
      expect([...current.slice(8, 10)]).toEqual([22, 0]);
      expect(resumed.load_bytes(current)).toBe(true);
      expect(resumed.save_bytes()).toEqual(current);
      for (let tick = 0; tick < 100; tick += 1) { migrated.tick(); resumed.tick(); }
      expect(resumed.world_hash()).toBe(migrated.world_hash());
      expect(resumed.save_bytes()).toEqual(migrated.save_bytes());
    } finally { migrated.free(); resumed.free(); }
  },
);

it.each(['two-days-tim-at-work', 'night-shift-open', 'double-bed-in-yard'])(
  "continues main's V21 %s through the release V22 reader with the raised wages", async (name) => {
    await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
    const original = new Uint8Array(readFileSync(new URL(
      `../../crates/terri-wasm/tests/fixtures/bills-v21/${name}.sav`, import.meta.url)));
    expect([...original.slice(8, 10)]).toEqual([21, 0]);
    const migrated = SimHandle.from_lot();
    const resumed = SimHandle.from_lot();
    try {
      expect(migrated.load_bytes(original)).toBe(true);
      const current = migrated.save_bytes();
      expect([...current.slice(8, 10)]).toEqual([22, 0]);
      expect(resumed.load_bytes(current)).toBe(true);
      expect(resumed.save_bytes()).toEqual(current);
      for (let tick = 0; tick < 100; tick += 1) { migrated.tick(); resumed.tick(); }
      expect(resumed.world_hash()).toBe(migrated.world_hash());
      expect(resumed.save_bytes()).toEqual(migrated.save_bytes());
    } finally { migrated.free(); resumed.free(); }
  },
);
