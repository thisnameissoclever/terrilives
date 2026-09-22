import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlacementPreview } from '../src/bridge.js';
import { canvasToClient, clientToCanvas } from '../src/input.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from '../src/render/iso.js';
import {
  BUY, CONFIRM, PlacementActions, focusLeavesPair, ghostAnchorTop, ghostAnchorX, placementActionsPosition,
  type BuyActionsSource, type FurnitureActionsSource, type PlacementActionsSurface,
} from '../src/ui/placement-actions.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

// [PA-place] in docs/specs/2026-09-22-placement-buttons.md.
describe('canvasToClient', () => {
  const rect = { left: 10, top: 20, width: 640, height: 360 };

  it('maps the drawing buffer back to client pixels at any device pixel ratio', () => {
    expect(canvasToClient(0, 0, rect, 640, 360)).toEqual({ x: 10, y: 20 });
    // A ratio of 2: the buffer is twice the CSS size, so a point halves.
    expect(canvasToClient(200, 100, rect, 1280, 720)).toEqual({ x: 110, y: 70 });
    // A ratio of 3, as on many phones.
    expect(canvasToClient(300, 90, rect, 1920, 1080)).toEqual({ x: 110, y: 50 });
  });

  it('is the exact inverse of clientToCanvas', () => {
    const client = canvasToClient(417, 233, rect, 1280, 720)!;
    const back = clientToCanvas(client.x, client.y, rect, 1280, 720)!;
    expect(back.x).toBeCloseTo(417, 9);
    expect(back.y).toBeCloseTo(233, 9);
  });

  it('has no answer for a canvas with no size', () => {
    expect(canvasToClient(1, 1, { ...rect, width: 0 }, 640, 360)).toBeNull();
    expect(canvasToClient(1, 1, rect, 0, 360)).toBeNull();
  });
});

describe('where the buttons go', () => {
  const ghost = { x: 2, y: 3, width: 2, depth: 1 };

  it("anchors on the top of the ghost's art, where the shader stands it, scaled with the camera", () => {
    // Centre (2.5, 3): x = (2.5 - 3) * half width + origin. The tile's point
    // is 5.5 half heights down; the art's base half a tile lower, at 6.5,
    // and its top 30 above that.
    const one = { scale: 1, originX: 100, originY: 50 };
    expect(ghostAnchorX(ghost, one)).toBe(-0.5 * TILE_HALF_WIDTH + 100);
    expect(ghostAnchorTop(ghost, one, 30)).toBe(6.5 * TILE_HALF_HEIGHT + 50 - 30);
    const two = { scale: 2, originX: 100, originY: 50 };
    expect(ghostAnchorX(ghost, two)).toBe(-1 * TILE_HALF_WIDTH + 100);
    expect(ghostAnchorTop(ghost, two, 30)).toBe(13 * TILE_HALF_HEIGHT + 50 - 60);
    // The art's side offset moves the centre, scaled like everything else.
    expect(ghostAnchorX(ghost, two, 5)).toBe(-1 * TILE_HALF_WIDTH + 100 + 10);
  });

  it('stays right of the desktop sidebar and below the gear, but inside the window', () => {
    const keepOut = { left: 240, gearLeft: 740, gearBottom: 60 };
    // Under the sidebar: pushed right of it.
    expect(placementActionsPosition(200, 300, 150, 44, 800, 600, keepOut)).toEqual({ x: 248, y: 248 });
    // Up under the gear: slid left of it, still above the ghost.
    expect(placementActionsPosition(760, 40, 150, 44, 800, 600, keepOut)).toEqual({ x: 582, y: 8 });
    // Up at the top but clear of the gear: left where it is.
    expect(placementActionsPosition(400, 40, 150, 44, 800, 600, keepOut)).toEqual({ x: 325, y: 8 });
    // No room left of the gear: dropped below it, and kept inside the window.
    const narrow = { left: 600, gearLeft: 740, gearBottom: 60 };
    expect(placementActionsPosition(760, 40, 150, 44, 800, 600, narrow)).toEqual({ x: 642, y: 68 });
    expect(placementActionsPosition(760, 40, 150, 44, 800, 100, narrow)).toEqual({ x: 642, y: 48 });
    // A sidebar wider than the window leaves room for: never past the right edge.
    expect(placementActionsPosition(200, 300, 150, 44, 800, 600, { ...keepOut, left: 700 }).x).toBe(642);
  });

  it('centres the box above the anchor with a gap, inside the window and above the dock', () => {
    expect(placementActionsPosition(200, 300, 150, 44, 800, 600)).toEqual({ x: 125, y: 248 });
    // Pushed in from the left and top edges, by the eight-pixel margin.
    expect(placementActionsPosition(20, 10, 150, 44, 800, 600)).toEqual({ x: 8, y: 8 });
    // A phone's Build dock starts at 464 on an 844-tall screen: the box
    // stays above it even when the ghost is behind the dock.
    expect(placementActionsPosition(187, 700, 150, 44, 375, 464)).toEqual({ x: 112, y: 412 });
  });
});

