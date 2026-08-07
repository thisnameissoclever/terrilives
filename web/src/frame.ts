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
  ACTIVITY_AT_WORK,
  EMISSIVE_NONE,
  FLOATS_PER_INSTANCE,
  KIND_AGENT,
  TINT_NONE,
  writeInstance,
  type InstanceArray,
} from './render/instances.js';
import { SPRITES, spriteIndex } from './render/atlas.js';
import {
  emissiveForSprite,
  sampleLight,
  type TileLighting,
} from './render/lighting.js';

/**
 * The atlas slot for the selection ring, resolved once at module load.
 *
 * By name rather than by a literal index, because the index is assigned by
 * declaration order in the atlas build and a hardcoded number here would
 * silently draw whatever sprite later took that slot. `spriteIndex` throws on an
 * unknown name, so a missing ring is a startup failure rather than a wrong
 * picture.
 */
const SELECTION_RING_SPRITE = spriteIndex('selectionRing');
/** Semantic overlay strength: the ring must stay legible at midnight. */
const SELECTION_RING_EMISSIVE = 1;

/**
 * The sim looks, one atlas entry each. [ML-chars].
 *
 * A household of three identical people was the loudest thing wrong with
 * the frame after Muted Line landed, and this is the fix: three baked
 * variants, picked by the sim's stable entity id, differing in skin,
 * hair and clothing.
 *
 * **Chosen by the shell rather than by content, and that is a real
 * choice.** `pack.sim_sprite` is ONE index - the content has no notion of
 * a sim's appearance, because nothing in the simulation depends on it.
 * Which of three equivalent looks a sim wears is presentation, the same
 * kind of decision as the walking bob and the height a bubble floats at,
 * and it lives here with them. [D1] is about the shell not holding a
 * second copy of something the content already knows; there is nothing
 * here to duplicate.
 *
 * The day that stops being true is the day a player picks a face, and
 * then appearance becomes authored content with a compile step and this
 * array becomes its default.
 *
 * By NAME rather than by literal index, for the same reason as the ring
 * above: declaration order in the atlas build assigns the numbers, and a
 * hardcoded one silently draws whatever later took the slot.
 */
const SIM_SPRITES: readonly number[] = [
  spriteIndex('sim'),
  spriteIndex('sim2'),
  spriteIndex('sim3'),
];

type ActionFrames = readonly [number, number];
type ActionFacings = readonly [
  ActionFrames,
  ActionFrames,
  ActionFrames,
  ActionFrames,
];

/**
 * Two authored conversation frames for every look and lot-axis facing.
 *
 * Facing order is positive x (screen south-east), negative x (north-west),
 * positive y (south-west), then negative y (north-east). The simulation emits
 * that stable world-space contract; this table owns only its art mapping.
 */
const SIM_TALK_SPRITES: readonly ActionFacings[] = [
  [
    [spriteIndex('simTalkSE0'), spriteIndex('simTalkSE1')],
    [spriteIndex('simTalkNW0'), spriteIndex('simTalkNW1')],
    [spriteIndex('simTalkSW0'), spriteIndex('simTalkSW1')],
    [spriteIndex('simTalkNE0'), spriteIndex('simTalkNE1')],
  ],
  [
    [spriteIndex('sim2TalkSE0'), spriteIndex('sim2TalkSE1')],
    [spriteIndex('sim2TalkNW0'), spriteIndex('sim2TalkNW1')],
    [spriteIndex('sim2TalkSW0'), spriteIndex('sim2TalkSW1')],
    [spriteIndex('sim2TalkNE0'), spriteIndex('sim2TalkNE1')],
  ],
  [
    [spriteIndex('sim3TalkSE0'), spriteIndex('sim3TalkSE1')],
    [spriteIndex('sim3TalkNW0'), spriteIndex('sim3TalkNW1')],
    [spriteIndex('sim3TalkSW0'), spriteIndex('sim3TalkSW1')],
    [spriteIndex('sim3TalkNE0'), spriteIndex('sim3TalkNE1')],
  ],
];

