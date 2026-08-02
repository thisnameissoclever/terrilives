/**
 * Pointer input: a click on the canvas becomes a serialised player command.
 *
 * Three steps, and each is a separate function because each can be wrong on
 * its own: client pixels to a lot tile, a tile to whatever entity is
 * standing on it, and an entity to the command that names it. Only the last
 * function in the file touches the DOM, so the arithmetic and the decision
 * are both testable in Node - the same split `frame.ts` and `iso.ts` use.
 *
 * **Nothing here mutates the simulation.** Per [D-2] the only thing this
 * module can do is enqueue a command, which `drain_commands` applies first in
 * a full tick or alone while paused. Both paths consume the same ordered data,
 * which keeps a recorded session replayable and is what a Layer 2 client would
 * send over a wire.
 *
 * # The gestures, as [I3] and [I4] settled them
 *
 * | input | effect |
 * | --- | --- |
 * | click a sim | select it |
 * | click an object | **replace** the selected sim's queue with this |
 * | ctrl or cmd click an object | **append** to the queue |
 * | click bare floor | clear the selection |
 * | right click or long press | open the flyout in `ui/object-menu.ts` |
 *
 * Replace is two existing commands in one drain batch rather than a new
 * one; see `dispatch`. The flyout's own rules live beside it, and this file
 * holds only the part that needs a pick: which rows a right click asks for.
 */

import { ACTIVITY_AT_WORK } from './frame.js';
import { SPRITES } from './render/atlas.js';
import {
  DRAG_THRESHOLD_PX,
  pinchZoom,
  pointerDistance,
  wheelZoom,
  type Camera,
} from './render/camera.js';
import { KIND_AGENT } from './render/instances.js';
import {
  LAYER_PROP,
  LAYER_SIM,
  TILE_HALF_HEIGHT,
  screenToWorld,
  screenX,
  screenY,
} from './render/iso.js';
import {
  NEVER_MIND,
  menuEntries,
  socialMenuEntries,
  type MenuAction,
  type MenuEntry,
} from './ui/object-menu.js';

/**
 * What picking needs from the simulation. `SimBridge` satisfies it
 * structurally, so tests need no WASM module - the same trick
 * `RenderSource` plays in `frame.ts`.
 *
 * All three accessors are re-read on every call, per [D11]: WASM memory
 * growth detaches every view over the old buffer, and the pointers move
 * when the underlying vectors reallocate.
 */
export interface PickSource {
  readonly count: number;
  positions(): Float32Array;
  /** 0 for a sim, 1 for a smart object. */
  kinds(): Uint32Array;
  /** The raw entity index in each row. NOT the row number; see `pickAt`. */
  ids(): Uint32Array;
  /**
   * Atlas sprite index per row, which is what gives each entity its drawn
   * SIZE. Picking needs it because the thing a player aims at is the sprite,
   * not the tile - see `pickSprite`.
   */
  sprites(): Uint32Array;
  /**
   * Activity codes per row. Picking reads it for ONE code: a sim at work
   * (ACTIVITY_AT_WORK) is not drawn, so it must not be clickable either -
   * the pick box and the pixels move together, the standing rule.
   */
  activities(): Uint32Array;
}

/** The rectangle a canvas occupies on the page, as `getBoundingClientRect` reports it. */
export interface ViewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Something the player clicked on. `entity` is a raw entity index. */
export interface Pick {
  readonly entity: number;
  readonly isAgent: boolean;
}

/**
 * What a click resolves to. `none` is a real outcome rather than a failure:
 * clicking an object with nothing selected has nothing to direct.
 */
export type ClickAction =
  | { readonly kind: 'select'; readonly entity: number | null }
  | {
      readonly kind: 'use';
      readonly agent: number;
      readonly object: number;
      /**
       * Which of the object's interactions to run - `Intent::interaction`,
       * and the last field of `SimCommand::UseObject`.
       *
       * **A left click always names 0**, which is the only interaction any
       * shipped object has. It is carried as a field rather than left for
       * `dispatch` to supply so that there is exactly one place in this
       * shell that decides what a gesture's interaction is, and so that a
       * left click and a menu row reach `useObject` through the same
       * parameter instead of one of them going through a default.
       */
      readonly interaction: number;
      /**
       * Whether this instruction is the sim's ONLY instruction.
       *
       * `true` for a plain click and `false` for a ctrl-click, per [I3].
       * It is carried here rather than decided in `dispatch` because it
       * is a property of the gesture the player made, and `dispatch`
       * only ever sees an action.
       */
      readonly replace: boolean;
    }
  | { readonly kind: 'none' };

/**
 * What happened after a left click reached the command boundary.
 *
 * Selection is kept distinct from an order so the shell can report the
 * command the player actually attempted when the staging queue rejects it.
 * `none` is not a rejection: it is an unplaceable click or an object click
 * made before anybody was selected.
 */
export type LeftClickOutcome =
  | { readonly kind: 'selection'; readonly accepted: boolean }
  | { readonly kind: 'order'; readonly accepted: boolean }
  | { readonly kind: 'none' };

export type RejectedCommandKind = Exclude<LeftClickOutcome['kind'], 'none'>;

