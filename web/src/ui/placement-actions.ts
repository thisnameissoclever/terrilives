import type { PlacementPreview } from '../bridge.js';
import { canvasToClient } from '../input.js';
import { TILE_HALF_HEIGHT, screenX, screenY } from '../render/iso.js';
import type { FurnitureBuilder } from './builder.js';
import type { CompactBuildLayout } from './build-layout.js';
import type { BuyTool } from './buy-tool.js';
import type { FloorTool } from './floor-tool.js';
import { formatFunds } from './game-hud.js';
import type { RoomTool } from './room-tool.js';
import { DOORWAY, OPEN, WALL, WINDOW, type WallTool } from './wall-tool.js';

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

/**
 * The drawing-buffer x of the ghost's art: its centre tile, moved by the
 * sprite's side offset as the placement preview draws it.
 */
export function ghostAnchorX(ghost: GhostFootprint, camera: ActionsCamera, artOffsetX = 0): number {
  const [x, y] = centre(ghost);
  return screenX(x, y, camera.originX, camera.scale) + artOffsetX * camera.scale;
}

/** How far the ghost's art rises above its anchor, and how far its centre sits to one side. */
export interface GhostArt {
  readonly height: number;
  readonly offsetX: number;
}

/** Page areas the contextual controls keep clear of, in client pixels. */
export interface KeepOut {
  /** The desktop sidebar's right edge, or 0 for the bottom dock. */
  readonly left: number;
  /** The world controls and any open Options panel. */
  readonly gearLeft: number;
  readonly gearBottom: number;
  /** Right edge of the world controls. */
  readonly gearRight?: number;
}

export const NO_KEEP_OUT: KeepOut = { left: 0, gearLeft: Number.POSITIVE_INFINITY, gearBottom: 0 };

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

export type ContextSlot = 'top' | 'left' | 'right' | 'bottom';
export type ContextIcon = 'wall' | 'doorway' | 'window' | 'left' | 'right' | 'remove' | 'clear' | 'confirm' | 'corners';
export interface ContextAction {
  readonly id: string;
  readonly label: string;
  readonly slot: ContextSlot;
  readonly enabled: boolean;
  readonly icon?: ContextIcon;
  readonly invoke: () => void;
}
export interface ContextModel {
  readonly tool: 'furniture' | 'buy' | 'walls' | 'room' | 'floors';
  readonly x: number;
  readonly y: number;
  readonly ghost?: PlacementPreview;
  readonly actions: readonly ContextAction[];
}
export interface ContextTools {
  readonly books?: { readonly active: boolean };
  readonly furniture: FurnitureBuilder;
  readonly buy: BuyTool;
  readonly walls: WallTool;
  readonly room: RoomTool;
  readonly floors: FloorTool;
  readonly focusCatalogue: () => void;
  readonly suspended?: () => boolean;
}

