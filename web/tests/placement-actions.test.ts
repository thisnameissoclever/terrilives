import { describe, expect, it } from 'vitest';
import { canvasToClient, clientToCanvas } from '../src/input.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from '../src/render/iso.js';
import {
  ghostAnchorTop, ghostAnchorX,
} from '../src/ui/placement-actions.js';

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

});