const preview = (over: Partial<PlacementPreview> = {}): PlacementPreview => ({
  valid: true, reason: null, x: 4, y: 5, facing: 0, width: 1, depth: 1, sprite: 7, foreground: null,
  ...over,
} as PlacementPreview);

class FakeFurniture implements FurnitureActionsSource {
  active = true;
  preview: PlacementPreview | null = null;
  canConfirm = false;
  selected: number | null = null;
  pending = false;
  blocked = false;
  confirmed = 0;
  cancelled = 0;
  confirm() { this.confirmed += 1; return true; }
  cancel() { this.cancelled += 1; }
}

class FakeBuy implements BuyActionsSource {
  active = false;
  canBuy = false;
  chosen: unknown = null;
  pending = false;
  blocked = false;
  shown: PlacementPreview | null = null;
  bought = 0;
  cancelled = 0;
  ghost() { return this.active ? this.shown : null; }
  buy() { this.bought += 1; }
  cancel() { this.cancelled += 1; }
}

function actions() {
  const calls: string[] = [];
  const surface: PlacementActionsSurface = {
    setState: (visible, label, confirm, cancel) => calls.push(`state ${visible} ${label} ${confirm} ${cancel}`),
    place: (x, top, w, h) => calls.push(`place ${x} ${top} ${w} ${h}`),
  };
  const furniture = new FakeFurniture();
  const buy = new FakeBuy();
  const placement = new PlacementActions(surface, furniture, buy,
    (ghost) => ({ height: ghost.sprite * 10 + (ghost.foreground ?? 0), offsetX: 0 }));
  const camera = { scale: 1, originX: 0, originY: 0 };
  return { calls, furniture, buy, placement, camera };
}