/**
 * The tile a click landed on, or `null` if the canvas has no area.
 *
 * Two conversions, in this order:
 *
 *  1. **Client pixels to drawing-buffer pixels.** The canvas has a fixed
 *     1280x720 drawing buffer and the browser may lay it out at any CSS
 *     size, so the ratio is applied rather than assumed to be 1. This also
 *     makes it correct at any device pixel ratio for free, because
 *     `originX`/`originY` are in drawing-buffer pixels and the rect is in
 *     CSS pixels - the ratio between them is exactly the correction needed.
 *  2. **Drawing-buffer pixels to a tile**, by inverting the projection and
 *     rounding.
 *
 * **`Math.round`, not `Math.floor`, and the difference is half a tile in
 * both axes.** `screenToWorld` inverts `worldToScreen`, which places tile
 * `(x, y)` at the CENTRE of its floor diamond - `sprites.wgsl` adds half a
 * tile of anchor precisely so a bottom-anchored sprite stands on the south
 * corner rather than floating at the centre, which is only meaningful if
 * the un-anchored point is the centre. So the region of screen that belongs
 * to a tile is the diamond within half a tile of it, which is `round`.
 * Flooring instead would give the diamond spanning `(x, y)` to
 * `(x + 1, y + 1)`, offset half a tile down-screen from the one drawn - so
 * clicks would land dead on near the middle of the lot and one tile out
 * towards the edges. That reads as a flaky game rather than as a bug here,
 * which is the failure `iso.ts` warns about in the same terms.
 *
 * Returning `null` on a zero-sized rect rather than dividing by it: the
 * quotient would be `Infinity`, `round(Infinity)` is `Infinity`, and every
 * comparison against it is false, so the click would silently resolve to
 * empty floor and clear the selection.
 */
export function clientToTile(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  canvasWidth: number,
  canvasHeight: number,
  originX: number,
  originY: number,
  scale = 1,
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bufferX = ((clientX - rect.left) * canvasWidth) / rect.width;
  const bufferY = ((clientY - rect.top) * canvasHeight) / rect.height;
  const [wx, wy] = screenToWorld(bufferX, bufferY, originX, originY, scale);
  return [Math.round(wx), Math.round(wy)];
}

/**
 * The entity whose **drawn sprite** covers the canvas point `(px, py)`, or
 * `null` if the click landed on bare floor.
 *
 * # Why this replaced tile picking, with the numbers
 *
 * Picking used to invert the projection to a tile and ask what stood on it.
 * That is the right model for "walk to here" and the wrong one for "click that
 * sim", because **sprites are bottom-anchored and much taller than a tile**.
 * A sim is 38 x 78 px standing on a 64 x 32 diamond, so most of its visible
 * body is drawn 50-plus pixels above the tile it occupies.
 *
 * Measured against the shipped projection, sampling nine points down the sim's
 * own sprite: **three of the nine selected it.** Its head resolved to a tile
 * two away diagonally, its midriff to a tile one away, and its feet to a tile
 * one PAST it. Only a band between roughly 60% and 90% of the way down worked.
 * The first person to open the page cold reported that clicking the sim did
 * nothing, and they were right; the tile arithmetic was never wrong, it was
 * answering a different question from the one a mouse asks.
 *
 * # The coupling this accepts, deliberately
 *
 * `iso.ts` argued against exactly this - that quad-space picking couples input
 * to the renderer's sprite sizes, so changing the art silently changes where
 * clicks land. That coupling is real and it is now considered a FEATURE rather
 * than a cost: if the art changes, clicks should follow the art, because the
 * player is aiming at the art. The alternative, as measured above, is sims that
 * cannot be clicked.
 *
 * Tile picking has not been deleted - `clientToTile` is still here and still
 * tested, because click-to-walk needs precisely that question answered.
 *
 * # Front-to-back, matching what won the pixel
 *
 * A click must resolve to whatever is drawn ON TOP at that point, which is what
 * the depth buffer decided:
 *
 *  1. **Nearer first.** Depth comes from `x + y`, and a larger sum is nearer
 *     the camera, so the entity with the greatest `x + y` wins.
 *  2. **Sims over props on the same tile**, because `frame.ts` puts sims on
 *     `LAYER_SIM` and props on `LAYER_PROP`.
 *  3. **Earlier row otherwise.** Equal depth means the first drawn keeps the
 *     pixel, since `depthCompare` is `less` and equal is not less.
 *
 * # What this does not do
 *
 * The hit box is the sprite's **rectangle**, not its opaque pixels, so a click
 * in the transparent corner above a bed's headboard still selects the bed. The
 * shader discards those fragments, so the player sees floor there. Reading the
 * atlas's alpha would fix it and needs the decoded image on this side; the
 * rectangle is a large improvement on a 32-pixel-tall diamond and the
 * imprecision is in the player's favour - it makes things easier to hit.
 *
 * **Walls and floor tiles are invisible to this.** They are static geometry
 * uploaded once, not render-buffer rows, so nothing here can return one. A
 * click on a wall therefore reads as bare floor and clears the selection - and
 * a click on a wall drawn IN FRONT of a sim selects the sim behind it, because
 * only the sim is a candidate. Harmless today; it stops being harmless when
 * walls become clickable in build mode.
 *
 * **Positions are the current tick's, not the interpolated ones the renderer
 * draws**, matching `pickAt`. For tile picking that is a rounding difference; on
 * a sprite box it is up to a quarter tile of real offset at the edges, so a
 * click at the very edge of a fast-moving sim can miss. Fixing it means
 * threading the frame's `alpha` in here, which couples input to the render
 * loop's timing; the miss is small and only at the boundary, so it has not been
 * done.
 */