/** Two authored hand-to-mouth frames for every look and lot-axis facing. */
const SIM_EAT_SPRITES: readonly ActionFacings[] = [
  [
    [spriteIndex('simEatSE0'), spriteIndex('simEatSE1')],
    [spriteIndex('simEatNW0'), spriteIndex('simEatNW1')],
    [spriteIndex('simEatSW0'), spriteIndex('simEatSW1')],
    [spriteIndex('simEatNE0'), spriteIndex('simEatNE1')],
  ],
  [
    [spriteIndex('sim2EatSE0'), spriteIndex('sim2EatSE1')],
    [spriteIndex('sim2EatNW0'), spriteIndex('sim2EatNW1')],
    [spriteIndex('sim2EatSW0'), spriteIndex('sim2EatSW1')],
    [spriteIndex('sim2EatNE0'), spriteIndex('sim2EatNE1')],
  ],
  [
    [spriteIndex('sim3EatSE0'), spriteIndex('sim3EatSE1')],
    [spriteIndex('sim3EatNW0'), spriteIndex('sim3EatNW1')],
    [spriteIndex('sim3EatSW0'), spriteIndex('sim3EatSW1')],
    [spriteIndex('sim3EatNE0'), spriteIndex('sim3EatNE1')],
  ],
];

/** The authored visual-action code emitted for a conversation. */
export const VISUAL_ACTION_TALK = 1;

/** The authored visual-action code emitted while eating at an exact target. */
export const VISUAL_ACTION_EAT = 2;

/** Render-buffer facing codes, in the same order as `SIM_TALK_SPRITES`. */
export const FACING_POSITIVE_X = 1;
export const FACING_NEGATIVE_X = 2;
export const FACING_POSITIVE_Y = 3;
export const FACING_NEGATIVE_Y = 4;

/** A conversational pose holds for four simulation ticks, or 400 ms at 1x. */
export const TALK_FRAME_TICKS = 4;

/** An eating gesture holds for eight simulation ticks, or 800 ms at 1x. */
export const EAT_FRAME_TICKS = 8;

/**
 * Which look the sim with this entity id wears.
 *
 * Exported because it is the only part of the choice worth pinning: the
 * mapping has to be a FUNCTION of the id and nothing else, so a sim keeps
 * its face when it walks, when the buffer reorders around a despawn, and
 * across a save and reload. Anything keyed on the row instead would swap
 * two sims' faces the moment a third one left the lot.
 *
 * Plain modulo rather than a hash. Entity ids are handed out in sequence,
 * so consecutive sims get consecutive looks, which is the property a
 * household of three actually needs - a hash would be free to give all
 * three the same face and be "correct".
 */
export function simSprite(id: number): number {
  return SIM_SPRITES[id % SIM_SPRITES.length];
}

/**
 * Resolves one sim's body without presentation state or wall-clock time.
 *
 * Unknown action and facing values fail visibly safe to the ordinary body.
 * Reduced motion keeps frame zero, which preserves the semantic directional
 * pose while removing the ornamental gesture.
 */
export function simBodySprite(
  id: number,
  visualAction: number,
  facing: number,
  simulationTick: number,
  reducedMotion: boolean,
): number {
  const look = id % SIM_SPRITES.length;
  if (facing < FACING_POSITIVE_X || facing > FACING_NEGATIVE_Y) {
    return SIM_SPRITES[look];
  }

  let sprites: readonly ActionFacings[];
  let frameTicks: number;
  if (visualAction === VISUAL_ACTION_TALK) {
    sprites = SIM_TALK_SPRITES;
    frameTicks = TALK_FRAME_TICKS;
  } else if (visualAction === VISUAL_ACTION_EAT) {
    sprites = SIM_EAT_SPRITES;
    frameTicks = EAT_FRAME_TICKS;
  } else {
    return SIM_SPRITES[look];
  }

  const phaseTicks =
    visualAction === VISUAL_ACTION_EAT
      ? id % frameTicks
      : (id & 1) * frameTicks;
  const frame = reducedMotion
    ? 0
    : (Math.floor((simulationTick + phaseTicks) / frameTicks) & 1);
  return sprites[look][facing - 1][frame];
}

/**
 * The activity-indicator bubbles, one atlas slot per code that draws.
 * Index 0 and 1 (none, walking) are deliberately null: an idle sim needs
 * no badge and a walking sim's motion IS its indicator - a bubble on
 * every walker would turn the house into a notification tray. The
 * remaining codes match `render_buffer::activity` on the Rust side.
 */
const INDICATOR_SPRITES: readonly (number | null)[] = [
  null,
  null,
  spriteIndex('indicatorWait'),
  spriteIndex('indicatorEat'),
  spriteIndex('indicatorTalk'),
  spriteIndex('indicatorSleep'),
  // AT_WORK: no bubble - the whole ROW is skipped below; gone is gone.
  null,
];

/**
 * The `render_buffer::activity::AT_WORK` code. A row so flagged RIDES in
 * the buffer - removing it would shift every later entity's interpolation
 * slot and smear one frame at each departure - and the shell simply skips
 * its draw, its bubble, its ring and its pick. One code, shared with
 * input.ts, so the draw skip and the pick skip cannot disagree.
 */
