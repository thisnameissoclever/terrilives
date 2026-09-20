import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { spriteIndex } from '../src/render/atlas.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

describe('front door through the release WASM bridge', () => {
  it('migrates the rotated-bathtub pre-door fingerprint through the release boundary', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const fixture = readFileSync(
      '../crates/terri-wasm/tests/fixtures/pre-front-door-schema2.hex',
      'utf8',
    );
    const bytes = Uint8Array.from(Buffer.from(fixture.replace(/\s/g, ''), 'hex'));
    try {
      expect(bytes.byteLength).toBe(2679);
      expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('TERRISAV');
      expect(Array.from(bytes.slice(8, 10))).toEqual([2, 0]);
      expect(sim.loadBytes(bytes)).toBe(true);
      expect(sim.portalCount).toBe(1);
      const migrated = sim.saveBytes();
      expect(migrated).not.toEqual(bytes);
      expect(sim.loadBytes(migrated)).toBe(true);
      expect(sim.saveBytes()).toEqual(migrated);
      for (let tick = 0; tick < 1000; tick++) sim.tick();
      expect(sim.funds()).toBe(120);
      expect(sim.activities()).not.toContain(6);
    } finally {
      handle.free();
    }
  });

  it('loads the real pre-bathtub household with an active front door', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const fixture = readFileSync('../crates/terri-wasm/tests/fixtures/pre-bathtub-rotation.hex', 'utf8');
    const bytes = Uint8Array.from(Buffer.from(fixture.replace(/\s/g, ''), 'hex'));
    try {
      expect(sim.loadBytes(bytes)).toBe(true);
      expect(sim.portalCount).toBe(1);
      const migrated = sim.saveBytes();
      expect(sim.loadBytes(migrated)).toBe(true);
      expect(sim.saveBytes()).toEqual(migrated);
      const seen = new Set<number>();
      for (let tick = 0; tick < 1000; tick++) {
        sim.tick();
        seen.add(sim.portalStates()[0]);
      }
      expect([...seen].sort()).toEqual([0, 1, 2, 3]);
      expect(sim.funds()).toBe(120);
    } finally {
      handle.free();
    }
  });

  it('reacquires each zero-copy portal column after memory growth', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    expect(sim.portalCount).toBe(1);
    expect(Array.from(sim.portalPositions())).toEqual([15, 2]);
    expect(Array.from(sim.portalDepthOffsets())).toEqual([0.5]);
    expect(Array.from(sim.portalFrames())).toEqual([spriteIndex('frontDoorFrameSELeft')]);
    expect(Array.from(sim.portalLeaves(false))).toEqual([spriteIndex('frontDoorClosedSELeft')]);
    expect(Array.from(sim.portalStates())).toEqual([0]);
    const oldViews = [sim.portalPositions(), sim.portalFrames(), sim.portalLeaves(false),
      sim.portalLeaves(true), sim.portalStates(), sim.portalDepthOffsets()];
    for (const view of oldViews) expect(view.buffer).toBe(memory.buffer);
    const expected = oldViews.map(view => Array.from(view));
    memory.grow(1);
    for (const view of oldViews) expect(view.byteLength).toBe(0);
    const newViews = [sim.portalPositions(), sim.portalFrames(), sim.portalLeaves(false),
      sim.portalLeaves(true), sim.portalStates(), sim.portalDepthOffsets()];
    newViews.forEach((view, index) => {
      expect(view.buffer).toBe(memory.buffer);
      expect(Array.from(view)).toEqual(expected[index]);
    });
    handle.free();
  });

  it('plays every door state and preserves active crossings through save and load', () => {
    const handle = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    const loadedHandle = SimHandle.from_lot();
    const loaded = new SimBridge(loadedHandle, memory);
    const seen = new Set<number>();
    let sawWork = false;
    let sawReturn = false;
    for (let tick = 0; tick < 1100; tick++) {
      sim.tick();
      const state = sim.portalStates()[0];
      seen.add(state);
      const working = sim.activities().some(activity => activity === 6);
      sawReturn ||= sawWork && !working;
      sawWork ||= working;
      expect(sim.portalLeaves(true)[0]).toBe(spriteIndex(
        state === 0 ? 'frontDoorClosedSELeft' : 'frontDoorOpenSELeft'));
      if (state !== 0) {
        const saved = sim.saveBytes();
        expect(loaded.loadBytes(saved)).toBe(true);
        expect(loaded.portalStates()).toEqual(sim.portalStates());
        expect(loaded.portalLeaves(false)).toEqual(sim.portalLeaves(false));
        expect(loaded.saveBytes()).toEqual(saved);
        loaded.tick();
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(sawWork).toBe(true);
    expect(sawReturn).toBe(true);
    handle.free();
    loadedHandle.free();
  });
});