/** Presentation reads capabilities; the controllers alone stage game commands. */
export function contextModel(tools: ContextTools): ContextModel | null {
  const { furniture, buy, walls, room, floors } = tools;
  if (tools.books?.active) return null;
  if (!furniture.active || furniture.blocked || tools.suspended?.()) return null;
  const action = (id: string, label: string, slot: ContextSlot, enabled: boolean,
    invoke: () => void, icon?: ContextIcon): ContextAction => ({ id, label, slot, enabled, invoke, icon });
  if (walls.active) {
    const windows = walls.windows;
    const line = windows?.active ? windows.line : walls.line;
    if (!line || walls.blocked) return null;
    const ready = walls.pending === null && windows?.pending == null;
    if (windows?.active) return { tool: 'walls', x: line.x - (line.axis === 0 ? 0.5 : 0), y: line.y - (line.axis === 1 ? 0.5 : 0), actions: [
      action('fit-window', windows.owner ? 'Replace window' : 'Fit window', 'top', windows.canApply(), () => windows.apply(), 'window'),
      ...(windows.owner ? [action('remove-window', 'Remove window', 'top', windows.canRemove(), () => windows.remove(), 'remove')] : []),
      action('wall-controls', 'Wall controls', 'bottom', ready, () => walls.selectWalls(), 'wall'),
      action('clear', 'Clear', 'bottom', ready, () => windows.handleKey('Escape'), 'clear'),
    ] };
    return { tool: 'walls', x: line.x - (line.axis === 0 ? 0.5 : 0), y: line.y - (line.axis === 1 ? 0.5 : 0), actions: [
      action('wall', 'Wall', 'top', walls.canApply(WALL), () => walls.apply(WALL), 'wall'),
      action('doorway', 'Doorway', 'top', walls.canApply(DOORWAY), () => walls.apply(DOORWAY), 'doorway'),
      action('window', windows ? 'Windows' : 'Window', 'top', windows ? ready : walls.canApply(WINDOW),
        () => windows ? walls.selectWindows() : walls.apply(WINDOW), 'window'),
      action('left', 'Rotate counterclockwise', 'left', ready, () => walls.rotate(), 'left'),
      action('right', 'Rotate clockwise', 'right', ready, () => walls.rotate(), 'right'),
      action('remove', 'Remove', 'bottom', walls.canApply(OPEN), () => walls.apply(OPEN), 'remove'),
      action('clear', 'Clear', 'bottom', ready, () => walls.clearSelection(), 'clear'),
    ] };
  }
  if (room.active) {
    if (!room.first || room.blocked) return null;
    const ready = !room.pending;
    const second = room.second ?? room.first;
    return { tool: 'room', x: (room.first[0] + second[0]) / 2, y: (room.first[1] + second[1]) / 2, actions: [
      action('doorway', 'Doorway', 'top', ready && room.second !== null, () => room.chooseDoorway(), 'doorway'),
      action('build', 'Build room', 'top', room.canBuild, () => room.build(), 'confirm'),
      action('corners', 'Corners', 'top', ready, () => room.restartCorners(), 'corners'),
      action('cancel', 'Cancel', 'bottom', ready, () => room.cancel(), 'clear'),
    ] };
  }
  if (floors.active) {
    if (!floors.tile || floors.blocked) return null;
    return { tool: 'floors', x: floors.tile[0], y: floors.tile[1], actions: [
      ...floors.coverings().map((name, index) => action(`floor-${index + 1}`, name, 'top',
        floors.canApplyCovering(index + 1), () => floors.applyCovering(index + 1))),
      action('remove', 'Remove', 'bottom', floors.canApplyCovering(0), () => floors.applyCovering(0), 'remove'),
      action('clear', 'Clear', 'bottom', floors.pending === null, () => floors.clearSelection(), 'clear'),
    ] };
  }
  const buying = buy.active;
  const ghost = buying ? buy.ghost() : furniture.preview;
  if (!ghost || (buying && buy.blocked)) return null;
  const ready = buying ? !buy.pending : !furniture.pending;
  const canRotate = ready && (buying ? buy.canRotate : furniture.canRotate);
  const rotate = (direction: -1 | 1) => buying ? buy.rotate(direction) : furniture.rotate(direction);
  return { tool: buying ? 'buy' : 'furniture', x: ghost.x + (ghost.width - 1) / 2,
    y: ghost.y + (ghost.depth - 1) / 2, ghost, actions: [
      action('confirm', buying ? `Buy · ${formatFunds(buy.chosen?.price ?? 0)}` : 'Confirm', 'top',
        buying ? buy.canBuy : furniture.canConfirm, () => { if (buying) buy.buy(); else furniture.confirm(); }, 'confirm'),
      action('left', 'Rotate counterclockwise', 'left', canRotate, () => rotate(-1), 'left'),
      action('right', 'Rotate clockwise', 'right', canRotate, () => rotate(1), 'right'),
      action(buying ? 'choose' : 'sell', buying ? 'Choose item' : furniture.saleValue === null ? 'Sell' : `Sell for ${formatFunds(furniture.saleValue)}`,
        'bottom', buying ? ready : furniture.canSell, () => { if (buying) tools.focusCatalogue(); else furniture.sell(); }),
      action('cancel', 'Cancel', 'bottom', ready, () => { if (buying) buy.cancel(); else furniture.cancel(); }, 'clear'),
    ] };
}

export interface ContextRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface ContextBounds {
  readonly width: number;
  readonly bottom: number;
  readonly keepOut: KeepOut;
  readonly topRight?: { readonly left: number; readonly bottom: number };
}