/** The `render_buffer::activity::WALKING` code. */
export const ACTIVITY_WALKING = 1;

/** Maximum ornamental body lift for one walking footfall at camera scale 1. */
export const WALK_LIFT_PX = 2;

/**
 * A distance-driven footfall with two smooth lifts per tile.
 *
 * World position is the phase so pause, speed changes, save/load and replay
 * reproduce the same pose without presentation state or wall-clock time.
 */
export function walkingLiftPx(
  wx: number,
  wy: number,
  reducedMotion: boolean,
  scale = 1,
): number {
  if (reducedMotion) return 0;
  const halfStep = 2 * (wx + wy);
  const phase = halfStep - Math.floor(halfStep);
  return WALK_LIFT_PX * (1 - Math.abs(2 * phase - 1)) * scale;
}

/**
 * How far above a sim's anchor its bubble floats, in screen pixels: the
 * sim sprite is 78 tall and the bubble hangs just over its head.
 */
const INDICATOR_LIFT = 84;

/**
 * Nudges a bubble NEARER than the sim it belongs to, without inventing a
 * depth layer. Far smaller than the layer step, so it can never reorder
 * a bubble against anything but its own sim - and without it the two
 * share a depth exactly, where `depthCompare: 'less'` discards the
 * second quad drawn ([V12]).
 */
const INDICATOR_DEPTH_NUDGE = 1e-5;

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

/** The two simulation operations one rendered frame coordinates. */
export interface FrameSimulation {
  tick(): void;
  flushCommands(): void;
}

/**
 * Advances the simulation side of one rendered frame.
 *
 * Paused frames apply input through the command-only schedule. Running frames
 * use full fixed ticks, whose first phase drains the same queue. Keeping this
 * branch here makes the pause contract independently testable from browser
 * wiring in `main.ts`.
 */
export function advanceSimulationFrame(
  driver: FixedStepDriver,
  deltaMs: number,
  sim: FrameSimulation,
): number {
  if (driver.ticksPerUnitTime === 0) sim.flushCommands();
  return driver.advance(deltaMs, () => sim.tick());
}

/**
 * What `buildInstances` reads. `SimBridge` satisfies it structurally.
 *
 * Naming the subset rather than importing the class keeps the instance
 * builder testable without a WASM module, and keeps the render path
 * honest about the columns it depends on. Every view is re-read on each call.
 */
export interface RenderSource {
  readonly count: number;
  positions(): Float32Array;
  prevPositions(): Float32Array;
  /**
   * The raw entity index in each row, so the selection ring can find the
   * selected sim's row. A row number would not do; see `RenderBuffer::ids`.
   */
  ids(): Uint32Array;
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
  /**
   * What each row is doing, as `render_buffer::activity` codes - the
   * [A-11] indicator column. Read every frame like every other view.
   */
  activities(): Uint32Array;
  /** Authored body-pose category: 0 none, 1 talk, 2 eat. */
  visualActions(): Uint32Array;
  /** Lot-axis facing: 0 none, 1 +x, 2 -x, 3 +y, 4 -y. */
  facings(): Uint32Array;
  /**
   * What each row is carrying, as pack item-kind indices with a
   * u32::MAX empty-hands sentinel. Read every frame.
   */
  carrying(): Uint32Array;
  /**
   * One name per pack item kind - `carried_<kind>` atlas resolution's
   * input. Stable for the life of the pack; read lazily once.
   */
  itemKinds(): readonly string[];
}

/** The carrying column's empty-hands sentinel. */
const NOT_CARRYING = 0xffff_ffff;

/**
 * Atlas indices per item kind, resolved once on first use from the
 * source's own kind list via the `carried_<kind>` naming convention -
 * a convention rather than a table so the shell holds no second copy
 * of the content's kind list ([D1]). A kind whose badge nobody drew
 * resolves to null and simply draws nothing, which is visible in play
 * and cheap here.
 */
let carriedSprites: (number | null)[] | null = null;
let dinnerItemKind: number | undefined;

function carriedSprite(source: RenderSource, kind: number): number | null {
  if (carriedSprites === null) {
    const itemKinds = source.itemKinds();
    dinnerItemKind = itemKinds.indexOf('dinner');
    carriedSprites = itemKinds.map((name) => {
      const index = SPRITES.findIndex(
        (sprite) => sprite.name === `carried_${name}`,
      );
      return index >= 0 ? index : null;
    });
  }
  return carriedSprites[kind] ?? null;
}

/**
 * Where a sim's carried badge sits: at HAND height - a third of the
 * way up the 78 px figure - and nudged to its right side, so the bag
 * reads as held rather than worn. The first cut floated it at 46,
 * which under any zoom above 1x landed squarely on the head: the
 * owner's report, verbatim, was "wearing a plate on their head".
 */
