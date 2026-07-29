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
    //
    // M1c Task 3 made selection a softmax-weighted draw rather than an
    // argmax, and this vector did NOT move on either target either. Same
    // reason as above and the same [L36]: one object means every agent
    // that has a candidate has exactly one, and a one-candidate draw has
    // one answer at every temperature and every seed. The wasm was
    // rebuilt before this was re-run.
    //
    // That is also what keeps this comparison meaningful now that
    // selection calls `exp`. `f32::exp` is a platform libm call with no
    // cross-target bit-identity guarantee, so a scenario with two live
    // candidates would put one inside the digest's causal chain and this
    // native-versus-wasm32 check could start disagreeing for a reason
    // that is not a regression. It computes `exp(0.0)` here, which is
    // exactly 1.0 everywhere. Adding a second object to this scenario
    // changes what it is exposed to.
    //
    // M1c Task 4 varied every interaction's length around its content
    // duration and put a 25-tick floor under it, and this vector did not
    // move on either target for a different reason again: **no agent
    // eats at all here.** The fridge is 30 tiles from the nearest agent
    // and movement covers 0.25 tiles a tick, so the first arrival is
    // around tick 121 and this runs to 100. Measured natively with a
    // probe over the 100 ticks; the wasm was rebuilt before this was
    // re-run. The scenario therefore covers decay, movement and the
    // digest, and nothing about how a sim chooses or how long it takes.
    //
    // **M1c Task 5 DID move it, and it is the first M1c change this
    // scenario could see.** [D-5] sends a sim with nothing worth doing
    // for a stroll rather than leaving it standing still, and seven of
    // these eight agents have nothing worth doing from tick one: the
    // single fridge is claimed by the lowest-indexed agent and every
    // other agent skips a reserved object, so its best score is nothing
    // at all. Those seven now wander, and fourteen of the sixteen
    // coordinates in this digest move on almost every tick.
    //
    // It also means this comparison now covers the seeded PRNG for the
    // first time - a wander destination is drawn from it - so a
    // native/wasm32 divergence in the generator or in the draw order
    // would surface here rather than nowhere.
    //
    // Measured on wasm32, not copied from native ([L13]): the wasm was
    // rebuilt with `wasm-pack build crates/terri-wasm --target web
    // --out-dir ../../web/src/wasm` FIRST, this test was run against the
    // old constant, and the reported 6505796737909387835n was read off
    // the failure. It equals the native value, which is a measurement
    // each time rather than a guarantee.
    //
    // Previous value: 0x2fc6_69ef_a725_4f2dn (Task 7's content-driven
    // decay, unmoved by M1b Task 3b and by M1c Tasks 3 and 4).
    expect(bridge.worldHash()).toBe(0x5a49_3ba9_f7fb_f23bn);
  });

  // ---- Player commands -------------------------------------------------
  //
  // Everything below runs against the RELEASE wasm the page loads, which
  // is the only reason it is not redundant with the Rust twins in
  // crates/terri-wasm/src/lib.rs. Those run in a debug build of the rlib,
  // and [L12] is this project's recorded instance of a check that exists
  // in debug and is absent from what ships. A panic here would not be one
  // failed call: it traps the module for the life of the page, so from
  // the player's side the whole game freezes with no recovery short of a
  // reload.

  it('rejects malformed command bytes without trapping the wasm module', () => {
    // **The mutation this is written against is `unwrap` on the decode.**
    // It compiles, it ships, and it survives `--release`, which is what
    // makes it worse than a `debug_assert!` rather than better.
    //
    // Six shapes, because they fail at different points in the decoder.
    // The last is a VALID command with junk after it: rejected rather
    // than silently accepted as its prefix, or the format is ambiguous
    // the day somebody concatenates two commands and expects both.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnAgent(1, 1, 80);

    const malformed: [string, number[]][] = [
      ['empty', []],
      ['variant index 4, one past the four that exist', [0x04, 0x00]],
      ['variant index 0xFF', [0xff]],
      ['Select with an Option tag and no payload', [0x00, 0x01]],
      ['UseObject missing its second field', [0x01, 0x03]],
      ['a valid SetSpeed(2) with junk after it', [0x03, 0x02, 0xaa, 0xbb]],
    ];
    for (const [what, bytes] of malformed) {
      expect(
        bridge.enqueueCommand(new Uint8Array(bytes)),
        `accepted ${what}`,
      ).toBe(false);
    }

    // The module is still alive, and these are what tell a returned
    // `false` apart from a trap: on a trapped instance every later call
    // throws instead of returning. A well-formed command after the six
    // bad ones is also the counterfactual - without it, an
    // `enqueue_command` that refused everything would pass every
    // assertion above.
    expect(bridge.select(0)).toBe(true);
    bridge.tick();
    expect(bridge.selectedIndex()).toBe(0);
    expect(bridge.count).toBe(1);
  });

  it('carries a selection into the simulation and reads it back out', () => {
    // [D-5]'s round trip. Selection is simulation state, so the shell
    // asks for it with a command and reads the answer back rather than
    // remembering it - a cached copy here is exactly what makes a
    // simulation unreplayable without its UI.
    //
    // TWO sims, because "reports the only agent" and "reports the first
    // agent" both satisfy a one-agent fixture.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnAgent(1, 1, 80);
    bridge.spawnAgent(3, 1, 80);
    expect(bridge.selectedIndex()).toBe(null);

    expect(bridge.select(1)).toBe(true);
    // Staged, not applied: JavaScript never mutates the world ([D-2]).
    expect(bridge.selectedIndex()).toBe(null);
    bridge.tick();
    expect(bridge.selectedIndex()).toBe(1);

    expect(bridge.select(0)).toBe(true);
    bridge.tick();
    expect(bridge.selectedIndex()).toBe(0);

    // `null` is a different command from a stale index, not a sentinel
    // for one: only this clears.
    expect(bridge.select(null)).toBe(true);
    bridge.tick();
    expect(bridge.selectedIndex()).toBe(null);
  });

  it('encodes an entity index above 127 as a multi-byte varint', () => {
    // **The only real encoding logic on this side, and the one mutation
    // that would look like working code**: an encoder that pushed the
    // index as a single byte is correct for every index below 128 and
    // silently wrong above it. 130 & 0x7f is 2, so a truncating encoder
    // does not fail - it selects a different sim, which reads as a
    // picking bug and would be looked for in the isometric maths.
    //
    // 130 rather than 128, so an off-by-one in the continuation
    // threshold is visible too.
    const bridge = new SimBridge(new SimHandle(64, 64), wasmMemory);
    for (let i = 0; i < 200; i++) bridge.spawnAgent(1 + (i % 60), 1, 80);
    expect(bridge.count).toBe(200);

    expect(bridge.select(130)).toBe(true);
    bridge.tick();
    expect(bridge.selectedIndex()).toBe(130);
  });

  it('directs a sim at an object, overriding what it chose for itself', () => {
    // [D-3] through the boundary. The sim is hungry and the two objects
    // advertise different needs, so autonomy has an unambiguous
    // preference for the fridge; directing it at the BED is therefore an
    // instruction it would never have given itself. A command that
    // agrees with autonomy proves nothing ([L36]).
    const build = () => {
      const b = new SimBridge(new SimHandle(16, 16), wasmMemory);
      expect(b.spawnObject(2, 8, 'bed')).toBe(true);
      expect(b.spawnObject(11, 8, 'fridge')).toBe(true);
      b.spawnAgent(8, 8, 20);
      return b;
    };

    // What the sim does when nothing tells it otherwise, measured rather
    // than assumed - without it the assertions below could be describing
    // autonomy's own choice.
    const undirected = build();
    for (let i = 0; i < 20; i++) undirected.tick();
    const undirectedX = undirected.positions()[4];

    const bridge = build();
    expect(bridge.useObject(2, 0)).toBe(true);
    for (let i = 0; i < 20; i++) bridge.tick();
    const directedX = bridge.positions()[4];

    expect(directedX).toBeLessThan(8);
    expect(undirectedX).toBeGreaterThan(8);
    expect(bridge.worldHash()).not.toBe(undirected.worldHash());

    // And a cancel returns it to autonomy rather than freezing it.
    expect(bridge.cancelIntents(2)).toBe(true);
    bridge.tick();
    const afterCancel = bridge.positions()[4];
    for (let i = 0; i < 60; i++) bridge.tick();
    expect(bridge.positions()[4]).not.toBe(afterCancel);
  });

  it('reads a sim needs back out of the simulation, and nothing for anything else', () => {
    // The need-bar panel's whole input ([D-5]). An empty array is a
    // normal answer rather than an error: a deselected panel, a
    // just-despawned sim and a click that landed on a fridge all look
    // like this, and all three should draw no bars.
    //
    // The live sim is asserted non-empty in the same test, so "returns
    // empty" cannot be satisfied by an accessor that returns empty for
    // everything.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    expect(bridge.spawnObject(2, 2, 'fridge')).toBe(true);
    bridge.spawnAgent(1, 1, 37.5);

    const levels = bridge.needsOf(1);
    expect(levels.length).toBe(7);
    // Hunger is index 0 and is the only need spawnAgent sets; the other
    // six start satisfied. Both halves are asserted, so an array of one
    // value repeated seven times fails.
    expect(levels[0]).toBeCloseTo(37.5, 4);
    for (let i = 1; i < 7; i++) expect(levels[i]).toBeCloseTo(100, 4);

    expect(bridge.needsOf(0).length).toBe(0);
    expect(bridge.needsOf(9999).length).toBe(0);
    expect(bridge.needsOf(0xffffffff).length).toBe(0);
  });

  it('labels the need slots from the simulation, in the order it fills them', () => {
    // The panel puts name `i` on level `i`, so the two lists are a PAIR
    // and this is where the pairing crosses the boundary. A disagreement
    // between them draws seven correct numbers under seven wrong labels:
    // nothing errors, nothing looks broken, and every reading of the
    // panel is off by however far the lists have slipped. That is why
    // there is no list of seven strings in TypeScript to compare against
    // - a third copy would agree with `needNames` by construction and
    // say nothing about `needsOf`.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    const names = bridge.needNames();
    expect(names.length).toBe(7);
    expect(new Set(names).size).toBe(7);

    // `spawnAgent` sets HUNGER and leaves the other six satisfied, so the
    // levels themselves say which slot hunger is in. The label on that
    // slot has to be the one that says so.
    bridge.spawnAgent(1, 1, 12.5);
    const levels = bridge.needsOf(0);
    expect(levels.length).toBe(names.length);

    const dipped = levels.findIndex((level) => level < 100);
    expect(dipped).toBeGreaterThanOrEqual(0);
    expect(levels[dipped]).toBeCloseTo(12.5, 4);
    expect(names[dipped]).toBe('hunger');
  });

  it('reports the need ceiling and the refresh interval the content authors', () => {
    // Neither is a number the shell may invent. The ceiling is the
    // denominator every bar is drawn against, and the refresh interval is
    // `need_bar_refresh_ms` from `content/tuning.toml` - a knob somebody
    // tuning the game turns, which is why it is not a `const` in
    // TypeScript.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);

    // Behavioural rather than a literal 100: a need cannot exceed the
    // ceiling, which is the property the bars depend on. Feeding a sim
    // spawned at the top of the range must leave it there.
    const ceiling = bridge.needMax();
    expect(ceiling).toBeGreaterThan(0);
    bridge.spawnAgent(1, 1, ceiling * 10);
    expect(bridge.needsOf(0)[0]).toBeCloseTo(ceiling, 4);

    const refreshMs = bridge.needBarRefreshMs();
    expect(Number.isInteger(refreshMs)).toBe(true);
    // Zero would mean the panel reads every frame, which is the thing the
    // throttle exists to prevent; a value past a second means bars that
    // describe a decision already made.
    expect(refreshMs).toBeGreaterThan(0);
    expect(refreshMs).toBeLessThanOrEqual(1000);
  });

  it('refuses a command the wire format cannot express rather than coercing it', () => {
    // `value >>> 0` would turn -1 into 4294967295 and 3.7 into 3, so a
    // caller's mistake would arrive as a perfectly well-formed command
    // naming an entity it never meant - a click that selects the wrong
    // sim rather than one that visibly does nothing.
    //
    // The world digest is compared before and after, which is what makes
    // this a statement about the SIMULATION rather than about a return
    // value: a refusal that still queued something would move it.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnAgent(1, 1, 80);
    bridge.select(0);
    bridge.tick();
    const before = bridge.worldHash();

    expect(bridge.select(-1)).toBe(false);
    expect(bridge.select(3.7)).toBe(false);
    expect(bridge.select(2 ** 32)).toBe(false);
    expect(bridge.select(NaN)).toBe(false);
    expect(bridge.useObject(0, -5)).toBe(false);
    expect(bridge.cancelIntents(1.5)).toBe(false);
    expect(bridge.setSpeed(-1)).toBe(false);
    expect(bridge.setSpeed(256)).toBe(false);
    expect(bridge.setSpeed(1.5)).toBe(false);

    bridge.tick();
    // A tick with an empty queue still advances the clock, so compare
    // against a second run of the same length rather than against
    // `before` directly.
    const control = new SimBridge(new SimHandle(16, 16), wasmMemory);
    control.spawnAgent(1, 1, 80);
    control.select(0);
    control.tick();
    control.tick();
    expect(bridge.worldHash()).toBe(control.worldHash());
    expect(bridge.selectedIndex()).toBe(0);
    expect(before).not.toBe(0n);

    // And the well-formed edges of the same ranges are accepted, so the
    // rule cannot be "refuse everything" and pass.
    expect(bridge.setSpeed(0)).toBe(true);
    expect(bridge.setSpeed(255)).toBe(true);
    expect(bridge.select(0xffffffff)).toBe(true);
  });

  it('caps the staging queue so rapid clicking cannot grow it without bound', () => {
    // Nothing downstream bounds this queue. The per-sim intent cap is
    // only ever reached by a command that resolved to a live agent;
    // every Select, every SetSpeed and every command naming an index
    // that no longer exists lands here and touches no intent queue at
    // all. Nothing ticks until the end, which is also what a PAUSED game
    // looks like - the case where this queue does not drain at all.
    //
    // The cap is `max_queued_commands` in content/tuning.toml and is not
    // restated here: a literal would leave this green while silently no
    // longer testing the shipped value. What is asserted is the shape -
    // it stops, it stops somewhere sane, and draining makes room again.
    const bridge = new SimBridge(new SimHandle(16, 16), wasmMemory);
    bridge.spawnAgent(1, 1, 80);

    let accepted = 0;
    const attempts = 10000;
    for (let i = 0; i < attempts; i++) {
      if (bridge.select(0)) accepted++;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(attempts);

    // Not a latch on the handle: draining has to make room, or the game
    // would stop accepting input permanently after one burst.
    bridge.tick();
    expect(bridge.select(0)).toBe(true);
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