/** A bounded layout keeps the entire action surface clear of panels and screen edges. */
export function contextPosition(x: number, top: number, bottom: number, bounds: ContextBounds,
  topHeight: number, bottomHeight: number): ContextRect & { compact: boolean } {
  const gap = 8;
  const left = bounds.keepOut.left + gap;
  const width = Math.max(0, Math.min(320, bounds.width - left - gap));
  let originX = Math.max(left, Math.min(x - width / 2, bounds.width - width - gap));
  let overlapsControls = originX < (bounds.keepOut.gearRight ?? Infinity) + gap
    && originX + width > bounds.keepOut.gearLeft - gap;
  const rightOfControls = (bounds.keepOut.gearRight ?? Infinity) + gap;
  if (overlapsControls && rightOfControls + width <= bounds.width - gap) {
    originX = Math.max(originX, rightOfControls);
    overlapsControls = false;
  }
  const overlapsZoom = bounds.topRight && originX + width > bounds.topRight.left - gap;
  const minY = Math.max(overlapsControls ? bounds.keepOut.gearBottom + gap : gap,
    overlapsZoom ? bounds.topRight!.bottom + gap : gap);
  const available = Math.max(0, bounds.bottom - minY - gap);
  const arcHeight = Math.max(208, bottom - top + topHeight + bottomHeight + 44);
  const compact = arcHeight > available || width < 280;
  const height = compact ? topHeight + Math.max(bottomHeight, 44) + 6 : arcHeight;
  const y = Math.max(minY, Math.min(compact ? top - height - gap : top - topHeight - 22,
    bounds.bottom - height - gap));
  return { x: originX, y, width, height, compact };
}

export interface ContextSurface {
  render(model: ContextModel | null): void;
  place(x: number, top: number, bottom: number, canvasWidth: number, canvasHeight: number): void;
}

/** Changed callbacks invalidate content; camera changes invalidate placement only. */
export class BuildContextActions {
  private dirty = true;
  private model: ContextModel | null = null;
  private scale = NaN;
  private originX = NaN;
  private originY = NaN;
  private width = 0;
  private height = 0;
  constructor(private readonly tools: ContextTools, private readonly surface: ContextSurface,
    private readonly artOf: (ghost: PlacementPreview) => GhostArt) {}
  invalidate(): void { this.dirty = true; }
  frame(camera: ActionsCamera, width: number, height: number): void {
    const changed = this.dirty;
    if (changed) {
      this.dirty = false;
      this.model = contextModel(this.tools);
      this.surface.render(this.model);
    }
    const model = this.model;
    if (!model) return;
    if (!changed && camera.scale === this.scale && camera.originX === this.originX
      && camera.originY === this.originY && width === this.width && height === this.height) return;
    this.scale = camera.scale; this.originX = camera.originX; this.originY = camera.originY;
    this.width = width; this.height = height;
    const floor = screenY(model.x, model.y, camera.originY, camera.scale);
    const art = model.ghost ? this.artOf(model.ghost) : null;
    this.surface.place(model.ghost ? ghostAnchorX(model.ghost, camera, art?.offsetX)
      : screenX(model.x, model.y, camera.originX, camera.scale),
    model.ghost ? ghostAnchorTop(model.ghost, camera, art?.height ?? 0) : floor - 18 * camera.scale,
    floor + 20 * camera.scale, width, height);
  }
}

const ICON_PATHS: Record<ContextIcon, string> = {
  left: 'M3 10a8 8 0 1 1 2 9 M3 4v6h6',
  right: 'M21 10a8 8 0 1 0-2 9 M21 4v6h-6',
  wall: 'M3 4h18v16H3z M3 9h18 M3 15h18 M9 4v5 M15 9v6 M9 15v5',
  doorway: 'M4 21V3h16v18 M9 21V7h6v14',
  window: 'M3 4h18v16H3z M12 4v16 M3 12h18',
  remove: 'm3 14 9-11 9 8-9 10H9z M9 21h12',
  clear: 'm5 5 14 14 M19 5 5 19',
  confirm: 'm4 12 5 5L20 6',
  corners: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
};

