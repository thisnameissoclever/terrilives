import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

// wasm-pack --target web emits a `_bg.wasm` that imports a `_bg.js` glue
// module which only exists for --target bundler, so the `memory` export
// cannot be imported directly under Vite or Vitest. The WebAssembly.Memory
// is captured from what init() resolves to and injected into the bridge.
// The zero-copy contract is unaffected: this is where the memory comes
// from, not how it is read.
let wasmMemory: WebAssembly.Memory;

beforeAll(async () => {
  const wasm = await init({
    module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm'),
  });
  wasmMemory = wasm.memory;
});

describe('SimBridge', () => {
  it('reads spawned positions without copying', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(4, 5);
    bridge.spawnAgent(1, 2, 50);

    expect(bridge.count).toBe(2);
    const pos = bridge.positions();
    expect(pos.length).toBe(4);
    expect(pos[0]).toBe(4);
    expect(pos[1]).toBe(5);
    expect(pos[2]).toBe(1);
    expect(pos[3]).toBe(2);
    // Zero copy means the view aliases WASM linear memory rather than
    // owning a snapshot of it. Anything that copied would fail here.
    expect(pos.buffer).toBe(wasmMemory.buffer);
  });

  it('tags agents and objects distinctly', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(4, 5);
    bridge.spawnAgent(1, 2, 50);
    const kinds = bridge.kinds();
    expect(kinds[0]).toBe(1);
    expect(kinds[1]).toBe(0);
  });

  it('moves an agent toward the fridge over ticks', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(12, 1);
    bridge.spawnAgent(1, 1, 20);

    const startX = bridge.positions()[2];
    for (let i = 0; i < 40; i++) bridge.tick();
    const endX = bridge.positions()[2];

    expect(endX).toBeGreaterThan(startX);
  });

  it('survives memory growth from many spawns', () => {
    const bridge = new SimBridge(new SimHandle(64, 64), wasmMemory);
    const bufferBeforeSpawns = wasmMemory.buffer;
    for (let i = 0; i < 2000; i++) {
      bridge.spawnAgent(i % 60, Math.floor(i / 60) % 60, 80);
    }
    // Precondition, per docs/testing-protocol.md rule 4 and [L7]: this
    // test is named for surviving growth, so it must assert that growth
    // actually happened. If a future build starts with more linear memory
    // than 2000 entities need, the spawn count has to rise; without this
    // line the test would instead go quietly green while guarding nothing.
    expect(wasmMemory.buffer).not.toBe(bufferBeforeSpawns);

    expect(bridge.count).toBe(2000);
    // If views were cached across growth this reads zeroes or throws.
    const pos = bridge.positions();
    expect(pos.length).toBe(4000);
    expect(pos.some((v) => v !== 0)).toBe(true);
  });

  it('returns a usable view after growth detached an earlier one', () => {
    // The causal form of the test above. It does not merely check that
    // the bridge still works; it holds on to exactly the view a caching
    // implementation would have reused, shows that growth detached it,
    // and shows the freshly built view is correct at the same instant.
    const bridge = new SimBridge(new SimHandle(64, 64), wasmMemory);
    bridge.spawnAgent(1, 2, 50);

    const held = bridge.positions();
    expect(held.length).toBe(2);

    for (let i = 0; i < 2000; i++) {
      bridge.spawnAgent(i % 60, Math.floor(i / 60) % 60, 80);
    }

    // A typed array over a detached ArrayBuffer reports length 0. This
    // doubles as the precondition: if growth had not happened, held would
    // still read 2 and this test would fail rather than pass vacuously.
    expect(held.length).toBe(0);

    const fresh = bridge.positions();
    expect(fresh.length).toBe(4002);
    // Slot order is by entity index, so the first agent keeps slot 0.
    expect(fresh[0]).toBe(1);
    expect(fresh[1]).toBe(2);
  });

  it('reproduces the native golden world hash across the wasm boundary', () => {
    // The native `world_hash_matches_its_golden_vector` in
    // crates/terri-sim/src/lib.rs claims to be a free cross-platform
    // check. It is not: it runs natively on both Windows and CI's Linux,
    // and the platform pair Task 8 actually created is native versus
    // wasm32, which nothing exercised.
    //
    // That gap is concrete, not theoretical. `FnvHasher::write_f32` calls
    // `f32::round`, which is round-half-away-from-zero in Rust and does
    // NOT map to wasm's `f32.nearest` (round-half-to-even), so rustc has
    // to emit a different code path there for wasm32. Every position and
    // every hunger level in the digest goes through it.
    //
    // Spawn order below matches the native `build_scenario` exactly: the
    // smart object first, so it holds the lower entity index, then eight
    // agents. `world_hash` keys its rows on the entity index, so the
    // order is load-bearing rather than stylistic.
    //
    // If this ever disagrees with the native constant, that is a genuine
    // finding about this project's determinism guarantees. Do not adjust
    // the constant to match; report the divergence.
    const bridge = new SimBridge(new SimHandle(24, 24), wasmMemory);
    bridge.spawnObject(18, 14);
    for (let i = 0; i < 8; i++) {
      bridge.spawnAgent(1 + i, 1, 30 + 5 * i);
    }
    for (let i = 0; i < 100; i++) bridge.tick();

    // Precondition, per docs/testing-protocol.md rule 5. A digest over an
    // empty world is still a digest, and it would still be stable, so
    // without this the test could agree with a constant while the
    // scenario silently built nothing.
    expect(bridge.count).toBe(9);

    // bigint, not Number. Number() coercion silently drops the low bits
    // of a u64, and the low bits are the whole point of a digest.
    expect(bridge.worldHash()).toBe(0xef60_1d50_4790_5825n);
  });

  it('exposes the world hash as a bigint that tracks simulation state', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(12, 1);
    bridge.spawnAgent(1, 1, 20);

    const before = bridge.worldHash();
    // A u64 digest routed through Number() silently loses its low bits,
    // and the low bits are the whole point of a digest comparison.
    expect(typeof before).toBe('bigint');

    for (let i = 0; i < 10; i++) bridge.tick();
    // Causal: the bridge reads live simulation state through the handle
    // rather than returning something captured once at construction.
    expect(bridge.worldHash()).not.toBe(before);
  });
});
