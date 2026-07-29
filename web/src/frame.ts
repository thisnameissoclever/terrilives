/**
 * The frame loop's two halves: pacing the simulation, and turning the two
 * most recent simulation ticks into one frame's worth of GPU instances.
 *
 * Neither half touches a GPU or WASM directly, which is what makes both
 * testable in Node. `main.ts` is the thin wiring that does.
 */

import {
  LAYER_PROP,
  LAYER_SIM,
  layeredDepth,
  screenX,
  screenY,
} from './render/iso.js';
import {
  FLOATS_PER_INSTANCE,
  KIND_AGENT,
  writeInstance,
  type InstanceArray,
} from './render/instances.js';

/** Linear interpolation. `t` of 0 gives `a` exactly, 1 gives `b` exactly. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Fixed-timestep accumulator. The simulation always advances in whole
 * ticks of identical duration; only the **number** of ticks per frame
 * varies.
 *
 * This is [D2], and it is what keeps the simulation deterministic. A
 * variable `dt` would make two machines fed the same inputs diverge, which
 * costs replays, the world hash, and the lockstep multiplayer Layer 2
 * plans on. Speed controls multiply ticks per frame; they never change the
 * tick duration, and `onTick` deliberately takes no argument so there is
 * no `dt` to hand them.
 */
export class FixedStepDriver {
  private accumulatorMs = 0;
  private readonly stepMs: number;

  /**
   * How many simulation steps one unit of real time buys. 0 is paused, 1
   * is real time, higher is faster.
   *
   * This is the ONLY thing a speed control may move. It is a count, and
   * `stepMs` beside it is a duration; nothing may ever make the second a
   * function of the first.
   */
  private speed = 1;

  constructor(
    tickHz: number,
    private readonly maxTicksPerFrame: number,
  ) {
    this.stepMs = 1000 / tickHz;
  }

  /**
   * How much simulated time one step covers, in milliseconds. Fixed at
   * construction, and **independent of speed**.
   *
   * It is exposed because otherwise the guarantee is unobservable. A test
   * that only counts steps cannot tell "twice as many steps of the same
   * size" from "the same steps at half the size": over any elapsed time
   * the two produce an identical step count AND an identical
   * interpolation alpha, because scaling the accumulator by `k` and
   * dividing `stepMs` by `k` are the same arithmetic. The count is
   * therefore half a test, and this getter is the other half - the one
   * assertion that separates [D2] from its violation.
   */
  get stepDurationMs(): number {
    return this.stepMs;
  }

  /** The current tick multiplier. 0 while paused. */
  get ticksPerUnitTime(): number {
    return this.speed;
  }

  /**
   * Sets the tick multiplier: 0 pauses, 1 is real time, 2 and 3 are
   * faster.
   *
   * **Pause is zero steps, not a smaller step**, and speed is a step
   * COUNT, not a step size. [D2] is the oldest constraint in the project
   * and everything downstream sits on it: a variable step size makes two
   * machines fed the same inputs diverge, which costs the world hash,
   * replays, and the lockstep multiplayer Layer 2 plans on.
   *
   * Rejects rather than clamps. Every caller is a fixed option list, so a
   * value that is not a non-negative integer is a programming mistake,
   * and a silently clamped one would be a game running at a speed nobody
   * chose.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isInteger(multiplier) || multiplier < 0) {
      throw new RangeError(
        `speed must be a non-negative integer, got ${multiplier}`,
      );
    }
    this.speed = multiplier;
  }

  /**
   * Runs every tick the elapsed time has paid for, then returns the
   * interpolation alpha in `[0, 1)`: how far the display is between the
   * tick that just ran and the one that has not yet.
   */
  advance(deltaMs: number, onTick: () => void): number {
    // The multiplier is applied to the ELAPSED TIME, which is what buys
    // steps, and never to `stepMs`, which is what a step costs. At speed
    // 2 a frame pays for twice as many steps of exactly the same size.
    //
    // At speed 0 this adds nothing, so the loop below runs no ticks and
    // the accumulator keeps whatever fraction of a step it was holding.
    // That is deliberate: a pause that BANKED real time would spend the
    // whole paused duration in one burst on resume, which is the sim
    // teleporting through however long the player was reading the bars.
    this.accumulatorMs += deltaMs * this.speed;

    let ticks = 0;
    while (this.accumulatorMs >= this.stepMs && ticks < this.maxTicksPerFrame) {
      onTick();
      this.accumulatorMs -= this.stepMs;
      ticks++;
    }

    // Clamping the tick count alone is only half a defence. A machine
    // that cannot keep up would still carry the unspent backlog into the
    // next frame, spend the budget again, fall further behind, and
    // spiral - the same failure arriving one frame later. Dropping the
    // backlog makes the sim skip time it could not simulate, which is
    // visible but recoverable.
    if (ticks >= this.maxTicksPerFrame) {
      this.accumulatorMs = 0;
    }

    return this.accumulatorMs / this.stepMs;
  }
}

