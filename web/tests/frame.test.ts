import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import {
  FixedStepDriver,
  lerp,
  buildInstances,
  type RenderSource,
} from '../src/frame.js';
import {
  LAYER_PROP,
  LAYER_SIM,
  layeredDepth,
  worldToScreen,
} from '../src/render/iso.js';
import {
  FLOATS_PER_INSTANCE,
  KIND_AGENT,
  OFFSET_DEPTH,
  OFFSET_SPRITE,
} from '../src/render/instances.js';

// The two mechanisms this file guards are [D2] - the simulation advances
// in whole ticks of identical duration, and only the *number* of ticks per
// frame varies - and the interpolation that hides the 10 Hz sim behind a
// 60+ Hz display. Both are the shape docs/testing-protocol.md rule 7 warns
// about: an invariant stated as a relation between successive samples,
// where a frozen or reset alternative agrees with the intended mechanism on
// the first N + 1 observations. Every test below that has that shape names
// its degenerate alternative and takes one more sample than the relation
// needs.

const ORIGIN_X = 100;
const ORIGIN_Y = 50;
const GRID = 16;

/**
 * Copies the live prefix of the instance array out of the scratch buffer.
 *
 * `buildInstances` returns a buffer it reuses, so a value captured from it
 * is invalidated by the next call; every assertion here compares copies.
 * `subarray` clamps rather than throwing, so a buffer that failed to grow
 * yields a short array and fails on length instead of reading `undefined`.
 */
function snapshot(instances: Float32Array, count: number): number[] {
  return Array.from(instances.subarray(0, count * FLOATS_PER_INSTANCE));
}

/**
 * Rounds an expectation to what the instance array can actually hold.
 *
 * The buffer is a `Float32Array` and `iso.ts` computes in JavaScript's
 * f64, so a depth of 0.8 is stored as 0.800000011920929. Rounding the
 * expectation keeps these assertions exact; `toBeCloseTo` would pass for
 * a depth that is wrong by more than a rounding step, which for a value
 * whose whole job is ordering is not a tolerance worth granting.
 */
function stored(value: number): number {
  return Math.fround(value);
}

/**
 * The four floats one entity occupies, as the GPU would see them.
 *
 * `kind` picks the depth LAYER and never reaches the GPU; `sprite` is
 * what the shader indexes the atlas with. Defaulting sprite to kind keeps
 * the older assertions in this file readable, since for them the two are
 * interchangeable placeholders.
 */
function packed(
  wx: number,
  wy: number,
  kind: number,
  sprite = kind,
  originX = ORIGIN_X,
  originY = ORIGIN_Y,
): number[] {
  const [screenX, screenY] = worldToScreen(wx, wy, originX, originY);
  return [
    stored(screenX),
    stored(screenY),
    stored(layeredDepth(wx, wy, GRID, kind === KIND_AGENT ? LAYER_SIM : LAYER_PROP)),
    sprite,
  ];
}

/** prevX, prevY, curX, curY, kind, sprite. */
type FakeEntity = readonly [number, number, number, number, number, number];

/**
 * A stand-in for `SimBridge` for the tests that do not need a real sim.
 *
 * Every accessor builds a **fresh** typed array from the current state.
 * That is the whole point: an implementation that hoisted the accessors
 * out of the frame loop, or cached the views across frames, would keep
 * reading whatever it was handed first, and these tests can then see it.
 * It mirrors the real hazard rather than inventing one - `positions_ptr()`
 * and `prev_positions_ptr()` trade values on *every* sync because
 * `sync_render_buffer` starts with a `std::mem::swap`, so a pointer read
 * one frame ago is already pointing at the other frame's data.
 */
class FakeEntities implements RenderSource {
  private entities: readonly FakeEntity[] = [];

  set(entities: readonly FakeEntity[]): void {
    this.entities = entities;
  }

  get count(): number {
    return this.entities.length;
  }

  positions(): Float32Array {
    return Float32Array.from(this.entities.flatMap((e) => [e[2], e[3]]));
  }

  prevPositions(): Float32Array {
    return Float32Array.from(this.entities.flatMap((e) => [e[0], e[1]]));
  }

  kinds(): Uint32Array {
    return Uint32Array.from(this.entities.map((e) => e[4]));
  }

  sprites(): Uint32Array {
    return Uint32Array.from(this.entities.map((e) => e[5]));
  }
}