const CARRIED_LIFT = 24;
const CARRIED_SIDE = 14;

/**
 * Eating places the carried dinner on the authored anchor-side hand. Other
 * carrying keeps the established screen-right placement, including ingredients
 * moving between dinner stations.
 */
function carriedSidePx(
  itemKind: number,
  visualAction: number,
  facing: number,
): number {
  if (itemKind !== dinnerItemKind || visualAction !== VISUAL_ACTION_EAT) {
    return CARRIED_SIDE;
  }
  return facing === FACING_NEGATIVE_X || facing === FACING_POSITIVE_Y
    ? -CARRIED_SIDE
    : CARRIED_SIDE;
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
  selected: number | null = null,
  scale = 1,
  reducedMotion = false,
  simulationTick = 0,
  lighting: TileLighting | null = null,
): InstanceArray {
  const count = source.count;
  // Room for the entities, one bubble and one carried badge each in
  // the worst case, and the selection ring. Still [D11]-clean: the
  // scratch buffer grows once to the high-water mark and is reused;
  // nothing per-frame allocates.
  const needed = (count * 3 + 1) * FLOATS_PER_INSTANCE;
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
  const activities = source.activities();
  const visualActions = source.visualActions();
  const facings = source.facings();
  const ids = source.ids();

  for (let i = 0; i < count; i++) {
    // A sim at the office is not drawn, and its slot must not shift:
    // the instance is written DEGENERATE - parked far off-screen, where
    // clipping discards it for free - so instance i stays row i.
    if (activities[i] === ACTIVITY_AT_WORK) {
      writeInstance(scratch, i, -1e6, -1e6, 1, 0);
      continue;
    }
    const wx = lerp(previous[i * 2], current[i * 2], alpha);
    const wy = lerp(previous[i * 2 + 1], current[i * 2 + 1], alpha);
    const bodyLift =
      kinds[i] === KIND_AGENT && activities[i] === ACTIVITY_WALKING
        ? walkingLiftPx(wx, wy, reducedMotion, scale)
        : 0;
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
    //
    // A sim draws one of `SIM_SPRITES` rather than the pack's single
    // `sim_sprite`, keyed on its own stable entity id so a sim keeps its
    // face across a walk, a save and a reload. Everything else - every
    // object in the house - draws exactly what content resolved.
    const sprite =
      kinds[i] === KIND_AGENT
        ? simBodySprite(
            ids[i],
            visualActions[i],
            facings[i],
            simulationTick,
            reducedMotion,
          )
        : sprites[i];
    const localLight = lighting === null
      ? EMISSIVE_NONE
      : sampleLight(lighting, Math.floor(wx), Math.floor(wy));
    writeInstance(
      scratch,
      i,
      screenX(wx, wy, originX, scale),
      screenY(wx, wy, originY, scale) - bodyLift,
      // Depth stays in WORLD terms on purpose: zoom changes how big
      // things are drawn, never what covers what.
      layeredDepth(
        wx,
        wy,
        gridSize,
        kinds[i] === KIND_AGENT ? LAYER_SIM : LAYER_PROP,
      ),
      sprite,
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      Math.max(emissiveForSprite(sprite), localLight),
    );
  }

  // **The indicator bubbles, in the slots after the entities.** One per
  // sim whose activity draws, floated over the sim's interpolated
  // position so it tracks a walker into a conversation, and nudged
  // nearer than the sim itself so the two never tie on depth. This is
  // the owner's "if you can't see what they're doing, they may as well
  // not be doing anything", as quads.
  let slot = count;
  for (let i = 0; i < count; i++) {
    const sprite = INDICATOR_SPRITES[activities[i]] ?? null;
    if (sprite === null) continue;
    const wx = lerp(previous[i * 2], current[i * 2], alpha);
    const wy = lerp(previous[i * 2 + 1], current[i * 2 + 1], alpha);
    writeInstance(
      scratch,
      slot++,
      screenX(wx, wy, originX, scale),
      // The lift scales with the camera: the sim's sprite is drawn
      // `scale` times taller, so an unscaled lift would sink the bubble
      // into a zoomed head and orbit it high over a zoomed-out one.
      screenY(wx, wy, originY, scale) - INDICATOR_LIFT * scale,
      layeredDepth(wx, wy, gridSize, LAYER_SIM) - INDICATOR_DEPTH_NUDGE,
      sprite,
    );
  }

  // **The carried badges, after the bubbles** - [K3]'s hands on
  // screen, and the transform made visible: the bag becomes a plate
  // between the hob and the table. Hand height, under the bubble, so
  // a talking carrier shows both.
  //
  // CAMERA-AWARE like every other pass, and this one learned it the
  // hard way: written against a scaleless main and rebased under the
  // camera, it was the single pass placing at 1x coordinates while
  // zoomed sims moved at scaled ones - the owner saw the badge
  // tracking its carrier "at a different rate". Both the position and
  // the offsets take the scale.
  const carrying = source.carrying();
  for (let i = 0; i < count; i++) {
    if (carrying[i] === NOT_CARRYING) continue;
    if (activities[i] === ACTIVITY_AT_WORK) continue;
    const sprite = carriedSprite(source, carrying[i]);
    if (sprite === null) continue;
    const wx = lerp(previous[i * 2], current[i * 2], alpha);
    const wy = lerp(previous[i * 2 + 1], current[i * 2 + 1], alpha);
    const lift =
      kinds[i] === KIND_AGENT && activities[i] === ACTIVITY_WALKING
        ? walkingLiftPx(wx, wy, reducedMotion, scale)
        : 0;
    const localLight = lighting === null
      ? EMISSIVE_NONE
      : sampleLight(lighting, Math.floor(wx), Math.floor(wy));
    writeInstance(
      scratch,
      slot++,
      screenX(wx, wy, originX, scale) +
        carriedSidePx(carrying[i], visualActions[i], facings[i]) * scale,
      screenY(wx, wy, originY, scale) - CARRIED_LIFT * scale - lift,
      layeredDepth(wx, wy, gridSize, LAYER_SIM) - INDICATOR_DEPTH_NUDGE,
      sprite,
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      localLight,
    );
  }

  // **The selection ring, last, in the slot past the live entities and
  // their bubbles and badges.**
  //
  // Drawn from the same interpolated position as the sim itself rather than
  // from the tick position, so it tracks a walking sim instead of stepping
  // behind it.
  //
  // `LAYER_PROP` puts it above the floor and below the sim: a ring drawn OVER
  // the sim would obscure the thing it is pointing at, and one at
  // `LAYER_FLOOR`'s old depth would be invisible now that the floor shares one
  // depth in front of nothing.
  const ringRow = findSelectedRow(source, selected);
  if (ringRow !== null) {
    const wx = lerp(previous[ringRow * 2], current[ringRow * 2], alpha);
    const wy = lerp(previous[ringRow * 2 + 1], current[ringRow * 2 + 1], alpha);
    writeInstance(
      scratch,
      slot,
      screenX(wx, wy, originX, scale),
      screenY(wx, wy, originY, scale),
      layeredDepth(wx, wy, gridSize, LAYER_PROP),
      SELECTION_RING_SPRITE,
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      SELECTION_RING_EMISSIVE,
    );
  }

  return scratch;
}

