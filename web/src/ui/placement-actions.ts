/**
 * Confirm and Cancel over the piece being placed - [PA-show] and [PA-place]
 * in `docs/specs/2026-09-22-placement-buttons.md`. While the Furniture tool
 * has a piece lifted, or the Buy tool has one chosen, two buttons float in
 * the game view just above the ghost's body and follow it as the view pans
 * and zooms. They do what the Build panel's own pair does, through the same
 * tool methods, so the two pairs cannot disagree.
 *
 * The decisions are here and tested; the DOM writes are in
 * `createPlacementActionsSurface`, which the tests never build, as with the
 * right-click flyout's surface.
 */
import type { PlacementPreview } from '../bridge.js';
import { canvasToClient } from '../input.js';
import { TILE_HALF_HEIGHT, screenX, screenY } from '../render/iso.js';
import { clampMenuPosition, type MenuPosition } from './object-menu.js';

/** The ghost's tile footprint: its north-west corner and its size. */
export interface GhostFootprint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
}

export interface ActionsCamera {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

/** The ghost body's centre tile, where the placement preview draws it. */
function centre(ghost: GhostFootprint): [number, number] {
  return [ghost.x + (ghost.width - 1) / 2, ghost.y + (ghost.depth - 1) / 2];
}

/** The drawing-buffer x of the ghost body's centre. */
export function ghostAnchorX(ghost: GhostFootprint, camera: ActionsCamera): number {
  const [x, y] = centre(ghost);
  return screenX(x, y, camera.originX, camera.scale);
}

/**
 * The drawing-buffer y of the top of the ghost's visible art. The shader
 * stands a sprite's anchor half a tile below its point, on the diamond's
 * south corner, and the art rises `artHeight` above the anchor; picking in
 * `input.ts` does the same arithmetic. Every distance scales with the camera,
 * so the buttons sit on a zoomed piece rather than sinking into it or
 * floating over it.
 */
export function ghostAnchorTop(ghost: GhostFootprint, camera: ActionsCamera, artHeight: number): number {
  const [x, y] = centre(ghost);
  return screenY(x, y, camera.originY, camera.scale) + (TILE_HALF_HEIGHT - artHeight) * camera.scale;
}

/**
 * Where the buttons' box goes, in client pixels: centred over the anchor and
 * `gap` pixels above it, kept inside the window's width and above
 * `viewportBottom`, the top of the phone's Build dock when it shows.
 */
export function placementActionsPosition(
  anchorClientX: number,
  anchorClientY: number,
  buttonsWidth: number,
  buttonsHeight: number,
  viewportWidth: number,
  viewportBottom: number,
  gap = 8,
): MenuPosition {
  return clampMenuPosition(
    anchorClientX - buttonsWidth / 2,
    anchorClientY - buttonsHeight - gap,
    buttonsWidth,
    buttonsHeight,
    viewportWidth,
    viewportBottom,
  );
}

/** What the buttons read from the Furniture tool. */
export interface FurnitureActionsSource {
  readonly active: boolean;
  readonly preview: PlacementPreview | null;
  readonly canConfirm: boolean;
  readonly selected: number | null;
  readonly pending: boolean;
  readonly blocked: boolean;
  confirm(): unknown;
  cancel(): void;
}

/** What the buttons read from the Buy tool. */
export interface BuyActionsSource {
  readonly active: boolean;
  readonly canBuy: boolean;
  readonly chosen: unknown;
  readonly pending: boolean;
  readonly blocked: boolean;
  ghost(): PlacementPreview | null;
  buy(): void;
  cancel(): void;
}

/** The DOM half. `place` measures and writes; it is called only on a change. */
export interface PlacementActionsSurface {
  setState(visible: boolean, confirmLabel: string, confirmEnabled: boolean, cancelEnabled: boolean): void;
  place(anchorBufferX: number, anchorBufferTop: number, canvasWidth: number, canvasHeight: number): void;
}

export const CONFIRM = 'Confirm';
export const BUY = 'Buy';

/**
 * Shows, labels and places the two buttons once a frame. Every input is
 * kept as a plain number, and the surface is called only when one changes,
 * so a steady frame allocates nothing and touches no layout ([D11]).
 */
export class PlacementActions {
  private visible = false;
  private buying = false;
  private confirmEnabled = false;
  private cancelEnabled = false;
  private dirty = true;
  private x = Number.NaN;
  private y = Number.NaN;
  private width = 0;
  private depth = 0;
  private sprite = -1;
  private scale = Number.NaN;
  private originX = Number.NaN;
  private originY = Number.NaN;
  private canvasWidth = 0;
  private canvasHeight = 0;