describe('PlacementActions', () => {
  it('stays hidden with nothing lifted, and says so once', () => {
    const { calls, placement, camera } = actions();
    placement.frame(camera, 800, 600);
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([]);
  });

  it('shows Confirm and Cancel over a lifted piece, enabled as the Build panel enables them', () => {
    const { calls, furniture, placement, camera } = actions();
    furniture.preview = preview();
    furniture.selected = 12;
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([
      `state true ${CONFIRM} false true`,
      `place ${ghostAnchorX(furniture.preview, camera)} ${ghostAnchorTop(furniture.preview, camera, 70)} 800 600`,
    ]);
    calls.length = 0;
    furniture.canConfirm = true;
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([`state true ${CONFIRM} true true`]);
    calls.length = 0;
    furniture.pending = true;
    furniture.canConfirm = false;
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([`state true ${CONFIRM} false false`]);
  });

  it('writes nothing on a steady frame, places again when the view or the ghost moves', () => {
    const { calls, furniture, placement, camera } = actions();
    furniture.preview = preview();
    placement.frame(camera, 800, 600);
    calls.length = 0;
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([]);
    placement.frame({ ...camera, originX: 5 }, 800, 600);
    placement.frame({ ...camera, originX: 5, scale: 2 }, 800, 600);
    placement.frame({ ...camera, originX: 5, scale: 2 }, 800, 700);
    furniture.preview = preview({ x: 5 });
    placement.frame({ ...camera, originX: 5, scale: 2 }, 800, 700);
    expect(calls.filter((call) => call.startsWith('place'))).toHaveLength(4);
    expect(calls.filter((call) => call.startsWith('state'))).toHaveLength(0);
    calls.length = 0;
    placement.invalidate();
    placement.frame({ ...camera, originX: 5, scale: 2 }, 800, 700);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['its width', (p: PlacementPreview) => ({ ...p, width: 2 })],
    ['its depth', (p: PlacementPreview) => ({ ...p, depth: 2 })],
    ['its sprite, as a turn changes it', (p: PlacementPreview) => ({ ...p, sprite: 8 })],
    ['its foreground layer', (p: PlacementPreview) => ({ ...p, foreground: 9 })],
    ['its y', (p: PlacementPreview) => ({ ...p, y: 6 })],
  ])('places again when the ghost changes %s', (_label, change) => {
    const { calls, furniture, placement, camera } = actions();
    furniture.preview = preview();
    placement.frame(camera, 800, 600);
    calls.length = 0;
    furniture.preview = change(furniture.preview);
    placement.frame(camera, 800, 600);
    expect(calls.filter((call) => call.startsWith('place'))).toHaveLength(1);
  });

  it("places again when the view moves up or down, or the buffer's width changes", () => {
    const { calls, furniture, placement, camera } = actions();
    furniture.preview = preview();
    placement.frame(camera, 800, 600);
    calls.length = 0;
    placement.frame({ ...camera, originY: 7 }, 800, 600);
    placement.frame({ ...camera, originY: 7 }, 900, 600);
    expect(calls.filter((call) => call.startsWith('place'))).toHaveLength(2);
  });

  it('turns Cancel off as the Build panel does, for either tool', () => {
    const { calls, furniture, buy, placement, camera } = actions();
    furniture.preview = preview();
    furniture.selected = 3;
    furniture.blocked = true;
    placement.frame(camera, 800, 600);
    expect(calls[0]).toBe(`state true ${CONFIRM} false false`);
    buy.active = true;
    buy.shown = preview();
    buy.chosen = { id: 'chair' };
    // Each term alone turns Cancel off from an enabled start, so deleting
    // any one of them leaves Cancel on and fails its step.
    const enabled = () => { buy.pending = false; buy.blocked = false; buy.chosen = { id: 'chair' }; };
    for (const turnOff of [
      () => { buy.pending = true; },
      () => { buy.blocked = true; },
      () => { buy.chosen = null; },
    ]) {
      enabled();
      placement.frame(camera, 800, 600);
      expect(calls.filter((call) => call.startsWith('state')).at(-1)).toBe(`state true ${BUY} false true`);
      calls.length = 0;
      turnOff();
      placement.frame(camera, 800, 600);
      expect(calls).toEqual([`state true ${BUY} false false`]);
    }
  });

  it('relabels when the tool changes, with the ghost where it was', () => {
    const { calls, furniture, buy, placement, camera } = actions();
    const same = preview();
    furniture.preview = same;
    placement.frame(camera, 800, 600);
    calls.length = 0;
    buy.active = true;
    buy.shown = same;
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([`state true ${BUY} false false`]);
  });

  it('hides when the piece is put down, and places again when the next one is lifted', () => {
    const { calls, furniture, placement, camera } = actions();
    furniture.preview = preview();
    placement.frame(camera, 800, 600);
    furniture.preview = null;
    placement.frame(camera, 800, 600);
    furniture.preview = preview();
    calls.length = 0;
    placement.frame(camera, 800, 600);
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['state', 'place']);
  });

  it('reads Buy for a purchase and sends each press to the tool in use', () => {
    const { calls, furniture, buy, placement, camera } = actions();
    furniture.preview = preview();
    buy.active = true;
    buy.shown = preview({ sprite: 3 });
    buy.chosen = { id: 'chair' };
    buy.canBuy = true;
    placement.frame(camera, 800, 600);
    expect(calls[0]).toBe(`state true ${BUY} true true`);
    placement.confirm();
    placement.cancel();
    expect([buy.bought, buy.cancelled, furniture.confirmed, furniture.cancelled]).toEqual([1, 1, 0, 0]);
    buy.active = false;
    furniture.canConfirm = true;
    placement.confirm();
    placement.cancel();
    expect([furniture.confirmed, furniture.cancelled]).toEqual([1, 1]);
  });

  it('moves focus off a button before it hides or turns off, and only then', () => {
    expect(focusLeavesPair(null, false, false, false)).toBe(false);
    expect(focusLeavesPair('confirm', false, true, true)).toBe(true);
    expect(focusLeavesPair('confirm', true, false, true)).toBe(true);
    expect(focusLeavesPair('confirm', true, true, false)).toBe(false);
    expect(focusLeavesPair('cancel', true, true, false)).toBe(true);
    expect(focusLeavesPair('cancel', true, false, true)).toBe(false);
  });

  it('does not confirm a piece the Build panel could not confirm', () => {
    const { furniture, placement } = actions();
    furniture.preview = preview({ valid: false });
    placement.confirm();
    expect(furniture.confirmed).toBe(0);
  });

  it('shows nothing for the Furniture tool once Build has ended', () => {
    const { calls, furniture, placement, camera } = actions();
    furniture.active = false;
    furniture.preview = preview();
    placement.frame(camera, 800, 600);
    expect(calls).toEqual([]);
  });
});