export function pickSprite(
  source: PickSource,
  px: number,
  py: number,
  originX: number,
  originY: number,
  scale = 1,
): Pick | null {
  const count = source.count;
  const positions = source.positions();
  const kinds = source.kinds();
  const ids = source.ids();
  const spriteIndices = source.sprites();
  const activities = source.activities();

  let best: Pick | null = null;
  let bestNearness = -Infinity;
  let bestLayer = -Infinity;

  for (let row = 0; row < count; row++) {
    // Not drawn, not clickable: frame.ts parks this row off-screen.
    if (activities[row] === ACTIVITY_AT_WORK) continue;
    const wx = positions[row * 2];
    const wy = positions[row * 2 + 1];
    const sprite = SPRITES[spriteIndices[row]];
    // A row whose sprite index is out of range would otherwise throw on
    // `.w`. It cannot happen from compiled content, and a click is not the
    // place to discover that it did.
    if (sprite === undefined) continue;

    // The same arithmetic `sprites.wgsl` does: bottom-centre anchored, with
    // the anchor half a tile below the entity's screen position so the sprite
    // stands on the diamond's south corner.
    //
    // The anchor is not duplicated - it reaches the shader as a UNIFORM, which
    // `sprites.ts` fills from this same `TILE_HALF_HEIGHT`, so both sides read
    // one constant and cannot drift. What IS restated here is the quad layout
    // (half the width left, the full height up), and nothing pins that against
    // the shader; a change to `CORNERS` or to the `topLeft` expression in
    // `sprites.wgsl` would move the drawn sprite without moving the hit box.
    // Every drawn distance scales with the camera - the anchor's
    // half-tile drop and the sprite's box alike - so the hit box is the
    // zoomed quad, not the 1x quad floating over it. The position's own
    // scaling rides through `screenX`/`screenY` exactly as the renderer's
    // does.
    const anchorX = screenX(wx, wy, originX, scale);
    const anchorY = screenY(wx, wy, originY, scale) + TILE_HALF_HEIGHT * scale;
    const left = anchorX - (sprite.w / 2) * scale;
    const top = anchorY - sprite.h * scale;
    if (px < left || px > left + sprite.w * scale) continue;
    if (py < top || py > anchorY) continue;

    const nearness = wx + wy;
    // The renderer's own layer constants rather than 1 and 0, so that swapping
    // them in `iso.ts` moves the drawn order and the hit order together. Two
    // hand-written numbers here would leave picking silently disagreeing with
    // what is on top.
    const layer = kinds[row] === KIND_AGENT ? LAYER_SIM : LAYER_PROP;
    // Strictly greater on both, so an equal-depth equal-layer tie keeps the
    // EARLIER row - the one that won the pixel.
    if (
      nearness > bestNearness ||
      (nearness === bestNearness && layer > bestLayer)
    ) {
      bestNearness = nearness;
      bestLayer = layer;
      best = { entity: ids[row], isAgent: kinds[row] === KIND_AGENT };
    }
  }
  return best;
}

/**
 * The entity standing on `(tileX, tileY)`, or `null` for bare floor.
 *
 * **Superseded for mouse picking by `pickSprite`**, which is what the click
 * handler uses: a player aims at a sprite and this answers about a tile, and
 * for a 78-pixel-tall sim standing on a 32-pixel-tall diamond those are
 * different places. Kept because it is the right question for click-to-walk
 * and for anything that reasons in tiles.
 *
 * **It returns the entity index out of `ids`, never the row number.** Rows
 * are sorted by entity index, so a row is a rank; the two agree only while
 * indices run 0..count with no gaps. See `RenderBuffer::ids` in Rust for
 * why that is a coincidence with an expiry date.
 *
 * **A sim beats an object on a contested tile**, because that is what the
 * player can see: `frame.ts` puts sims on `LAYER_SIM` and props on
 * `LAYER_PROP`, so a sim standing on the fridge is drawn in front of it.
 * Picking the fridge there would mean clicking a sim and selecting the
 * furniture it is standing on.
 *
 * **Among two sims on one tile the earlier row wins**, for the same
 * reason: they share a layer and therefore a depth, `depthCompare` is
 * `less`, and an equal depth is not less - so the first one drawn keeps the
 * pixel and the later one is rejected. Draw order is row order. This only
 * arises under `?stress=N`, which stacks filler entities, but "whichever
 * the loop happened to see last" is not an answer worth shipping.
 *
 * Positions are the current tick's, not the interpolated ones the renderer
 * draws. A sim moves at most a quarter of a tile per tick, so the two round
 * to the same tile except within a quarter tile of a boundary, and reading
 * the authoritative position keeps picking independent of where in the
 * frame the click arrived.
 */
