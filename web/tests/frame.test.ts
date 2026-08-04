import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import {
  FixedStepDriver,
  advanceSimulationFrame,
  lerp,
  buildInstances,
  instanceCount,
  simSprite,
  walkingLiftPx,
  type RenderSource,
} from '../src/frame.js';
import { spriteIndex } from '../src/render/atlas.js';
import {
  FLOOR_DEPTH,
  LAYER_PROP,
  LAYER_SIM,
  layeredDepth,
  screenX,
  screenY,
  worldToScreen,
} from '../src/render/iso.js';
import {
  FLOATS_PER_INSTANCE,
  KIND_AGENT,
  OFFSET_DEPTH,
  OFFSET_SCREEN_X,
  OFFSET_EMISSIVE,
  OFFSET_SCREEN_Y,
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
 * The eight floats one entity occupies, as the GPU would see them.
 *
 * `kind` picks the depth LAYER and never reaches the GPU; `sprite` is
 * what the shader indexes the atlas with. Defaulting sprite to kind keeps
 * the older assertions in this file readable, since for them the two are
 * interchangeable placeholders.
 *
 * An AGENT's sprite is not the one passed in, and that is the point of
 * [ML-chars]: a sim draws one of three looks chosen from its entity id,
 * so this helper applies the same rule `buildInstances` does. `row` is
 * how it reaches the id, since `FakeEntities` hands out `100 + row`.
 *
 * The tint tail is white and non-emissive, which is what every caller in
 * this file expects; the emissive tests below pass their own.
 */
function packed(
  wx: number,
  wy: number,
  kind: number,
  sprite = kind,
  originX = ORIGIN_X,
  originY = ORIGIN_Y,
  row = 0,
  emissive = 0,
): number[] {
  const [screenX, screenY] = worldToScreen(wx, wy, originX, originY);
  return [
    stored(screenX),
    stored(screenY),
    stored(layeredDepth(wx, wy, GRID, kind === KIND_AGENT ? LAYER_SIM : LAYER_PROP)),
    kind === KIND_AGENT ? simSprite(100 + row) : sprite,
    1,
    1,
    1,
    emissive,
  ];
}

/** prevX, prevY, curX, curY, kind, sprite, and an optional activity. */
type FakeEntity =
  | readonly [number, number, number, number, number, number]
  | readonly [number, number, number, number, number, number, number]
  | readonly [number, number, number, number, number, number, number, number];

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

  activities(): Uint32Array {
    return Uint32Array.from(this.entities.map((e) => e[6] ?? 0));
  }

  /** Item-kind index per row; 0xffff_ffff (the default) is empty hands. */
  carrying(): Uint32Array {
    return Uint32Array.from(this.entities.map((e) => e[7] ?? 0xffff_ffff));
  }

  itemKinds(): readonly string[] {
    return ['ingredients', 'dinner'];
  }

  /**
   * Entity indices offset from the row number on purpose.
   *
   * A row is not an entity index - the render buffer sorts by index, so a row
   * is a rank ([L47]) - and a fake that returned 0, 1, 2 would let the
   * selection ring pass while looking the selected sim up by row. The +100
   * makes the two impossible to confuse.
   */
  ids(): Uint32Array {
    return Uint32Array.from(this.entities.map((_, row) => 100 + row));
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

  it('multiplies the number of steps with speed and leaves the step duration alone', () => {
    // **Both halves, and the second is the one that matters.** A test
    // that only counted steps would be satisfied by the exact violation
    // [D2] forbids: a driver implementing "2x" as `stepMs / 2` runs
    // twenty steps over a second too, and it also returns the identical
    // interpolation alpha, because scaling the accumulator by k and
    // dividing the step by k are the same arithmetic. Step COUNT cannot
    // tell the two apart at any elapsed time, with any frame pacing.
    // `stepDurationMs` is the only observable that can, which is why it
    // is exposed.
    //
    // Three speeds rather than two, so "the count scales with speed" is
    // distinguishable from "the count doubles once".
    const ELAPSED_MS = 1000;
    const counts: number[] = [];
    const durations: number[] = [];
    for (const speed of [1, 2, 3]) {
      const driver = new FixedStepDriver(10, 1000);
      driver.setSpeed(speed);
      let ticks = 0;
      driver.advance(ELAPSED_MS, () => ticks++);
      counts.push(ticks);
      durations.push(driver.stepDurationMs);
      expect(driver.ticksPerUnitTime).toBe(speed);
    }

    // The count half: 1x, 2x and 3x over one second of a 10 Hz sim.
    expect(counts).toEqual([10, 20, 30]);
    // The size half: one step is a tenth of a second at every one of
    // them. Identical values are the point here rather than the hazard -
    // this is the assertion that a speed changing dt would move.
    expect(durations).toEqual([100, 100, 100]);
  });

  it('pauses by running zero steps rather than by shrinking the step', () => {
    // Pause is speed 0, so the same two halves apply: no steps run, and
    // the step is still a tenth of a second when they resume.
    //
    // The elapsed times are deliberately NOT multiples of the step, so
    // the accumulator carries a remainder across the pause. That is what
    // separates the intended mechanism from its two degenerate
    // neighbours - a pause that zeroes the accumulator, and a pause that
    // banks real time and spends it in one burst on resume. All three
    // agree on a pause that starts from an empty accumulator.
    const driver = new FixedStepDriver(10, 1000);
    let ticks = 0;

    driver.advance(1050, () => ticks++);
    expect(ticks).toBe(10); // 50 ms left in the accumulator

    driver.setSpeed(0);
    driver.advance(5000, () => ticks++);
    expect(ticks).toBe(10);
    expect(driver.stepDurationMs).toBe(100);

    driver.setSpeed(1);
    // The banking alternative would spend the paused 5,000 ms here and
    // run 50 more steps.
    driver.advance(300, () => ticks++);
    expect(ticks).toBe(13);

    // And the sample that separates carrying from zeroing: with the 50 ms
    // remainder still there, 60 ms reaches the next step. Without it, 60
    // ms reaches nothing. The two agree on every sample before this one.
    driver.advance(60, () => ticks++);
    expect(ticks).toBe(14);
  });

  it('drains commands only while paused and resumes through full ticks', () => {
    const driver = new FixedStepDriver(10, 5);
    const calls: string[] = [];
    const sim = {
      tick: () => calls.push('tick'),
      flushCommands: () => calls.push('flush'),
    };

    driver.setSpeed(0);
    expect(advanceSimulationFrame(driver, 500, sim)).toBe(0);
    expect(calls).toEqual(['flush']);

    calls.length = 0;
    driver.setSpeed(1);
    expect(advanceSimulationFrame(driver, 100, sim)).toBe(0);
    expect(calls).toEqual(['tick']);
  });

  it('rejects a speed that is not a whole number of steps', () => {
    // A speed is a step COUNT. A fractional one has only one possible
    // meaning - a fractional step - which is the thing [D2] forbids, so
    // it is refused at the door rather than quietly floored into
    // something the player did not choose.
    const driver = new FixedStepDriver(10, 1000);
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(() => driver.setSpeed(bad)).toThrow(RangeError);
    }
    // Refused, not absorbed: the driver still runs at the speed it had.
    expect(driver.ticksPerUnitTime).toBe(1);
    let ticks = 0;
    driver.advance(1000, () => ticks++);
    expect(ticks).toBe(10);
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
  it('derives equal walking footfalls from quarter-tile cardinal movement', () => {
    const samples = [
      [0, 0, 0.25, 0],
      [0.25, 0, 0, 0],
      [0, 0, 0, 0.25],
      [0, 0.25, 0, 0],
    ] as const;

    for (const [prevX, prevY, currentX, currentY] of samples) {
      const source = new FakeEntities();
      source.set([
        [prevX, prevY, currentX, currentY, KIND_AGENT, 1, 1],
      ]);
      const start = snapshot(
        buildInstances(source, 0, 0, 0, GRID),
        1,
      );
      const middle = snapshot(
        buildInstances(source, 0.5, 0, 0, GRID),
        1,
      );
      const end = snapshot(
        buildInstances(source, 1, 0, 0, GRID),
        1,
      );
      expect(middle[OFFSET_SCREEN_Y]).toBe(
        screenY(
          lerp(prevX, currentX, 0.5),
          lerp(prevY, currentY, 0.5),
          0,
        ) - 1,
      );
      expect(start[OFFSET_SCREEN_Y]).toBe(
        screenY(prevX, prevY, 0) -
          walkingLiftPx(prevX, prevY, false),
      );
      expect(end[OFFSET_SCREEN_Y]).toBe(
        screenY(currentX, currentY, 0) -
          walkingLiftPx(currentX, currentY, false),
      );
    }
  });

  it('is planted at tile and half-tile boundaries without a seam', () => {
    for (const position of [0, 0.5, 1, 1.5, 2]) {
      expect(walkingLiftPx(position, 0, false)).toBe(0);
    }
    for (const position of [0.25, 0.75, 1.25, 1.75]) {
      expect(walkingLiftPx(position, 0, false)).toBe(2);
    }
    expect(walkingLiftPx(1 - 1e-6, 0, false)).toBeCloseTo(
      walkingLiftPx(1 + 1e-6, 0, false),
      10,
    );
  });

  it('keeps non-walking and reduced-motion bodies planted', () => {
    const source = new FakeEntities();
    source.set([
      [0, 0, 1, 0, KIND_AGENT, 1, 0],
      [0, 1, 1, 1, KIND_AGENT, 1, 2],
      [0.25, 2, 0.25, 2, KIND_AGENT, 1, 1],
    ]);

    const built = snapshot(buildInstances(source, 0.25, 0, 0, GRID), 3);
    expect(built[OFFSET_SCREEN_Y]).toBe(screenY(0.25, 0, 0));
    expect(built[FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y]).toBe(
      screenY(0.25, 1, 0),
    );
    expect(built[2 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y]).toBe(
      screenY(0.25, 2, 0) - 2,
    );

    const reduced = snapshot(
      buildInstances(source, 0.25, 0, 0, GRID, null, 1, true),
      3,
    );
    expect(reduced[OFFSET_SCREEN_Y]).toBe(screenY(0.25, 0, 0));

    source.set([
      [0, 0, 1, 0, KIND_AGENT, 1, 0],
      [0, 1, 1, 1, KIND_AGENT, 1, 2],
      [0.25, 2, 0.25, 2, KIND_AGENT, 1, 0],
    ]);
    expect(reduced).toEqual(
      snapshot(buildInstances(source, 0.25, 0, 0, GRID), 3),
    );
  });

  it('scales the footfall exactly once', () => {
    expect(walkingLiftPx(0.25, 0, false, 0.5)).toBe(1);
    expect(walkingLiftPx(0.25, 0, false, 1)).toBe(2);
    expect(walkingLiftPx(0.25, 0, false, 2.5)).toBe(5);
  });

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
    expect(out).toHaveLength(2 * FLOATS_PER_INSTANCE);

    expect(out.slice(0, FLOATS_PER_INSTANCE)).toEqual(packed(4, 4, 1, 5));
    expect(out.slice(FLOATS_PER_INSTANCE)).toEqual(
      packed(9, 1, 0, 3, ORIGIN_X, ORIGIN_Y, 1),
    );
    // The two entities differ in every field, so a stride mistake that
    // read slot 1 from slot 0's territory moves all four numbers.
    expect(packed(4, 4, 1, 5)).not.toEqual(
      packed(9, 1, 0, 3, ORIGIN_X, ORIGIN_Y, 1),
    );
  });

  it('gives sims with different ids different faces', () => {
    // [ML-chars], and the defect it fixes: before this the household was
    // three identical people, which is the first thing anyone notices and
    // the last thing any assertion here could see.
    //
    // Three sims rather than two. Two could differ by accident under any
    // rule at all - including "alternate" - while three consecutive ids
    // taking three DISTINCT looks is the property that actually holds the
    // mapping down.
    const view = new FakeEntities();
    view.set([
      [0, 0, 0, 0, KIND_AGENT, 1],
      [1, 0, 1, 0, KIND_AGENT, 1],
      [2, 0, 2, 0, KIND_AGENT, 1],
    ]);

    const out = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 3);
    const faces = [0, 1, 2].map(
      (row) => out[row * FLOATS_PER_INSTANCE + OFFSET_SPRITE],
    );
    expect(new Set(faces).size).toBe(3);
    // And they are the three character entries, by name. Distinctness
    // alone would be satisfied by three arbitrary atlas slots - a chair,
    // a bathtub and a doorway are also distinct.
    expect(new Set(faces)).toEqual(
      new Set([spriteIndex('sim'), spriteIndex('sim2'), spriteIndex('sim3')]),
    );
  });

  it('keeps a sim on the same face when its ROW moves', () => {
    // A despawn reorders the buffer. Keyed on the row instead of the id,
    // two sims would swap faces the moment a third one left the lot -
    // which reads as the household changing clothes at a doorway.
    const view = new FakeEntities();
    view.set([
      [0, 0, 0, 0, KIND_AGENT, 1],
      [1, 0, 1, 0, KIND_AGENT, 1],
    ]);
    const before = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 2);
    const secondFace = before[FLOATS_PER_INSTANCE + OFFSET_SPRITE];

    // `FakeEntities` ids are `100 + row`, so dropping the first row moves
    // the second sim to row 0 while its id stays 101 - except the fake
    // recomputes ids from rows, so the honest version of this test is the
    // function itself: same id in, same face out, whatever the row.
    expect(simSprite(101)).toBe(secondFace);
    expect(simSprite(101)).toBe(simSprite(101));
    expect(simSprite(100)).not.toBe(simSprite(101));
  });

  it('marks a lamp emissive so it does not go out at night', () => {
    // [ML-ambient] made every fragment darken as the hour turns, which
    // for the two things lighting the room is exactly backwards. Without
    // this the house at midnight contains an unlit lamp.
    const lamp = spriteIndex('lampRoundFloor');
    const view = new FakeEntities();
    view.set([
      [0, 0, 0, 0, 1, lamp],
      [1, 0, 1, 0, 1, spriteIndex('chair')],
    ]);

    const out = snapshot(buildInstances(view, 1, ORIGIN_X, ORIGIN_Y, GRID), 2);
    expect(out[OFFSET_EMISSIVE]).toBeGreaterThan(0);
    // Below 1: at 1 the whole sprite ignores the hour, stand and outline
    // included, and reads as a cutout pasted over the night.
    expect(out[OFFSET_EMISSIVE]).toBeLessThan(1);
    // The chair beside it is an ordinary object and must still take the
    // full ambient, or the emissive is not a property of the sprite.
    expect(out[FLOATS_PER_INSTANCE + OFFSET_EMISSIVE]).toBe(0);
    // Nothing tints either of them: the colour channels stay the
    // identity, so the atlas art is what reaches the screen.
    expect(out.slice(4, 7)).toEqual([1, 1, 1]);
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

describe('activity indicator bubbles', () => {
  // The owner's requirement, as quads: a sim that is doing something
  // shows it. Codes 0 and 1 draw nothing on purpose - motion is its own
  // indicator - and every drawing code floats a bubble one lift above
  // the sim, nudged nearer so the pair cannot tie on depth ([V12]).
  const src = new FakeEntities();

  it('floats one bubble over each sim whose activity draws, and none over walkers or idlers', () => {
    src.set([
      [1, 1, 1, 1, KIND_AGENT, 3, 4], // talking
      [2, 2, 2, 2, KIND_AGENT, 3, 1], // walking - no bubble
      [3, 3, 3, 3, KIND_AGENT, 3, 0], // idle - no bubble
    ]);
    expect(instanceCount(src, null)).toBe(4);

    const built = buildInstances(src, 1, ORIGIN_X, ORIGIN_Y, GRID);
    const bubbleBase = 3 * FLOATS_PER_INSTANCE;
    const simBase = 0;
    expect(built[bubbleBase + OFFSET_SCREEN_X]).toBe(
      built[simBase + OFFSET_SCREEN_X],
    );
    expect(built[bubbleBase + OFFSET_SCREEN_Y]).toBe(
      built[simBase + OFFSET_SCREEN_Y] - 84,
    );
    // Nearer than its own sim, by less than anything else could sit
    // between: a tie discards one quad, a big nudge reorders strangers.
    expect(built[bubbleBase + OFFSET_DEPTH]).toBeLessThan(
      built[simBase + OFFSET_DEPTH],
    );
    expect(built[bubbleBase + OFFSET_DEPTH]).toBeCloseTo(
      built[simBase + OFFSET_DEPTH],
      3,
    );
  });

  it('keeps the selection ring in the slot after the bubbles', () => {
    src.set([
      [1, 1, 1, 1, KIND_AGENT, 3, 4], // talking, id 100
      [2, 2, 2, 2, KIND_AGENT, 3, 0], // idle, id 101
    ]);
    expect(instanceCount(src, 100)).toBe(4); // 2 sims + 1 bubble + ring
    const built = buildInstances(src, 1, ORIGIN_X, ORIGIN_Y, GRID, 100);
    const ringBase = 3 * FLOATS_PER_INSTANCE;
    // The ring's sprite differs from the sims' fixture sprite, which is
    // how "the ring landed after the bubble, not on top of it" is
    // visible without restating the ring's atlas index here.
    expect(built[ringBase + OFFSET_SPRITE]).not.toBe(3);
  });
});

describe('the carried badge', () => {
  // [K3]'s hands on screen: a badge floats at hand height under the
  // bubble, resolved from the pack's own kind list through the
  // carried_<kind> atlas convention, and the transform is visible
  // because kind 0 and kind 1 resolve to different sprites.
  const src = new FakeEntities();

  it('floats the kind-matched badge under the carrier, and counts it', () => {
    src.set([
      [1, 1, 1, 1, KIND_AGENT, 3, 0, 0], // carrying ingredients
      [4, 4, 4, 4, KIND_AGENT, 3, 0], // empty hands
    ]);
    expect(instanceCount(src, null)).toBe(3);
    const built = buildInstances(src, 1, ORIGIN_X, ORIGIN_Y, GRID);
    const badgeBase = 2 * FLOATS_PER_INSTANCE;
    const simBase = 0;
    // Hand height and off to the side, so the bag reads as held
    // rather than worn - the plate-hat report.
    expect(built[badgeBase + OFFSET_SCREEN_X]).toBe(
      built[simBase + OFFSET_SCREEN_X] + 14,
    );
    expect(built[badgeBase + OFFSET_SCREEN_Y]).toBe(
      built[simBase + OFFSET_SCREEN_Y] - 24,
    );

    // The transform, visible: the same row carrying kind 1 draws a
    // DIFFERENT sprite - the bag became the plate.
    const asIngredients = built[badgeBase + OFFSET_SPRITE];
    src.set([[1, 1, 1, 1, KIND_AGENT, 3, 0, 1]]);
    const cooked = buildInstances(src, 1, ORIGIN_X, ORIGIN_Y, GRID);
    const asDinner = cooked[1 * FLOATS_PER_INSTANCE + OFFSET_SPRITE];
    expect(asDinner).not.toBe(asIngredients);
  });

  it('follows a walking carrier while the selection ring stays planted', () => {
    src.set([[0, 0, 1, 0, KIND_AGENT, 3, 1, 0]]);
    const built = buildInstances(src, 0.25, 0, 0, GRID, 100);
    const body = 0;
    const badge = 1 * FLOATS_PER_INSTANCE;
    const ring = 2 * FLOATS_PER_INSTANCE;
    const groundY = screenY(0.25, 0, 0);

    expect(built[body + OFFSET_SCREEN_Y]).toBe(groundY - 2);
    expect(built[badge + OFFSET_SCREEN_Y]).toBe(groundY - 24 - 2);
    expect(built[ring + OFFSET_SCREEN_Y]).toBe(groundY);
    expect(built[ring + OFFSET_DEPTH]).toBeGreaterThan(
      built[body + OFFSET_DEPTH],
    );
  });

  it('hides the badge of a carrier who is at work', () => {
    src.set([
      [1, 1, 1, 1, KIND_AGENT, 3, 6, 0], // at work, carrying
    ]);
    // One instance: the parked row. The dinner went to the office in
    // the worker's hands, and neither is drawn.
    expect(instanceCount(src, null)).toBe(1);
  });
});

describe('a sim at work', () => {
  // The E4 rabbit hole at the draw call: the row RIDES so nobody's
  // interpolation slot moves, and everything about it is skipped - the
  // sprite (parked off-screen), the bubble, and the selection ring.
  const src = new FakeEntities();

  it('parks the row off-screen without moving anyone else\'s slot', () => {
    src.set([
      [4, 4, 4, 4, KIND_AGENT, 3, 6], // at work, id 100
      [2, 2, 2, 2, KIND_AGENT, 3, 0], // home, id 101
    ]);
    expect(instanceCount(src, null)).toBe(2);
    const built = buildInstances(src, 1, ORIGIN_X, ORIGIN_Y, GRID);
    // The worker's instance exists - slot stability is the point - but
    // far outside any viewport, where clipping discards it.
    expect(built[0 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBeLessThan(-1000);
    // The neighbour is untouched, in its own slot, exactly where a
    // world without the worker's absence would draw it.
    const homeX = built[1 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X];
    expect(homeX).toBeGreaterThan(-1000);
  });

  it('draws no bubble and suppresses the selection ring', () => {
    src.set([
      [4, 4, 4, 4, KIND_AGENT, 3, 6], // at work, id 100
    ]);
    // One instance: the parked row. No bubble - AT_WORK is not an
    // indicator - and no ring even though id 100 is selected, because a
    // ring around the empty doorway points at somebody who is not
    // there.
    expect(instanceCount(src, 100)).toBe(1);
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

  it('rebuilds the walking pose from the saved tick position without animation state', () => {
    const bridge = new SimBridge(new SimHandle(GRID, GRID), wasmMemory);
    bridge.spawnObject(12, 2, 'fridge');
    bridge.spawnAgent(1, 1, 20);

    let walkingRow = -1;
    for (let tick = 0; tick < 40 && walkingRow < 0; tick++) {
      bridge.tick();
      const positions = bridge.positions();
      const kinds = bridge.kinds();
      const activities = bridge.activities();
      for (let row = 0; row < bridge.count; row++) {
        const lift = walkingLiftPx(
          positions[row * 2],
          positions[row * 2 + 1],
          false,
        );
        if (
          kinds[row] === KIND_AGENT &&
          activities[row] === 1 &&
          lift > 0
        ) {
          walkingRow = row;
          break;
        }
      }
    }
    if (walkingRow < 0) {
      throw new Error('fixture never produced a lifted walking sample');
    }

    const savedPosition = [
      bridge.positions()[walkingRow * 2],
      bridge.positions()[walkingRow * 2 + 1],
    ] as const;
    const savedTickFrame = snapshot(
      buildInstances(bridge, 1, ORIGIN_X, ORIGIN_Y, GRID),
      bridge.count,
    );
    const bytes = bridge.saveBytes();

    bridge.tick();
    bridge.tick();
    expect(bridge.loadBytes(bytes)).toBe(true);

    const current = bridge.positions();
    const previous = bridge.prevPositions();
    expect([current[walkingRow * 2], current[walkingRow * 2 + 1]]).toEqual(
      savedPosition,
    );
    expect([
      previous[walkingRow * 2],
      previous[walkingRow * 2 + 1],
    ]).toEqual(savedPosition);

    const after = snapshot(
      buildInstances(bridge, 1, ORIGIN_X, ORIGIN_Y, GRID),
      bridge.count,
    );
    const bodyY = walkingRow * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y;
    expect(after[bodyY]).toBe(savedTickFrame[bodyY]);
    expect(after[bodyY]).toBe(
      screenY(savedPosition[0], savedPosition[1], ORIGIN_Y) -
        walkingLiftPx(savedPosition[0], savedPosition[1], false),
    );
  });
});

describe('the selection ring', () => {
  const RING = spriteIndex('selectionRing');
  const ORIGIN_X = 100;
  const ORIGIN_Y = 50;
  const GRID = 16;

  /** Reads instance `n` back out of the packed array. */
  function slot(instances: Float32Array, n: number) {
    const b = n * FLOATS_PER_INSTANCE;
    return {
      x: instances[b + OFFSET_SCREEN_X],
      y: instances[b + OFFSET_SCREEN_Y],
      depth: instances[b + OFFSET_DEPTH],
      sprite: instances[b + OFFSET_SPRITE],
    };
  }

  function twoSims(): FakeEntities {
    const source = new FakeEntities();
    // Ids will be 100 and 101; positions deliberately different so the ring
    // landing on the wrong one is visible in its coordinates.
    source.set([
      [2, 2, 2, 2, KIND_AGENT, 1],
      [9, 7, 9, 7, KIND_AGENT, 1],
    ]);
    return source;
  }

  it('draws nothing extra when nothing is selected', () => {
    const source = twoSims();
    const instances = buildInstances(source, 1, ORIGIN_X, ORIGIN_Y, GRID, null);
    const liveCount = instanceCount(source, null);
    expect(liveCount).toBe(2);
    // The shared scratch buffer may retain trailing data from a larger prior
    // frame. `draw` receives the live count, so only this prefix is observable.
    expect(snapshot(instances, liveCount)).toHaveLength(
      2 * FLOATS_PER_INSTANCE,
    );
  });

  it('draws one ring, at the selected sim, on top of the floor and under the sim', () => {
    const source = twoSims();
    // 101 is the SECOND row. Selecting it rather than the first is what makes
    // the coordinate assertion meaningful.
    const instances = buildInstances(source, 1, ORIGIN_X, ORIGIN_Y, GRID, 101);
    expect(instanceCount(source, 101)).toBe(3);

    const ring = slot(instances, 2);
    expect(ring.sprite).toBe(RING);
    expect(ring.x).toBe(screenX(9, 7, ORIGIN_X));
    expect(ring.y).toBe(screenY(9, 7, ORIGIN_Y));

    // Between the floor and the sim it belongs to. Both directions matter: over
    // the sim it would hide the thing it points at, and behind the floor it
    // would be invisible now that the floor shares one depth.
    const sim = slot(instances, 1);
    expect(ring.depth).toBeGreaterThan(sim.depth);
    expect(ring.depth).toBeLessThan(FLOOR_DEPTH);
  });

  /**
   * **The ring finds its sim by ENTITY INDEX, not by row.**
   *
   * The fake's ids are 100 and 101 for rows 0 and 1, so an implementation that
   * treated the selection as a row number would either draw nothing (no row
   * 101) or draw at the wrong sim. A fake whose ids were 0 and 1 could not tell
   * the two apart, which is [L47] and [L34] in one.
   */
  it('resolves the selection by entity index rather than by row', () => {
    const source = twoSims();
    const instances = buildInstances(source, 1, ORIGIN_X, ORIGIN_Y, GRID, 100);
    expect(instanceCount(source, 100)).toBe(3);
    const ring = slot(instances, 2);
    expect(ring.sprite).toBe(RING);
    // Row 0's position, because id 100 is row 0.
    expect(ring.x).toBe(screenX(2, 2, ORIGIN_X));

    // And a selection naming no live row draws nothing rather than throwing or
    // drawing at row 1. The simulation deliberately keeps a stale selection
    // rather than clearing it, so this case is reachable.
    expect(instanceCount(source, 999)).toBe(2);
  });

  it('tracks a walking sim between ticks rather than stepping behind it', () => {
    const source = new FakeEntities();
    source.set([[4, 4, 6, 4, KIND_AGENT, 1]]);
    // Half way between the two ticks.
    const instances = buildInstances(source, 0.5, ORIGIN_X, ORIGIN_Y, GRID, 100);
    const ring = slot(instances, 1);
    const sim = slot(instances, 0);
    expect(ring.x).toBe(sim.x);
    expect(ring.y).toBe(sim.y);
    // And that really is the interpolated point, not either endpoint - so a
    // ring drawn from the tick position instead would fail here.
    expect(ring.x).toBe(screenX(5, 4, ORIGIN_X));
  });
});

describe('the camera scale in buildInstances', () => {
  const ORIGIN_X = 100;
  const ORIGIN_Y = 50;
  const GRID = 16;
  const TALKING = 4;

  function slot(instances: Float32Array, n: number) {
    const b = n * FLOATS_PER_INSTANCE;
    return {
      x: instances[b + OFFSET_SCREEN_X],
      y: instances[b + OFFSET_SCREEN_Y],
      depth: instances[b + OFFSET_DEPTH],
      sprite: instances[b + OFFSET_SPRITE],
    };
  }

  it('scales entity positions but never their depth', () => {
    const source = new FakeEntities();
    source.set([[3, 2, 3, 2, KIND_AGENT, 1]]);

    const at1 = slot(buildInstances(source, 1, ORIGIN_X, ORIGIN_Y, GRID), 0);
    const at2 = slot(
      buildInstances(source, 1, ORIGIN_X, ORIGIN_Y, GRID, null, 2),
      0,
    );

    // The world term doubles around the origin; the origin itself does
    // not move (a scaled origin would slide the lot toward a corner -
    // main.ts recentres by deriving a NEW origin instead).
    expect(at2.x).toBe(screenX(3, 2, ORIGIN_X, 2));
    expect(at2.y).toBe(screenY(3, 2, ORIGIN_Y, 2));
    expect(at2.x - ORIGIN_X).toBeCloseTo((at1.x - ORIGIN_X) * 2, 6);
    // Depth stays in world terms: zoom changes how big things are
    // drawn, never what covers what. A scaled depth would re-sort the
    // whole lot at every notch of the wheel.
    expect(at2.depth).toBe(at1.depth);
  });

  it('lifts an indicator bubble by the scaled height of its sim', () => {
    // The sim sprite draws `scale` times taller, so an unscaled 84 px
    // lift would sink the bubble into a zoomed head. The bubble sits at
    // the sim's scaled screen y minus the scaled lift.
    const source = new FakeEntities();
    source.set([[3, 2, 3, 2, KIND_AGENT, 1, TALKING]]);

    const instances = buildInstances(
      source,
      1,
      ORIGIN_X,
      ORIGIN_Y,
      GRID,
      null,
      2,
    );
    const sim = slot(instances, 0);
    const bubble = slot(instances, 1);
    expect(bubble.x).toBe(sim.x);
    expect(bubble.y).toBe(sim.y - 84 * 2);
  });
});