describe('the placement buttons in the page', () => {
  it('sit outside the sidebar and the Build dock, fixed, letting clicks through the box', () => {
    for (const id of ['placement-actions', 'placement-confirm', 'placement-cancel']) {
      expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    }
    expect(INDEX_HTML).toContain('<div id="placement-actions" hidden>');
    const at = INDEX_HTML.indexOf('id="placement-actions"');
    expect(at).toBeGreaterThan(INDEX_HTML.indexOf('<div id="builder-dock">'));
    const box = INDEX_HTML.slice(INDEX_HTML.indexOf('      #placement-actions {'));
    const rule = box.slice(0, box.indexOf('}'));
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('pointer-events: none');
    expect(INDEX_HTML).toMatch(/#placement-actions \.hud-button \{[^}]*pointer-events: auto;[^}]*min-height: 44px;/);
    expect(INDEX_HTML).toMatch(/#placement-actions\[hidden\] \{\s*display: none;\s*\}/);
  });

  it('are wired into the frame after the camera, and re-placed on resize', () => {
    const camera = MAIN_TS.indexOf('if (cameraDirty) applyCamera();');
    const frame = MAIN_TS.indexOf('placementButtons.frame(camera, stage.width, stage.height);');
    expect(frame).toBeGreaterThan(camera);
    expect(MAIN_TS).toContain('placementActions?.invalidate();');
    // Each tool's change can change the phone dock's height.
    expect(MAIN_TS.split('placementActions?.invalidate();')).toHaveLength(4);
    expect(MAIN_TS).toContain('dockTop, placementKeepOut,');
    expect(MAIN_TS).toContain('new PlacementActions(');
    // Furniture's art top comes from its content bounds, not the people-only table.
    const start = MAIN_TS.indexOf('new PlacementActions(');
    const built = MAIN_TS.slice(start, MAIN_TS.indexOf('\n  );', start));
    expect(built).toContain('spriteFramingHeight(ghost.sprite)');
    expect(built).toContain('spriteFramingHeight(ghost.foreground)');
    expect(built).toContain('offsetX: spriteDrawOffsetX(ghost.sprite)');
    expect(built).not.toContain('spriteContentLift');
  });
});