describe('FixedStepDriver', () => {
  it('runs one tick per step at the configured rate, not at a fixed rate', () => {
    const tenHz = new FixedStepDriver(10, 5);
    let ticks = 0;
    tenHz.advance(100, () => ticks++);
    expect(ticks).toBe(1);

    // The second rate is the point. "One tick per 100 ms" is also what a
    // driver with a hardcoded 100 ms step does, so one rate cannot tell
    // `1000 / tickHz` from the constant it happens to equal here.
    const twentyHz = new FixedStepDriver(20, 5);
    let fastTicks = 0;
    twentyHz.advance(100, () => fastTicks++);
    expect(fastTicks).toBe(2);
  });

  it('accumulates partial frames instead of dropping them', () => {
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(60, () => ticks++);
    expect(ticks).toBe(0);
    driver.advance(60, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('carries the leftover remainder forward rather than resetting it', () => {
    // Two frames, because one cannot distinguish "the accumulator keeps
    // its remainder" from "the accumulator is zeroed after every frame".
    // Both predict 2 ticks and alpha 0.5 on frame one. They disagree on
    // frame two: carrying reaches the next step at +50 ms, zeroing does
    // not reach it at all.
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;

    expect(driver.advance(250, () => ticks++)).toBe(0.5);
    expect(ticks).toBe(2);

    expect(driver.advance(50, () => ticks++)).toBe(0);
    expect(ticks).toBe(3);
  });

  it('returns an interpolation alpha in [0, 1) as a fraction of one step', () => {
    const driver = new FixedStepDriver(10, 5);
    const alpha = driver.advance(150, () => {});
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    // 0.5, not 50: alpha is the accumulator divided by the step, and
    // returning the raw millisecond remainder would put every entity
    // dozens of tiles past its destination.
    expect(alpha).toBeCloseTo(0.5, 5);

    // Landing exactly on a step boundary is alpha 0, not alpha 1: the
    // tick has already run, so there is nothing of it left to interpolate.
    const onBoundary = new FixedStepDriver(10, 5);
    expect(onBoundary.advance(100, () => {})).toBe(0);
  });

  it('clamps runaway catch-up to avoid a death spiral', () => {
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(10_000, () => ticks++);
    expect(ticks).toBe(5);
  });

  it('discards the backlog it could not spend rather than carrying it', () => {
    // The clamp above is only half the mechanism, and the half that is
    // easy to leave out. A driver that clamps ticks but keeps the
    // unspent 9,500 ms in its accumulator runs the budget again next
    // frame, and the frame after, until the backlog drains - which is
    // exactly the death spiral the clamp exists to prevent, arriving one
    // frame later. One frame cannot tell the two apart; both predict 5
    // ticks. The second and third frames are where they diverge.
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(10_000, () => ticks++);
    expect(ticks).toBe(5);

    ticks = 0;
    expect(driver.advance(0, () => ticks++)).toBe(0);
    expect(ticks).toBe(0);

    driver.advance(100, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('spends the tick budget it was constructed with, not a fixed one', () => {
    const driver = new FixedStepDriver(10, 2);
    let ticks = 0;
    driver.advance(1000, () => ticks++);
    expect(ticks).toBe(2);
  });

  it('advances the same number of ticks however the elapsed time is chopped up', () => {
    // [D2] restated as something observable: simulated time is a function
    // of elapsed wall time alone, never of frame pacing. Two drivers see
    // the same total in very different frames and must land in the same
    // place - same tick count and same leftover alpha.
    //
    // The degenerate alternative is a driver that computes
    // `floor(delta / step)` per frame and throws the remainder away. It
    // gives 0 ticks for the steady pacing (20 ms frames never reach a
    // step) and something else for the irregular one, so the two counts
    // being equal *and* being 10 is what excludes it.
    const steady: number[] = new Array<number>(50).fill(20);
    const irregular = [
      7, 3, 45, 1, 99, 12, 88, 4, 33, 60, 15, 5, 71, 9, 40, 6, 55, 20, 30, 97,
      40,
    ];
    const total = (xs: readonly number[]): number =>
      xs.reduce((sum, x) => sum + x, 0);
    irregular.push(total(steady) - total(irregular));

    // Preconditions. Equal totals is the whole comparison, and no single
    // frame may be long enough to trip the 5-tick clamp, or this would be
    // measuring the clamp instead of the accumulator.
    expect(total(irregular)).toBe(total(steady));
    expect(Math.max(...irregular)).toBeLessThan(300);
    expect(irregular.length).not.toBe(steady.length);

    const run = (deltas: readonly number[]): [number, number] => {
      const driver = new FixedStepDriver(10, 5);
      let ticks = 0;
      let alpha = 0;
      for (const delta of deltas) alpha = driver.advance(delta, () => ticks++);
      return [ticks, alpha];
    };

    expect(run(steady)).toEqual([10, 0]);
    expect(run(irregular)).toEqual([10, 0]);
  });

  it('passes no timestep to the tick callback, so speed cannot vary dt', () => {
    // [D2] is load-bearing for the planned multiplayer: a variable dt
    // makes the simulation non-deterministic and takes lockstep with it.
    // Speed controls change how many ticks run per frame; nothing may
    // ever change what a tick is worth. The callback taking no argument
    // is the structural half of that guarantee, so it is pinned rather
    // than left to a comment - anyone adding a dt parameter has to delete
    // this test to do it.
    const driver = new FixedStepDriver(10, 5);
    const argCounts: number[] = [];
    driver.advance(350, (...args: unknown[]) => {
      argCounts.push(args.length);
    });
    expect(argCounts).toEqual([0, 0, 0]);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    // Asymmetric endpoints, so `a` and `b` cannot be swapped without
    // moving this, and a non-zero start excludes `b * t`.
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(lerp(6, 2, 0.25)).toBe(5);
  });
});

describe('buildInstances', () => {
  it('interpolates between the previous and current tick rather than snapping', () => {
    // Three alphas rather than two. Snapping to the current tick agrees
    // with the intended mechanism at alpha 1, snapping to the previous
    // one agrees at alpha 0, and a step function at the midpoint agrees
    // with both ends. Only the midpoint sample excludes all three.
    const view = new FakeEntities();
    view.set([[1, 2, 3, 6, 0, 7]]);

    const atStart = snapshot(
      buildInstances(view, 0, ORIGIN_X, ORIGIN_Y, GRID),
      1,
    );
    const atMiddle = snapshot(
      buildInstances(view, 0.5, ORIGIN_X, ORIGIN_Y, GRID),
      1,
    );
    const atEnd = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 1);

    expect(atStart).toEqual(packed(1, 2, 0, 7));
    expect(atMiddle).toEqual(packed(2, 4, 0, 7));
    expect(atEnd).toEqual(packed(3, 6, 0, 7));

    // Both world axes move, so interpolating only x - which the screen x
    // of an isometric projection would partly hide - shows up here.
    expect(atStart[1]).not.toBe(atMiddle[1]);
    expect(atMiddle[1]).not.toBe(atEnd[1]);
  });

  it('derives depth from the interpolated position, not from either endpoint', () => {
    // Depth decides what covers what. If it were computed from the
    // current tick while the position came from the interpolated one, an
    // entity would sort as though it were up to a whole tile ahead of
    // where it is drawn, which at 60 fps is a flicker rather than a
    // stable error.
    const view = new FakeEntities();
    view.set([[1, 2, 3, 6, 0, 7]]);

    const atMiddle = snapshot(
      buildInstances(view, 0.5, ORIGIN_X, ORIGIN_Y, GRID),
      1,
    );

    expect(atMiddle[OFFSET_DEPTH]).toBe(stored(layeredDepth(2, 4, GRID, LAYER_SIM)));
    // Preconditions: the three candidate depths really are different once
    // stored as f32, so the assertion above is discriminating rather than
    // decorative.
    expect(stored(layeredDepth(2, 4, GRID, LAYER_SIM))).not.toBe(
      stored(layeredDepth(3, 6, GRID, LAYER_SIM)),
    );
    expect(stored(layeredDepth(2, 4, GRID, LAYER_SIM))).not.toBe(
      stored(layeredDepth(1, 2, GRID, LAYER_SIM)),
    );
  });

  it('gives a sim on an object tile a strictly smaller depth than the object', () => {
    // The bug this pins, measured in [V12]: a sim that reaches the
    // fridge takes the fridge's world position, so both quads took the
    // same depth, and `depthCompare: 'less'` rejected whichever was
    // drawn second. The sim's 576 orange pixels were simply absent from
    // that frame. Watching it, the sim vanishes into the furniture,
    // which reads as an AI fault and is not one.
    //
    // Smaller wins the pixel - `sprites.ts` compares with 'less' against
    // a clear of 1.0, measured causally in [V3] - so the sim's depth
    // must be STRICTLY smaller. Equal is the bug.
    const view = new FakeEntities();
    view.set([
      [12, 10, 12, 10, 1, 4],
      [12, 10, 12, 10, KIND_AGENT, 1],
    ]);

    const out = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 2);
    const objectDepth = out[OFFSET_DEPTH];
    const simDepth = out[FLOATS_PER_INSTANCE + OFFSET_DEPTH];

    // The precondition that makes the comparison mean what it says: both
    // rows are on the same tile, so nothing but the layer can separate
    // them. Without this the two could differ because they are in
    // different places, which is not the invariant.
    expect(out[0]).toBe(out[FLOATS_PER_INSTANCE]);
    expect(out[1]).toBe(out[FLOATS_PER_INSTANCE + 1]);
    expect(simDepth).toBeLessThan(objectDepth);

    // And both are still inside the clip range. A depth outside [0, 1]
    // does not sort wrong, it drops the quad entirely, so a bias that
    // fixed the tie by leaving the range would trade one disappearance
    // for another.
    for (const depth of [simDepth, objectDepth]) {
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the layer bias smaller than one tile of separation', () => {
    // The other half of the same mechanism. A bias large enough to break
    // the tie is only correct if it is small enough not to reorder two
    // different tiles: a sim one tile FURTHER from the camera than an
    // object must still be drawn behind it, however much the sim's layer
    // is favoured. This is the assertion that stops someone "fixing" a
    // residual tie by enlarging DEPTH_LAYER_STEP until it does real harm.
    const view = new FakeEntities();
    view.set([
      [5, 5, 5, 5, 1, 4],
      [4, 5, 4, 5, KIND_AGENT, 1],
    ]);

    const out = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 2);
    expect(out[FLOATS_PER_INSTANCE + OFFSET_DEPTH]).toBeGreaterThan(
      out[OFFSET_DEPTH],
    );
  });

  it('carries the content-resolved sprite index rather than the kind', () => {
    // `kind` used to be what reached the GPU, which is why all eight
    // objects looked identical. It now picks the depth layer only, and
    // the sprite is a separate column that comes from content. Two rows
    // of the SAME kind with DIFFERENT sprites is the case that can tell
    // the two columns apart; a fixture where sprite happened to equal
    // kind could not ([L34]).
    const view = new FakeEntities();
    view.set([
      [1, 1, 1, 1, 1, 9],
      [2, 2, 2, 2, 1, 4],
    ]);

    const out = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 2);
    expect(out[OFFSET_SPRITE]).toBe(9);
    expect(out[FLOATS_PER_INSTANCE + OFFSET_SPRITE]).toBe(4);
  });

  it('packs each entity into its own slot with its own kind', () => {
    const view = new FakeEntities();
    view.set([
      [4, 4, 4, 4, 1, 5],
      [9, 1, 9, 1, 0, 3],
    ]);

    const out = snapshot(buildInstances(view, 0.5, ORIGIN_X, ORIGIN_Y, GRID), 2);
    expect(out).toHaveLength(8);

    expect(out.slice(0, 4)).toEqual(packed(4, 4, 1, 5));
    expect(out.slice(4, 8)).toEqual(packed(9, 1, 0, 3));
    // The two entities differ in every field, so a stride mistake that
    // read slot 1 from slot 0's territory moves all four numbers.
    expect(packed(4, 4, 1, 5)).not.toEqual(packed(9, 1, 0, 3));
  });

  it('re-reads the source on every call, because the pointers swap each tick', () => {
    // `positions_ptr()` and `prev_positions_ptr()` exchange values on
    // every sync, with no reallocation and no memory growth involved, so
    // a view hoisted out of the loop or cached across frames is reading
    // the other frame's data within one tick. Three frames rather than
    // two: caching on the first call and refreshing once then freezing
    // are different bugs, and the second frame alone cannot tell them
    // apart.
    const view = new FakeEntities();
    const readAtCurrent = (): number[] =>
      snapshot(buildInstances(view, 1, 0, 0, GRID), 1);

    view.set([[0, 0, 1, 0, 0, 2]]);
    const first = readAtCurrent();
    view.set([[1, 0, 2, 0, 0, 2]]);
    const second = readAtCurrent();
    view.set([[2, 0, 3, 0, 0, 2]]);
    const third = readAtCurrent();

    expect([first[0], first[1]]).toEqual(worldToScreen(1, 0, 0, 0));
    expect([second[0], second[1]]).toEqual(worldToScreen(2, 0, 0, 0));
    expect([third[0], third[1]]).toEqual(worldToScreen(3, 0, 0, 0));
  });

  it('reuses one scratch buffer across frames instead of allocating per frame', () => {
    // [D11], and Task 13 measures it. The warm-up call absorbs any growth
    // so the identity comparison is about reuse rather than about
    // capacity.
    const view = new FakeEntities();
    view.set([
      [1, 1, 2, 2, 0, 1],
      [5, 5, 5, 5, 1, 9],
    ]);
    buildInstances(view, 0, ORIGIN_X, ORIGIN_Y, GRID);

    const first = buildInstances(view, 0, ORIGIN_X, ORIGIN_Y, GRID);
    const beforeSecondFrame = snapshot(first, 2);
    const second = buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID);

    expect(second).toBe(first);
    // Reuse must not mean staleness: the same buffer has to hold new
    // numbers, or the entities would be frozen at the first frame.
    expect(snapshot(second, 2)).not.toEqual(beforeSecondFrame);
  });

  it('grows the scratch buffer and picks up the new count when entities spawn', () => {
    // Deliberately far past any earlier test's count, which makes both
    // failure modes deterministic rather than dependent on whatever the
    // shared buffer happened to hold: a builder that captured the count
    // once, and one that never grows, both leave the array too short and
    // `snapshot` returns fewer numbers than asked for.
    const view = new FakeEntities();
    view.set([[0, 0, 0, 0, 0, 1]]);
    buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID);

    const many = 6000;
    view.set(
      Array.from({ length: many }, (_, i): FakeEntity => {
        const x = i % GRID;
        const y = Math.floor(i / GRID) % GRID;
        return [x, y, x, y, i % 2, i % 5];
      }),
    );

    const out = buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID);
    expect(out.length).toBeGreaterThanOrEqual(many * FLOATS_PER_INSTANCE);

    const last = snapshot(out, many).slice(-FLOATS_PER_INSTANCE);
    const lastX = (many - 1) % GRID;
    const lastY = Math.floor((many - 1) / GRID) % GRID;
    expect(last).toEqual(packed(lastX, lastY, (many - 1) % 2, (many - 1) % 5));
  });
});

