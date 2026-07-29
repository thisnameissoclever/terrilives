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
    bridge.spawnObject(4, 5, 'fridge');
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
    bridge.spawnObject(4, 5, 'fridge');
    bridge.spawnAgent(1, 2, 50);
    const kinds = bridge.kinds();
    expect(kinds[0]).toBe(1);
    expect(kinds[1]).toBe(0);
  });

  it('carries a content-resolved sprite index per entity', () => {
    // The Rust twin is in crates/terri-wasm/src/lib.rs; this one is not
    // redundant with it for [L12]'s reason - that one is a debug build of
    // the rlib, and the artifact the page loads is the release wasm.
    //
    // The specific mistake this is written against is the one that made
    // Task 3b's screen nine identical blue diamonds: every entity
    // reaching the GPU with the same number. Two DIFFERENT objects plus a
    // sim is the smallest fixture that can see it; two of the same object
    // could not.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    expect(bridge.spawnObject(4, 5, 'fridge')).toBe(true);
    expect(bridge.spawnObject(6, 7, 'bed')).toBe(true);
    bridge.spawnAgent(1, 2, 50);

    const sprites = bridge.sprites();
    expect(sprites.length).toBe(3);
    expect(new Set(sprites).size).toBe(3);
    // A zero-copy view like every other accessor here, not a snapshot.
    expect(sprites.buffer).toBe(wasmMemory.buffer);
    // And the two objects differ from the sim as well as from each
    // other, so a sprite column filled with `sim_sprite` throughout -
    // the mutation that looks most like working code - fails.
    expect(sprites[0]).not.toBe(sprites[2]);
    expect(sprites[1]).not.toBe(sprites[2]);
  });

  it('reports the shipped lot walls, with the doorway left open', () => {
    // The renderer draws these, so if they disagreed with the grid the
    // page would show a wall where a sim walks through, or a gap where
    // one detours. Both read as an AI fault rather than a drawing one.
    const handle = SimHandle.from_lot();
    const bridge = new SimBridge(handle, wasmMemory);
    const walls = bridge.wallTiles();

    expect(walls.length % 2).toBe(0);
    const pairs = new Set<string>();
    for (let i = 0; i < walls.length; i += 2) {
      pairs.add(`${walls[i]},${walls[i + 1]}`);
    }
    // Rule 5: an empty list would satisfy the two absence checks below.
    expect(pairs.size).toBeGreaterThanOrEqual(8);
    expect(pairs.size * 2).toBe(walls.length);

    expect(pairs.has('9,1')).toBe(true);
    expect(pairs.has('9,3')).toBe(true);
    // The doorway. Drawn as a wall, the bathroom would look sealed while
    // the sim walked straight through the picture of one.
    expect(pairs.has('9,2')).toBe(false);
    // Every tile is inside the lot; the boundary is drawn from the lot's
    // dimensions instead, because no tile exists off the grid to report.
    for (const key of pairs) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeLessThan(handle.lot_width());
      expect(y).toBeLessThan(handle.lot_height());
    }
  });

  it('rejects an unknown content id without trapping the wasm module', () => {
    // The Rust-side twin of this lives in crates/terri-wasm/src/lib.rs.
    // This one is not redundant with it, and the reason is [L12]: the
    // native test runs in a debug build, and the artifact that ships is
    // the release build wasm-pack produces. A check that exists only in
    // debug passes there and is absent here. This test runs against the
    // real released module, so it is the one that shows the check ships.
    //
    // The mutation it is written against is `expect`/`unwrap` on the
    // lookup. Note what that does to a wasm module specifically: a panic
    // unwinds into a JS exception AND leaves the instance permanently
    // trapped, so it is not one failed call, it is the end of the
    // session. The two assertions after the rejection are what tell a
    // returned `false` apart from a trap, since on a trapped module
    // every later call throws instead of returning.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    expect(bridge.spawnObject(4, 5, 'fridge')).toBe(true);

    expect(bridge.spawnObject(4, 6, 'no_such_object')).toBe(false);
    expect(bridge.count).toBe(1);

    expect(bridge.spawnObject(6, 7, 'fridge')).toBe(true);
    bridge.tick();
    expect(bridge.count).toBe(2);
  });

  it('moves an agent toward the fridge over ticks', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(12, 1, 'fridge');
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

  it('loads the shipped lot through from_lot before the first tick', () => {
    // The Rust twin of this lives in crates/terri-wasm/src/lib.rs, and
    // this one is not redundant with it for [L12]'s reason: the native
    // test is a debug build of the rlib, and the artifact that ships is
    // the release wasm wasm-pack emits. Only this side runs the thing the
    // page runs.
    //
    // `from_lot` is what replaced main.ts's hardcoded 16x16 room and its
    // single hand-placed fridge. That hardcoding is the failure this test
    // exists to keep out: the game would run against none of the authored
    // content, and would look completely normal doing it.
    const handle = SimHandle.from_lot();
    const bridge = new SimBridge(handle, wasmMemory);

    // Nothing ticks first, on purpose: `from_lot` has to sync the render
    // buffer itself, or the opening frame draws an empty lot.
    expect(bridge.count).toBeGreaterThanOrEqual(8);
    const kinds = bridge.kinds();
    expect([...kinds].every((k) => k === 1)).toBe(true);

    const width = handle.lot_width();
    const height = handle.lot_height();
    // Non-square, which is what makes the two accessors distinguishable
    // at all; without this the checks below would pass with them swapped.
    expect(width).not.toBe(height);

    const positions = bridge.positions();
    expect(positions.length).toBe(bridge.count * 2);
    for (let i = 0; i < bridge.count; i++) {
      expect(positions[i * 2]).toBeLessThan(width);
      expect(positions[i * 2 + 1]).toBeLessThan(height);
    }
    // At least one object sits at an x the lot's HEIGHT would reject, so
    // the bounds above are genuinely testing x against width rather than
    // passing under either reading.
    const xs = [...positions].filter((_, i) => i % 2 === 0);
    expect(xs.some((x) => x >= height)).toBe(true);

    // And the loaded grid is walkable: a hungry sim dropped into the
    // living space paths to something. A lot whose walls were applied to
    // every tile would satisfy every assertion above and leave the sim
    // standing still forever ([L17]).
    bridge.spawnAgent(8, 6, 20);
    const before = [...bridge.positions()];
    for (let i = 0; i < 10; i++) bridge.tick();
    expect([...bridge.positions()]).not.toEqual(before);
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
    // every one of the seven need levels in the digest goes through it.
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
    bridge.spawnObject(18, 14, 'fridge');
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
    //
    // Moved at Task 7's content-driven decay, together with the native
    // constant it mirrors: all seven needs now drain at the rates
    // content/needs.toml declares, so the six levels that used to hold at
    // their spawn value for all 100 ticks now fall. The digest's shape is
    // unchanged; only the values it covers moved.
    //
    // **Measured on wasm32 rather than copied from native** ([L13]) - the
    // wasm build was rebuilt with `wasm-pack build crates/terri-wasm
    // --target web --out-dir ../../web/src/wasm` FIRST, this test was then
    // run against the old constant, and the value it reported was read off
    // the failure. Skipping the rebuild reads the previous artifact and
    // measures nothing ([L8]). The two targets agree, which is a
    // measurement each time and not a guarantee: `write_f32` calls
    // `f32::round`, whose rounding mode differs from wasm's `f32.nearest`
    // on a half-way value.
    //
    // Previous values: 0x6c37_57f1_8481_75c1n (Task 6, at the
    // Hunger-to-Needs encoding change), 0xef60_1d50_4790_5825n before that.
    //
    // M1b Task 3b changed selection from Euclidean distance to A* path
    // length and this vector did NOT move, on either target. That is a
    // property of the scenario rather than of the change - one object
    // means there is nothing to rank - and it is written up as [L36]. The
    // wasm was rebuilt before this was re-run, per [L8]; skipping that
    // would have measured the previous artifact and proved nothing either
    // way.
    expect(bridge.worldHash()).toBe(0x2fc6_69ef_a725_4f2dn);
  });

  it('exposes the world hash as a bigint that tracks simulation state', () => {
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnObject(12, 1, 'fridge');
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
