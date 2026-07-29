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

import { KIND_AGENT } from './render/instances.js';
import { screenToWorld } from './render/iso.js';

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
 * The entity standing on `(tileX, tileY)`, or `null` for bare floor.
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

/**
 * The whole of a left click, given the tile it landed on.
 *
 * This exists as its own function so that the composition is testable and
 * not only its three parts: pick, resolve, dispatch is an order that can be
 * got wrong - reading the selection AFTER dispatching a `select`, say, would
 * make the first click on an object direct the sim the player had just
 * stopped looking at. There is no DOM in it, matching how `time-controls.ts`
 * keeps its testable half separate from its wiring.
 *
 * A `null` tile is a click the projection could not place, and it does
 * nothing rather than clearing the selection; see `clientToTile`.
 */
export function handleLeftClick(
  target: InputTarget,
  tile: readonly [number, number] | null,
): void {
  if (tile === null) return;
  const pick = pickAt(target, tile[0], tile[1]);
  dispatch(target, resolveLeftClick(pick, target.selectedIndex()));
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
      clientToTile(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        canvas.width,
        canvas.height,
        originX,
        originY,
      ),
    );
  });

  canvas.addEventListener('contextmenu', (event) => {
    handleRightClick(target, event);
  });
}