export function createContextSurface(doc: Document, root: HTMLElement, canvas: HTMLCanvasElement,
  bounds: () => ContextBounds, invalidate: () => void, layout?: CompactBuildLayout,
  shiftAnchor?: (dx: number, dy: number) => void): ContextSurface {
  const groups = new Map<ContextSlot, HTMLElement>();
  for (const slot of ['top', 'left', 'right', 'bottom'] as const) {
    const group = doc.createElement('div'); group.className = `context-${slot}`;
    root.append(group); groups.set(slot, group);
  }
  let actions: readonly ContextAction[] = [];
  let key = '';
  root.setAttribute('aria-label', 'Build actions for the current selection');
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-context-action]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const action = actions.find(candidate => candidate.id === button.dataset.contextAction);
    if (action?.enabled) action.invoke();
  });
  root.addEventListener('pointerdown', event => {
    if ((event.target as Element).closest('button')) event.stopPropagation();
  });
  // Content and panel sizes change without a window resize, including enlarged text.
  const observer = new ResizeObserver(invalidate);
  for (const id of ['hud', 'builder-controls', 'builder-dock', 'options-panel']) {
    const element = doc.getElementById(id); if (element) observer.observe(element);
  }
  const options = doc.getElementById('options-panel');
  if (options) new MutationObserver(invalidate).observe(options, { attributes: true, attributeFilter: ['hidden'] });
  const buttons = new Map<string, HTMLButtonElement>();
  const keepSelectionVisible = (x: number, y: number, left: number, right: number, top: number, bottom: number): void => {
    const targetX = Math.max(left, Math.min(x, right));
    const targetY = Math.max(top, Math.min(y, bottom));
    if (Math.abs(targetX - x) > 1 || Math.abs(targetY - y) > 1) shiftAnchor?.(targetX - x, targetY - y);
  };
  return {
    render(model) {
      const active = doc.activeElement;
      const next = model?.actions ?? [];
      const focused = active instanceof HTMLButtonElement && root.contains(active)
        ? next.find(action => action.id === active.dataset.contextAction) : null;
      if (root.contains(active) && (!model || !focused?.enabled || root.dataset.tool !== model.tool)) canvas.focus();
      root.hidden = model === null;
      if (!model || root.dataset.tool !== model.tool) layout?.setRows(false);
      actions = next;
      if (!model) return;
      root.dataset.tool = model.tool;
      const nextKey = `${model.tool}:${next.map(action => `${action.id}:${action.slot}`).join(',')}`;
      if (key !== nextKey) {
        key = nextKey; buttons.clear();
        for (const group of groups.values()) group.replaceChildren();
        for (const action of next) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'hud-button';
          button.dataset.contextAction = action.id;
          if (action.icon) {
            const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
            const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', ICON_PATHS[action.icon]);
            svg.append(path); button.append(svg);
          }
          const label = doc.createElement('span'); button.append(label);
          groups.get(action.slot)!.append(button); buttons.set(action.id, button);
        }
      }
      for (const action of next) {
        const button = buttons.get(action.id)!;
        button.disabled = !action.enabled;
        button.setAttribute('aria-label', action.label);
        const label = button.querySelector('span')!;
        if (label.textContent !== action.label) label.textContent = action.label;
      }
    },
    place(x, top, bottom, width, height) {
      const rect = canvas.getBoundingClientRect();
      const anchor = canvasToClient(x, top, rect, width, height);
      const floor = canvasToClient(x, bottom, rect, width, height);
      if (!anchor || !floor) return;
      let limits = bounds();
      const initial = contextPosition(anchor.x, anchor.y, floor.y, limits, 0, 0);
      root.style.width = `${initial.width}px`;
      root.dataset.compact = 'false';
      const topHeight = groups.get('top')!.offsetHeight;
      const bottomHeight = groups.get('bottom')!.offsetHeight;
      let at = contextPosition(anchor.x, anchor.y, floor.y, limits, topHeight, bottomHeight);
      if (layout?.enabled && (at.compact || layout.rows)) {
        layout.setRows(true);
        root.dataset.compact = 'true';
        root.style.left = ''; root.style.top = ''; root.style.height = 'auto';
        const availableWidth = doc.documentElement.clientWidth - 16;
        root.style.width = `${doc.documentElement.clientHeight <= 480 ? availableWidth : Math.min(320, availableWidth)}px`;
        const area = layout.freeArea();
        if (area) {
          const midY = (anchor.y + floor.y) / 2;
          keepSelectionVisible(anchor.x, midY, area.left + 8, area.right - 8, area.top + 8, area.bottom - 8);
        }
        return;
      }
      if (layout?.setRows(false)) {
        limits = bounds();
        at = contextPosition(anchor.x, anchor.y, floor.y, limits, topHeight, bottomHeight);
      }
      if (at.compact) {
        root.dataset.compact = 'true';
        at = contextPosition(anchor.x, anchor.y, floor.y, limits,
          groups.get('top')!.offsetHeight, groups.get('bottom')!.offsetHeight);
      }
      root.dataset.compact = String(at.compact);
      root.style.left = `${at.x}px`; root.style.top = `${at.y}px`;
      root.style.width = `${at.width}px`; root.style.height = `${at.height}px`;
      if (!at.compact) keepSelectionVisible(anchor.x, (anchor.y + floor.y) / 2,
        at.x + 60, at.x + at.width - 60, at.y + topHeight + 28, at.y + at.height - bottomHeight - 8);
    },
  };
}