/**
 * How many instances `buildInstances` filled, which is the entity count plus a
 * selection ring if one was drawn.
 *
 * Returned separately rather than folded into the array because the caller
 * passes a count to `draw`, and the scratch buffer is deliberately longer than
 * the live data. Getting this wrong uploads uninitialised zeroes - quads at
 * screen (0, 0) with depth 0, which draw in front of everything.
 */
export function instanceCount(source: RenderSource, selected: number | null): number {
  let extras = 0;
  const activities = source.activities();
  const carrying = source.carrying();
  for (let i = 0; i < source.count; i++) {
    if (INDICATOR_SPRITES[activities[i]] != null) extras++;
    if (
      carrying[i] !== NOT_CARRYING &&
      activities[i] !== ACTIVITY_AT_WORK &&
      carriedSprite(source, carrying[i]) !== null
    ) {
      extras++;
    }
  }
  return source.count + extras + (findSelectedRow(source, selected) === null ? 0 : 1);
}

/**
 * The row holding `selected`, or null if nothing is selected, it is gone,
 * or it is at work - a ring around the empty doorway would be the shell
 * pointing at somebody who is not there. Both `buildInstances` and
 * `instanceCount` route through here, so the draw and the count cannot
 * disagree about it.
 */
function findSelectedRow(source: RenderSource, selected: number | null): number | null {
  if (selected === null) return null;
  const ids = source.ids();
  const activities = source.activities();
  for (let row = 0; row < source.count; row++) {
    if (ids[row] !== selected) continue;
    return activities[row] === ACTIVITY_AT_WORK ? null : row;
  }
  // A selected entity that is no longer in the buffer. Not an error: the
  // simulation keeps a selection whose index has gone away rather than
  // clearing it, deliberately, so the ring simply is not drawn.
  return null;
}