export function pickAt(
  source: PickSource,
  tileX: number,
  tileY: number,
): Pick | null {
  const count = source.count;
  const positions = source.positions();
  const kinds = source.kinds();
  const ids = source.ids();
  const activities = source.activities();

  let object: Pick | null = null;
  for (let row = 0; row < count; row++) {
    // The same skip as pickSprite: a worker frozen at the door tile
    // must not swallow a click aimed at the doorway's floor.
    if (activities[row] === ACTIVITY_AT_WORK) continue;
    if (Math.round(positions[row * 2]) !== tileX) continue;
    if (Math.round(positions[row * 2 + 1]) !== tileY) continue;

    if (kinds[row] === KIND_AGENT) {
      // First agent found wins and ends the scan: it is the one drawn in
      // front, and nothing later in the buffer can outrank it.
      return { entity: ids[row], isAgent: true };
    }
    // Remembered but not returned, in case a sim is standing on it.
    object ??= { entity: ids[row], isAgent: false };
  }
  return object;
}

/**
 * The command a left click means.
 *
 * - A sim: select it. Selection lives in the simulation ([D-5]), so this is
 *   a command like everything else rather than a variable in the shell.
 * - An object with a sim selected: direct that sim to use it, **replacing
 *   whatever it was doing**. With `additive` - ctrl or cmd held - the
 *   instruction is appended instead, up to `max_queued_intents`.
 * - An object with nothing selected: nothing. There is no sim to direct,
 *   and selecting furniture is not a thing the game has a meaning for.
 * - Bare floor or a wall: clear the selection.
 *
 * # Why a plain click replaces
 *
 * It appended until [I3] in
 * `docs/specs/2026-07-30-selection-and-input-design.md`, which reversed
 * it on one observation: **the common case is correcting yourself and the
 * rare case is planning a sequence**, so the plain gesture should be the
 * correction and the modifier should be the plan. Appending by default
 * meant a mis-click could not be taken back except by waiting out the
 * queue or right-clicking to cancel the lot.
 *
 * Nothing new crosses the boundary for it. Replace is `CancelIntents`
 * followed by `UseObject`, two commands that already existed, which is why
 * this is a change to what the shell SENDS rather than to what the
 * simulation understands. `dispatch` is where the pair is emitted and
 * `a_cancel_then_a_use_in_one_batch_replaces_the_queue_rather_than_appending_to_it`
 * in `crates/terri-sim/src/systems/command.rs` is what pins that the two
 * mean "replace" when they land in one drain, in that order.
 *
 * **`additive` is the gesture, not the modifier key.** Which physical keys
 * produce it is `attachPointerInput`'s business, and it accepts two of
 * them for a reason worth reading there.
 *
 * **Empty floor clearing the selection is a choice, not a fallback.** It is
 * the only way the player can reach `Select(None)`, and the alternative -
 * ignoring the click - leaves no way to put the need panel away. The cost
 * is that a near-miss on a sim deselects it; the play notes are where that
 * gets judged.
 *
 * Directing does NOT change the selection, so a player can ctrl-click three
 * objects in a row and queue all three for the sim they are watching.
 *
 * **A left click always names interaction 0**, and that is a statement
 * about the gesture rather than a placeholder: a click names an OBJECT, and
 * "the first thing this object offers" is the only reading of that which
 * does not require the player to have chosen. Choosing is what the
 * right-click flyout is for, and `dispatchMenuAction` is where a row's own
 * index enters.
 */
export function resolveLeftClick(
  pick: Pick | null,
  selected: number | null,
  additive: boolean,
): ClickAction {
  if (pick === null) return { kind: 'select', entity: null };
  if (pick.isAgent) return { kind: 'select', entity: pick.entity };
  if (selected === null) return { kind: 'none' };
  return {
    kind: 'use',
    agent: selected,
    object: pick.entity,
    interaction: LEFT_CLICK_INTERACTION,
    replace: !additive,
  };
}

/**
 * The interaction a left click names: the object's first.
 *
 * A named constant rather than a literal `0`, because a bare zero at a call
 * site is indistinguishable from the hardcode `SimCommand::UseObject`
 * carried until this field existed. Naming it says the value was chosen.
 * It is not a tuning knob - it is the arithmetic identity of "the first
 * entry in a list" - so it does not belong in `content/tuning.toml`.
 */
const LEFT_CLICK_INTERACTION = 0;

/** The subset of `SimBridge` the click handler dispatches through. */
export interface CommandSink {
  select(entityIndex: number | null): boolean;
  /**
   * `interaction` is required, matching `SimBridge.useObject`. A default of
   * 0 here would let a caller omit it and silently direct the sim at the
   * object's first verb, which is invisible while every shipped object has
   * exactly one.
   */
  useObject(agent: number, object: number, interaction: number): boolean;
  /** Matching `SimBridge.talkTo`; `interaction` indexes the social vocabulary. */
  talkTo(agent: number, target: number, interaction: number): boolean;
  cancelIntents(agent: number): boolean;
  selectedIndex(): number | null;
}