describe('buildInstances over a real SimBridge', () => {
  let wasmMemory: WebAssembly.Memory;

  beforeAll(async () => {
    const wasm = await init({
      module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm'),
    });
    wasmMemory = wasm.memory;
  });

  it('reproduces the previous tick at alpha 0 on two successive ticks', () => {
    // The end-to-end form, against the buffers that actually swap.
    //
    // Two ticks, not one, per [L11]: "prev lags by exactly one tick" and
    // "prev is frozen" agree on the first observation and disagree on the
    // second. If `prev_positions` ever froze, or if `buildInstances`
    // cached its views, alpha 0 would keep reproducing the *first*
    // sample instead of the immediately preceding one.
    //
    // Exact equality is legitimate here: `lerp(a, b, 0)` is
    // `a + (b - a) * 0`, which is exactly `a`, and both sides of each
    // comparison run the identical projection over identical inputs.
    const bridge = new SimBridge(new SimHandle(GRID, GRID), wasmMemory);
    bridge.spawnObject(12, 2, 'fridge');
    bridge.spawnAgent(1, 1, 20);
    for (let i = 0; i < 5; i++) bridge.tick();

    const at = (alpha: number): number[] =>
      snapshot(
        buildInstances(bridge, alpha, ORIGIN_X, ORIGIN_Y, GRID),
        bridge.count,
      );

    const current1 = at(1);
    bridge.tick();
    const previous2 = at(0);
    const current2 = at(1);
    bridge.tick();
    const previous3 = at(0);
    const current3 = at(1);

    // Preconditions: two entities, and the agent is genuinely moving, so
    // the comparisons below are between values that differ.
    expect(bridge.count).toBe(2);
    expect(current1).toHaveLength(2 * FLOATS_PER_INSTANCE);
    expect(current2).not.toEqual(current1);
    expect(current3).not.toEqual(current2);

    expect(previous2).toEqual(current1);
    expect(previous3).toEqual(current2);
  });
});
