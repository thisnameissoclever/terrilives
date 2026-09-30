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
    expect([...current.slice(8, 10)]).toEqual([5, 0]);
    expect(resumed.load_bytes(current)).toBe(true);
    for (let tick = 0; tick < 300; tick += 1) { loaded.tick(); resumed.tick(); }
    expect(loaded.sim_tick()).toBe(457n);
    expect(resumed.sim_tick()).toBe(457n);
    expect(loaded.save_bytes()).toEqual(resumed.save_bytes());
  } finally { loaded.free(); resumed.free(); }
});