/**
 * Applies a resolved action. Separated so the resolution can be tested
 * without a bridge.
 *
 * **The cancel goes first, and that ordering is the whole of "replace".**
 * Both commands land in the same drain batch, and `drain_commands`
 * applies a batch in issue order, so:
 *
 *  - cancel then use empties the queue and then puts the new instruction
 *    in it - one entry, the new one, with the abandoned object's
 *    reservation released;
 *  - use then cancel stages the new instruction and then clears both that
 *    staged queue and any live queue. The sim ends up with nothing queued
 *    and the click looks like it was ignored.
 *
 * Two Rust tests hold the pair apart -
 * `a_cancel_then_a_use_in_one_batch_replaces_the_queue_rather_than_appending_to_it`
 * and `the_reverse_order_does_not_replace_and_is_why_the_shell_sends_cancel_first` -
 * because "the order matters" is a claim about two runs and pinning one of
 * them says nothing about the other.
 */
export function dispatch(sink: CommandSink, action: ClickAction): boolean | null {
  switch (action.kind) {
    case 'select':
      return sink.select(action.entity);
    case 'use':
      if (action.replace && !sink.cancelIntents(action.agent)) return false;
      return sink.useObject(action.agent, action.object, action.interaction);
    case 'none':
      return null;
  }
}

/** Everything a click handler needs of its sim: pick from it, command it. */
export type InputTarget = CommandSink & PickSource;

/**
 * What the flyout reads: the labels of one object's own interactions, in
 * interaction-index order. `SimBridge` satisfies it structurally, and an
 * EMPTY array is the normal answer for a sim, a stale index, or an object
 * with nothing to offer.
 */
export interface InteractionSource {
  interactionLabels(entity: number): readonly string[];
  /**
   * The social vocabulary's labels, index-ordered - the rows for a
   * flyout over a fellow SIM, per [A-11]'s "interact with other Sims".
   * Read on every open like `interactionLabels`, per [D-5].
   */
  socialLabels(): readonly string[];
}

/** Everything a right click needs: pick, read the labels, command. */
export type MenuTarget = InputTarget & InteractionSource;

/** What a right click drives on the flyout. `ObjectMenu` satisfies it. */
export interface MenuController {
  open(entries: readonly MenuEntry[], clientX: number, clientY: number): void;
  close(): void;
}

/** A point in canvas drawing-buffer pixels, which is the space the camera works in. */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The whole of a left click, given the canvas point it landed on.
 *
 * This exists as its own function so that the composition is testable and
 * not only its three parts: pick, resolve, dispatch is an order that can be
 * got wrong - reading the selection AFTER dispatching a `select`, say, would
 * make the first click on an object direct the sim the player had just
 * stopped looking at. There is no DOM in it, matching how `time-controls.ts`
 * keeps its testable half separate from its wiring.
 *
 * It takes a **point, not a tile**, because `pickSprite` needs the pixel: the
 * player aims at a drawn sprite and a tile is a different place, by up to two
 * tiles for something as tall as a sim. `null` is a click that could not be
 * placed at all, and it does nothing rather than clearing the selection.
 */
export function handleLeftClick(
  target: InputTarget,
  point: CanvasPoint | null,
  originX: number,
  originY: number,
  additive: boolean,
  scale = 1,
): LeftClickOutcome {
  if (point === null) return { kind: 'none' };
  const pick = pickSprite(target, point.x, point.y, originX, originY, scale);
  const action = resolveLeftClick(pick, target.selectedIndex(), additive);
  if (action.kind === 'none') return { kind: 'none' };
  const accepted = dispatch(target, action) === true;
  return action.kind === 'select'
    ? { kind: 'selection', accepted }
    : { kind: 'order', accepted };
}

/**
 * A pointer event's position in canvas drawing-buffer pixels, or `null` if the
 * canvas has no area.
 *
 * The ratio between the rect and the drawing buffer is applied rather than
 * assumed to be 1, which makes this correct at any browser zoom and any device
 * pixel ratio: the camera offsets are in buffer pixels and the rect is in CSS
 * pixels, so their ratio is exactly the correction needed.
 *
 * `null` rather than dividing by a zero-sized rect: the quotient would be
 * `Infinity`, no sprite box would contain it, and the click would read as bare
 * floor and clear the selection.
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) * canvasWidth) / rect.width,
    y: ((clientY - rect.top) * canvasHeight) / rect.height,
  };
}

/**
 * A right click, as much of `MouseEvent` as the handler needs: where it
 * landed on the page, and the ability to suppress the browser's own menu.
 */