  constructor(
    private readonly surface: PlacementActionsSurface,
    private readonly furniture: FurnitureActionsSource,
    private readonly buyTool: BuyActionsSource,
    private readonly spriteLift: (sprite: number) => number,
  ) {}

  /** The next frame places the buttons again: the window changed size. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Does what the Build panel's Confirm or Buy does, for the tool in use. */
  confirm(): void {
    if (this.buyTool.active) this.buyTool.buy();
    else if (this.furniture.canConfirm) this.furniture.confirm();
  }

  /** Does what the Build panel's Cancel does, for the tool in use. */
  cancel(): void {
    if (this.buyTool.active) this.buyTool.cancel();
    else this.furniture.cancel();
  }

  frame(camera: ActionsCamera, canvasWidth: number, canvasHeight: number): void {
    const buying = this.buyTool.active;
    const ghost = buying ? this.buyTool.ghost() : this.furniture.active ? this.furniture.preview : null;
    const visible = ghost !== null;
    const confirmEnabled = buying ? this.buyTool.canBuy : this.furniture.canConfirm;
    const cancelEnabled = buying
      ? this.buyTool.chosen !== null && !this.buyTool.pending && !this.buyTool.blocked
      : this.furniture.selected !== null && !this.furniture.pending && !this.furniture.blocked;
    const appeared = visible && !this.visible;
    if (visible !== this.visible || buying !== this.buying
      || confirmEnabled !== this.confirmEnabled || cancelEnabled !== this.cancelEnabled) {
      this.visible = visible;
      this.buying = buying;
      this.confirmEnabled = confirmEnabled;
      this.cancelEnabled = cancelEnabled;
      this.surface.setState(visible, buying ? BUY : CONFIRM, confirmEnabled, cancelEnabled);
    }
    if (ghost === null) return;
    if (appeared || this.dirty || ghost.x !== this.x || ghost.y !== this.y || ghost.width !== this.width
      || ghost.depth !== this.depth || ghost.sprite !== this.sprite || camera.scale !== this.scale
      || camera.originX !== this.originX || camera.originY !== this.originY
      || canvasWidth !== this.canvasWidth || canvasHeight !== this.canvasHeight) {
      this.dirty = false;
      this.x = ghost.x;
      this.y = ghost.y;
      this.width = ghost.width;
      this.depth = ghost.depth;
      this.sprite = ghost.sprite;
      this.scale = camera.scale;
      this.originX = camera.originX;
      this.originY = camera.originY;
      this.canvasWidth = canvasWidth;
      this.canvasHeight = canvasHeight;
      this.surface.place(ghostAnchorX(ghost, camera), ghostAnchorTop(ghost, camera, this.spriteLift(ghost.sprite)),
        canvasWidth, canvasHeight);
    }
  }
}

/**
 * The untested DOM half: wires the clicks, writes `hidden`, the label and
 * `disabled`, and measures the canvas and its own box only when asked to
 * place itself. When it hides while holding focus it hands focus to the
 * game view, so focus never lands on a hidden button.
 */
export function createPlacementActionsSurface(
  doc: Document,
  root: HTMLElement,
  confirmButton: HTMLButtonElement,
  cancelButton: HTMLButtonElement,
  canvas: HTMLCanvasElement,
  viewportBottom: () => number,
  onConfirm: () => void,
  onCancel: () => void,
): PlacementActionsSurface {
  confirmButton.addEventListener('click', onConfirm);
  cancelButton.addEventListener('click', onCancel);
  return {
    setState(visible, confirmLabel, confirmEnabled, cancelEnabled) {
      if (!visible && root.contains(doc.activeElement)) canvas.focus();
      root.hidden = !visible;
      confirmButton.textContent = confirmLabel;
      confirmButton.disabled = !confirmEnabled;
      cancelButton.disabled = !cancelEnabled;
    },
    place(anchorBufferX, anchorBufferTop, canvasWidth, canvasHeight) {
      const client = canvasToClient(anchorBufferX, anchorBufferTop, canvas.getBoundingClientRect(),
        canvasWidth, canvasHeight);
      if (client === null) return;
      const at = placementActionsPosition(client.x, client.y, root.offsetWidth, root.offsetHeight,
        doc.documentElement.clientWidth, viewportBottom());
      root.style.left = `${at.x}px`;
      root.style.top = `${at.y}px`;
    },
  };
}
