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
 * module can do is enqueue a command, which `drain_commands` applies at one
 * fixed point in the tick. That is what keeps a recorded session replayable
 * and is what a Layer 2 client would send over a wire.
 */

import { SPRITES } from './render/atlas.js';
import { KIND_AGENT } from './render/instances.js';
import {
  LAYER_PROP,
  LAYER_SIM,
  TILE_HALF_HEIGHT,
  screenToWorld,
  screenX,
  screenY,
} from './render/iso.js';

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
  | { readonly kind: 'use'; readonly agent: number; readonly object: number }
  | { readonly kind: 'none' };

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
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bufferX = ((clientX - rect.left) * canvasWidth) / rect.width;
  const bufferY = ((clientY - rect.top) * canvasHeight) / rect.height;
  const [wx, wy] = screenToWorld(bufferX, bufferY, originX, originY);
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
): Pick | null {
  const count = source.count;
  const positions = source.positions();
  const kinds = source.kinds();
  const ids = source.ids();
  const spriteIndices = source.sprites();

  let best: Pick | null = null;
  let bestNearness = -Infinity;
  let bestLayer = -Infinity;

  for (let row = 0; row < count; row++) {
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
    const anchorX = screenX(wx, wy, originX);
    const anchorY = screenY(wx, wy, originY) + TILE_HALF_HEIGHT;
    const left = anchorX - sprite.w / 2;
    const top = anchorY - sprite.h;
    if (px < left || px > left + sprite.w) continue;
    if (py < top || py > anchorY) continue;

    const nearness = wx + wy;
    // The renderer's own layer constants rather than 1 and 0, so that swapping
    // them in `iso.ts` moves the drawn order and the hit order together. Two
    // hand-written numbers here would leave picking silently disagreeing with
    // what is on top.
    const layer = kinds[row] === KIND_AGENT ? LAYER_SIM : LAYER_PROP;
    // Strictly greater on both, so an equal-depth equal-layer tie keeps the
    // EARLIER row - the one that won the pixel.
    if (nearness > bestNearness || (nearness === bestNearness && layer > bestLayer)) {
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

  let object: Pick | null = null;
  for (let row = 0; row < count; row++) {
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
 * - An object with a sim selected: direct that sim to use it. Repeated
 *   clicks queue, up to `max_queued_intents`.
 * - An object with nothing selected: nothing. There is no sim to direct,
 *   and selecting furniture is not a thing the game has a meaning for.
 * - Bare floor or a wall: clear the selection.
 *
 * **Empty floor clearing the selection is a choice, not a fallback.** It is
 * the only way the player can reach `Select(None)`, and the alternative -
 * ignoring the click - leaves no way to put the need panel away. The cost
 * is that a near-miss on a sim deselects it; the play notes are where that
 * gets judged.
 *
 * Directing does NOT change the selection, so a player can click three
 * objects in a row and queue all three for the sim they are watching.
 */
export function resolveLeftClick(
  pick: Pick | null,
  selected: number | null,
): ClickAction {
  if (pick === null) return { kind: 'select', entity: null };
  if (pick.isAgent) return { kind: 'select', entity: pick.entity };
  if (selected === null) return { kind: 'none' };
  return { kind: 'use', agent: selected, object: pick.entity };
}

/** The subset of `SimBridge` the click handler dispatches through. */
export interface CommandSink {
  select(entityIndex: number | null): boolean;
  useObject(agent: number, object: number): boolean;
  cancelIntents(agent: number): boolean;
  selectedIndex(): number | null;
}

/** Applies a resolved action. Separated so the resolution can be tested without a bridge. */
export function dispatch(sink: CommandSink, action: ClickAction): void {
  switch (action.kind) {
    case 'select':
      sink.select(action.entity);
      break;
    case 'use':
      sink.useObject(action.agent, action.object);
      break;
    case 'none':
      break;
  }
}

/** Everything a click handler needs of its sim: pick from it, command it. */
export type InputTarget = CommandSink & PickSource;

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
): void {
  if (point === null) return;
  const pick = pickSprite(target, point.x, point.y, originX, originY);
  dispatch(target, resolveLeftClick(pick, target.selectedIndex()));
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

/** Anything that can suppress its own default action. `MouseEvent` satisfies it. */
export interface Cancellable {
  preventDefault(): void;
}

/**
 * The whole of a right click: **hand the selected sim back to its own
 * judgement**, and never let the browser menu open over the lot.
 *
 * Without a binding for `CancelIntents` there is no way to stop directing a
 * sim short of waiting out its queue, and "can I give it back" is one of the
 * questions the play session exists to answer.
 *
 * `preventDefault` runs first and unconditionally, before the selection is
 * even read. A right click that does nothing is fine; one that opens the
 * context menu over the game is not, and the version of this that checks the
 * selection first pops the menu whenever nothing is selected.
 */
export function handleRightClick(
  target: InputTarget,
  event: Cancellable,
): void {
  event.preventDefault();
  const selected = target.selectedIndex();
  if (selected !== null) target.cancelIntents(selected);
}

/**
 * Wires the canvas to the two handlers above. The only function here that
 * needs a DOM, and therefore the only one with no test - the same division
 * `buildTimeControls` draws, where the list it builds from is tested and the
 * `addEventListener` calls are not.
 *
 * `contextmenu` is the right-click event rather than `mousedown` with
 * `button === 2`, because it is the one the browser menu hangs off: handling
 * the other and not this one pops the menu over the lot on every cancel.
 *
 * The handlers read `originX`/`originY` from the closure. Both are derived
 * from the lot at load and neither changes for the session; a camera that
 * pans would have to make them live, and that is the one thing to change
 * here when it does.
 */
export function attachPointerInput(
  canvas: HTMLCanvasElement,
  target: InputTarget,
  originX: number,
  originY: number,
): void {
  canvas.addEventListener('click', (event) => {
    handleLeftClick(
      target,
      clientToCanvas(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        canvas.width,
        canvas.height,
      ),
      originX,
      originY,
    );
  });

  canvas.addEventListener('contextmenu', (event) => {
    handleRightClick(target, event);
  });
}