export interface RightClickEvent {
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

/**
 * The rows a right click should open, or `null` for no menu at all.
 *
 * Three cases, and the middle one is the decision [I4] left open:
 *
 *  - **nothing selected: no menu.** Every row acts on the selected sim -
 *    the interactions direct it and the cancel releases it - so with no
 *    selection a menu could only be a list of things that do nothing. The
 *    alternative the spec offered was to draw the rows disabled, and that
 *    was rejected here: a menu whose every row is greyed out explains
 *    nothing about why, and the player's actual next move is to click a
 *    sim, which an open menu is in the way of. The browser's own menu is
 *    still suppressed, so the gesture is inert rather than jarring.
 *  - **an object: its interactions, then the cancel.**
 *  - **a DIFFERENT sim: the social vocabulary, then the cancel** - the
 *    [A-11] talk command's front door.
 *  - **the selected sim itself, bare floor or a wall: the cancel
 *    alone.** Right click used to cancel from anywhere, and [I4] moved
 *    that binding into the menu rather than deleting it; a menu that
 *    only appeared over furniture would take the cancel away everywhere
 *    else. One row is a thin menu and it is strictly more than the
 *    gesture used to offer, because it now says what it is about to do
 *    before it does it.
 *
 * The labels are read from the simulation on every open rather than cached,
 * so a menu cannot show an object's old interaction list ([D-5]).
 */
export function resolveRightClick(
  target: MenuTarget,
  point: CanvasPoint | null,
  originX: number,
  originY: number,
  scale = 1,
): MenuEntry[] | null {
  if (target.selectedIndex() === null) return null;
  const pick =
    point === null
      ? null
      : pickSprite(target, point.x, point.y, originX, originY, scale);
  if (pick === null) return [NEVER_MIND];
  if (pick.isAgent) {
    // The selected sim itself: nothing to do but close. A DIFFERENT
    // sim: the social vocabulary - "walk over and chat" - which is the
    // [A-11] talk command's front door. The comparison is by entity
    // index because that is what selection stores and what the TalkTo
    // command will carry.
    if (pick.entity === target.selectedIndex()) return [NEVER_MIND];
    return socialMenuEntries(target.socialLabels(), pick.entity);
  }
  return menuEntries(target.interactionLabels(pick.entity), pick.entity);
}

/**
 * The whole of a right click: **open the flyout for whatever is under the
 * pointer**, and never let the browser menu open over the lot.
 *
 * `preventDefault` runs first and unconditionally, before the selection is
 * even read. A right click that does nothing is fine; one that opens the
 * context menu over the game is not, and the version of this that checks
 * the selection first pops the browser menu whenever nothing is selected -
 * which is now the common case for a right click that opens no flyout.
 *
 * A right click that resolves to no menu **closes** any menu already open,
 * rather than leaving it. Otherwise a right click on empty floor with
 * nothing selected would leave a menu from a previous click sitting over
 * the lot, still live, still naming an object the player has moved on from.
 */
export function handleRightClick(
  target: MenuTarget,
  menu: MenuController,
  event: RightClickEvent,
  point: CanvasPoint | null,
  originX: number,
  originY: number,
  scale = 1,
): void {
  event.preventDefault();
  const entries = resolveRightClick(target, point, originX, originY, scale);
  if (entries === null) {
    menu.close();
    return;
  }
  menu.open(entries, event.clientX, event.clientY);
}

/**
 * Applies a picked menu row.
 *
 * The selected sim is read HERE rather than captured when the menu opened,
 * for the same [D-5] reason the labels are re-read: between opening a menu
 * and picking from it the player may have selected someone else, or the
 * sim may have gone away. Reading now means the row acts on whoever the
 * simulation currently says is selected, or on nobody.
 *
 * A row replaces by default, like a plain left click. The visible Queue
 * mode passes `replace = false`, matching Ctrl or Cmd click on desktop so
 * touch and keyboard players have the same append operation.
 *
 * **The row's own interaction index is what is sent**, which is the only
 * thing that makes a second row mean anything: the rows come back from the
 * simulation in interaction order, `menuEntries` numbers them by position,
 * and that number goes into the command unchanged. Substituting 0 here
 * would leave a flyout whose every row did the same thing, and it would
 * look correct on every object the game currently ships because each has
 * exactly one row above the cancel.
 */
export function dispatchMenuAction(
  sink: CommandSink,
  action: MenuAction,
  replace = true,
): boolean {
  const agent = sink.selectedIndex();
  if (agent === null) return false;
  switch (action.kind) {
    case 'use':
      // Cancel first, then use: the replace pair. See `dispatch`.
      if (replace && !sink.cancelIntents(agent)) return false;
      return sink.useObject(agent, action.object, action.interaction);
    case 'talk':
      // The same replace pair as 'use': a talk order supersedes the
      // queue rather than joining it. Queue mode only applies to object
      // actions, so `replace` deliberately cannot change this branch.
      if (!sink.cancelIntents(agent)) return false;
      return sink.talkTo(agent, action.target, action.interaction);
    case 'cancel':
      return sink.cancelIntents(agent);
  }
}

/**
 * What the wiring drives on the flyout beyond opening and closing it: the
 * two dismissals that arrive from the document rather than from the canvas.
 * `ObjectMenu` satisfies it.
 */
export interface MenuHandle extends MenuController {
  handleKey(key: string): boolean;
  pointerDown(insideMenu: boolean): void;
}

/**
 * Wires the canvas and the document to the handlers above. The only
 * function here that needs a DOM, and therefore the only one with no test -
 * the same division `buildTimeControls` draws, where the list it builds
 * from is tested and the `addEventListener` calls are not.
 *
 * `contextmenu` is the right-click event rather than `mousedown` with
 * `button === 2`, because it is the one the browser menu hangs off: handling
 * the other and not this one pops the menu over the lot on every right
 * click.
 *
 * # The two dismissals live on the document, not the canvas
 *
 * Escape and click-away have to fire wherever the pointer or the focus is,
 * and the flyout deliberately sits outside the canvas in the DOM. A
 * `keydown` on the canvas would need the canvas focused, which it never is;
 * a `pointerdown` on the canvas would miss a click on the HUD.
 *
 * `pointerdown` rather than `click` for the dismissal, because it has to
 * beat the row's own `click` in the ordering - and `menuRoot.contains` is
 * what keeps a pointer-down on a row from closing the menu before that
 * click arrives. A dismissing click on the canvas is NOT swallowed: it
 * closes the menu and also acts, on the grounds that a player who clicks a
 * sim while a menu is open meant to click the sim.
 *
 * # Ctrl and cmd both append
 *
 * [I3] names ctrl-click, and this accepts `metaKey` as well. On macOS
 * `ctrl`-click IS the context-menu gesture - the browser fires
 * `contextmenu` for it - so a mac player can never produce a plain
 * ctrl-click at all, and cmd is that platform's modifier for the same
 * meaning everywhere else. Accepting only `ctrlKey` would leave macOS with
 * no way to queue a second instruction and no indication why.
 *
 * # The camera is a live reference, and gestures go back through callbacks
 *
 * The handlers used to read `originX`/`originY` from the closure, which was
 * right while both were fixed for the session. The camera made them live:
 * every gesture reads `camera` AT EVENT TIME, so a click after a zoom or a
 * drag picks against the projection the player is looking at. The gestures
 * never write the camera themselves - they hand new values to `gestures`,
 * because the camera's owner (`main.ts`) also owns the clamp and the dirty
 * flag that rebuilds the origin-baked static geometry, and a value written
 * here would move the sprites one frame before the floor.
 *
 * # Three camera routes, one state
 *
 * - **Wheel**: smooth multiplicative steps via `wheelZoom`, wheel-up in,
 *   ANCHORED AT THE CURSOR - the point under the wheel stays put.
 *   `preventDefault`, so the page never scrolls under the lot.
 * - **Pinch**: two pointers tracked by id via Pointer Events - not the
 *   iOS-only `gesturechange` - so Android Chrome and iOS Safari take the
 *   same path. The scale is anchored to the gesture's START (see
 *   `pinchZoom`) and to the fingers' MIDPOINT, whose movement also pans -
 *   one gesture, both hands of the map idiom. `touch-action: none` in the
 *   page CSS keeps the browser from claiming it for page-pinch first.
 * - **Drag**: one finger or the mouse's primary button pans, in buffer
 *   pixels so a drag moves the world exactly as far as the pointer moved.
 *   Below `DRAG_THRESHOLD_PX` of total travel it is still a click, which
 *   is what keeps a slightly shaky tap a selection rather than a
 *   one-pixel pan that eats it.
 *
 * A pan or a pinch must not ALSO select: the pointer lifting fires a
 * `click` on some browsers, and a camera gesture that ends by selecting
 * whatever was under a finger reads as a haunted camera. Either gesture
 * poisons the NEXT click, which is consumed and cleared.
 */
export interface CameraGestures {
  /** Zoom to `scale` holding buffer point (anchorX, anchorY) still. */
  zoomAt(anchorX: number, anchorY: number, scale: number): void;
  /** Move the origin by a buffer-pixel delta. */
  panBy(dx: number, dy: number): void;
}

/** A long press opens the same choices as a desktop right click. */
export const LONG_PRESS_MS = 500;

export interface LongPressScheduler {
  after(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const BROWSER_LONG_PRESS_SCHEDULER: LongPressScheduler = {
  after(delayMs, callback) {
    return globalThis.setTimeout(callback, delayMs);
  },
  cancel(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Timer and movement state for one touch long press.
 *
 * The class is free of DOM types so the timing contract can be tested without
 * buying a browser-shaped test dependency. A second finger, a drag, a lift,
 * or a cancellation all disarm the pending menu.
 */
export class LongPressGesture {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private timer: unknown = null;

  constructor(
    private readonly fire: (clientX: number, clientY: number) => void,
    private readonly scheduler: LongPressScheduler = BROWSER_LONG_PRESS_SCHEDULER,
    private readonly delayMs = LONG_PRESS_MS,
    private readonly movementLimitPx = DRAG_THRESHOLD_PX,
  ) {}

  begin(pointerId: number, clientX: number, clientY: number): void {
    this.cancel();
    this.pointerId = pointerId;
    this.startX = clientX;
    this.startY = clientY;
    this.timer = this.scheduler.after(this.delayMs, () => {
      if (this.pointerId === null) return;
      const x = this.startX;
      const y = this.startY;
      this.pointerId = null;
      this.timer = null;
      this.fire(x, y);
    });
  }

  move(pointerId: number, clientX: number, clientY: number): void {
    if (pointerId !== this.pointerId) return;
    if (
      pointerDistance(this.startX, this.startY, clientX, clientY) >
      this.movementLimitPx
    ) {
      this.cancel();
    }
  }

  end(pointerId: number): void {
    if (pointerId === this.pointerId) this.cancel();
  }

  cancel(): void {
    if (this.timer !== null) this.scheduler.cancel(this.timer);
    this.pointerId = null;
    this.timer = null;
  }
}

export function attachPointerInput(
  canvas: HTMLCanvasElement,
  target: MenuTarget,
  menu: MenuHandle,
  menuRoot: Node,
  camera: Readonly<Camera>,
  gestures: CameraGestures,
  additiveMode: () => boolean = () => false,
  onCommandRejected: (kind: RejectedCommandKind) => void = () => {},
): void {
  const canvasPoint = (event: {
    clientX: number;
    clientY: number;
  }): CanvasPoint | null =>
    clientToCanvas(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
    );
  /** Client-to-buffer pixel ratio, live because the window resizes. */
  const bufferRatio = (): number => {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  };

  // The gesture state: every touching pointer plus at most one mouse
  // drag, by pointer id. `moved` accumulates total travel so the click
  // threshold judges the WHOLE gesture, not the last event.
  const pointers = new Map<
    number,
    { x: number; y: number; startX: number; startY: number }
  >();
  let touchCount = 0;
  let moved = 0;
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let suppressNextClick = false;
  const longPress = new LongPressGesture((clientX, clientY) => {
    suppressNextClick = true;
    canvas.focus();
    handleRightClick(
      target,
      menu,
      { clientX, clientY, preventDefault() {} },
      canvasPoint({ clientX, clientY }),
      camera.originX,
      camera.originY,
      camera.scale,
    );
  });

  const touchPoints = () => [...pointers.values()].slice(0, 2);
  const spread = (): number => {
    const [a, b] = touchPoints();
    return pointerDistance(a.x, a.y, b.x, b.y);
  };
  const midpoint = (): { x: number; y: number } => {
    const [a, b] = touchPoints();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (event) => {
    const isTouch = event.pointerType === 'touch';
    // The mouse pans with its primary button OR the middle one - the
    // owner asked for both, and middle-drag is the desktop-native pan
    // gesture anyway. A right-button drag still belongs to the flyout.
    if (!isTouch && event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) {
      // Otherwise the browser starts autoscroll and the two gestures
      // fight over the same motion.
      event.preventDefault();
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    if (isTouch) {
      touchCount++;
      if (touchCount === 1) {
        longPress.begin(event.pointerId, event.clientX, event.clientY);
      } else {
        longPress.cancel();
      }
    }
    moved = 0;
    // Capture, so a drag that leaves the canvas keeps panning instead
    // of stranding mid-gesture.
    canvas.setPointerCapture(event.pointerId);
    if (isTouch && touchCount === 2) {
      pinchStartDistance = spread();
      pinchStartScale = camera.scale;
      suppressNextClick = true;
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    if (event.pointerType === 'touch') {
      longPress.move(event.pointerId, event.clientX, event.clientY);
    }
    const dx = event.clientX - entry.x;
    const dy = event.clientY - entry.y;
    const beforeMid =
      event.pointerType === 'touch' && touchCount === 2 ? midpoint() : null;
    entry.x = event.clientX;
    entry.y = event.clientY;
    moved += Math.hypot(dx, dy);

    if (event.pointerType === 'touch' && touchCount === 2) {
      // Pinch: the midpoint's travel pans and the spread's ratio zooms,
      // both in one move event - the standard two-finger map gesture.
      const mid = midpoint();
      const ratio = bufferRatio();
      if (beforeMid) {
        gestures.panBy(
          (mid.x - beforeMid.x) * ratio,
          (mid.y - beforeMid.y) * ratio,
        );
      }
      const anchor = canvasPoint({ clientX: mid.x, clientY: mid.y });
      const next = pinchZoom(pinchStartScale, pinchStartDistance, spread());
      if (anchor) gestures.zoomAt(anchor.x, anchor.y, next);
      return;
    }

    // One pointer: a pan once the travel says so. The threshold is on
    // TOTAL travel, so a slow deliberate drag cannot sneak under it one
    // pixel at a time.
    if (pointers.size === 1 && moved > DRAG_THRESHOLD_PX) {
      suppressNextClick = true;
      const ratio = bufferRatio();
      gestures.panBy(dx * ratio, dy * ratio);
    }
  });

  const endPointer = (event: PointerEvent): void => {
    longPress.end(event.pointerId);
    if (pointers.delete(event.pointerId) && event.pointerType === 'touch') {
      touchCount = Math.max(0, touchCount - 1);
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const anchor = canvasPoint(event);
      if (!anchor) return;
      gestures.zoomAt(
        anchor.x,
        anchor.y,
        wheelZoom(camera.scale, event.deltaY),
      );
    },
    // Required for `preventDefault` to be legal on a wheel listener:
    // they are passive by default on the document tree.
    { passive: false },
  );

  canvas.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const outcome = handleLeftClick(
      target,
      canvasPoint(event),
      camera.originX,
      camera.originY,
      event.ctrlKey || event.metaKey || additiveMode(),
      camera.scale,
    );
    if (outcome.kind !== 'none' && !outcome.accepted) {
      onCommandRejected(outcome.kind);
    }
  });

  canvas.addEventListener('contextmenu', (event) => {
    canvas.focus();
    handleRightClick(
      target,
      menu,
      event,
      canvasPoint(event),
      camera.originX,
      camera.originY,
      camera.scale,
    );
  });

  const doc = canvas.ownerDocument;
  doc.addEventListener('pointerdown', (event) => {
    // `instanceof Node` rather than a cast: `event.target` is an
    // `EventTarget`, and a pointer-down on something that is not a node -
    // the window itself - must count as outside rather than throw.
    const inside =
      event.target instanceof Node && menuRoot.contains(event.target);
    menu.pointerDown(inside);
  });
  doc.addEventListener('keydown', (event) => {
    menu.handleKey(event.key);
  });
}