/**
 * What `buildInstances` reads. `SimBridge` satisfies it structurally.
 *
 * Naming the subset rather than importing the class keeps the instance
 * builder testable without a WASM module, and keeps the render path
 * honest about what it depends on: three accessors and a count, all
 * re-read on every call.
 */
export interface RenderSource {
  readonly count: number;
  positions(): Float32Array;
  prevPositions(): Float32Array;
  /** 0 for a sim, 1 for a smart object. Picks the depth layer, nothing else. */
  kinds(): Uint32Array;
  /**
   * Index into the sprite atlas, one per entity.
   *
   * It comes from the simulation because it comes from **content**: an
   * object's `sprite` field is resolved against the atlas manifest when
   * the content pack is compiled. Deriving it here from the entity's kind
   * or id would put a second copy of the object list in TypeScript, which
   * is exactly the coupling [D1] exists to prevent.
   */
  sprites(): Uint32Array;
}

/**
 * The one instance array, reused for the life of the page.
 *
 * Per [D11] the render loop allocates nothing per frame and builds no
 * per-entity objects; Task 13 measures that. Module scope rather than a
 * field because `buildInstances` is a free function per the plan's
 * interface, which does mean the buffer is shared by every caller in the
 * module - fine for one renderer, and the returned array is only valid
 * until the next call either way.
 */
let scratch: InstanceArray = new Float32Array(0);

/**
 * Builds one frame of GPU instances by interpolating between the previous
 * and the current simulation tick.
 *
 * The sim runs at 10 Hz and the display at 60+, so without this every
 * entity would jump six frames' worth of distance ten times a second.
 * `alpha` comes from `FixedStepDriver.advance`.
 *
 * Returns the shared scratch buffer, which is longer than the live entity
 * count once entities have despawned; callers pass `count` to `draw`
 * separately and the trailing slots are never read.
 */
export function buildInstances(
  source: RenderSource,
  alpha: number,
  originX: number,
  originY: number,
  gridSize: number,
): InstanceArray {
  const count = source.count;
  const needed = count * FLOATS_PER_INSTANCE;
  if (scratch.length < needed) {
    scratch = new Float32Array(needed);
  }

  // Read every frame, never hoisted or cached. `positions_ptr()` and
  // `prev_positions_ptr()` trade values on every sync because
  // `sync_render_buffer` starts with a `std::mem::swap`, and memory
  // growth detaches the ArrayBuffer underneath both. See bridge.ts.
  const current = source.positions();
  const previous = source.prevPositions();
  const kinds = source.kinds();
  const sprites = source.sprites();

  for (let i = 0; i < count; i++) {
    const wx = lerp(previous[i * 2], current[i * 2], alpha);
    const wy = lerp(previous[i * 2 + 1], current[i * 2 + 1], alpha);
    // Two scalar calls rather than the `worldToScreen` tuple. The tuple
    // is one JS array per entity per frame, and the M0 close-out profile
    // measured V8 keeping every one of them - 57.8 MB over 2,394 frames
    // at 1,002 entities - rather than eliminating them by escape
    // analysis as this loop used to assume. [D11] says no per-entity JS
    // objects, ever; `docs/gpu-verification.md` [V11] is the measurement.
    //
    // Depth from the interpolated position, not from the current tick:
    // sorting an entity as though it were a tile ahead of where it is
    // drawn flickers rather than sorting stably wrong.
    //
    // The layer is what stops a sim standing on an object from sharing
    // its depth and losing the pixel to it - measured as an actual
    // disappearance in [V12], where the sim's 576 orange pixels were
    // simply absent from the frame in which it reached the fridge.
    writeInstance(
      scratch,
      i,
      screenX(wx, wy, originX),
      screenY(wx, wy, originY),
      layeredDepth(
        wx,
        wy,
        gridSize,
        kinds[i] === KIND_AGENT ? LAYER_SIM : LAYER_PROP,
      ),
      sprites[i],
    );
  }

  return scratch;
}
