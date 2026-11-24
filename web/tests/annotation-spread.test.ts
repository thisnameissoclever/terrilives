import { describe, expect, it } from 'vitest';
import { AnnotationSpread, type ControlRects } from '../src/render/annotation-spread.js';
import { SPRITES, spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_SPRITE } from '../src/render/instances.js';
import { TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { toCanvasRects } from '../src/ui/bubble-controls.js';

const BUBBLE = spriteIndex('conversationTalkLike');
const WIDTH = SPRITES[BUBBLE].w / (SPRITES[BUBBLE].pixel_density ?? 1);
const HEIGHT = SPRITES[BUBBLE].h / (SPRITES[BUBBLE].pixel_density ?? 1);
const VIEW = 1000;
const NONE: ControlRects = { rects: new Float64Array(0), count: 0 };

function controls(...rects: [number, number, number, number][]): ControlRects {
  return { rects: new Float64Array(rects.flat()), count: rects.length };
}

function bubbles(...positions: [number, number][]): Float32Array {
  const out = new Float32Array(positions.length * FLOATS_PER_INSTANCE);
  positions.forEach(([x, y], i) => {
    out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X] = x;
    out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y] = y;
    out[i * FLOATS_PER_INSTANCE + OFFSET_SPRITE] = BUBBLE;
  });
  return out;
}
function spread(out: Float32Array, given = NONE, start = 0, count = out.length / FLOATS_PER_INSTANCE - start, ratio = 1): void {
  new AnnotationSpread().spread(out, start, count, 1, given, VIEW, VIEW, ratio);
}
const x = (out: Float32Array, i: number) => out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X];
const y = (out: Float32Array, i: number) => out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y];

describe('spreading bubbles (issue 360)', () => {
  it('leaves bubbles that touch nothing where they are', () => {
    const out = bubbles([200, 400], [600, 400]);
    spread(out);
    expect([x(out, 0), y(out, 0), x(out, 1), y(out, 1)]).toEqual([200, 400, 600, 400]);
  });

  it('moves two overlapping bubbles apart sideways by equal amounts', () => {
    const out = bubbles([400, 400], [420, 410]);
    spread(out);
    expect(x(out, 1) - x(out, 0)).toBeGreaterThanOrEqual(WIDTH);
    expect((x(out, 0) + x(out, 1)) / 2).toBeCloseTo(410);
    expect([y(out, 0), y(out, 1)]).toEqual([400, 410]);
  });

  it('scales the gap between bubbles with the pixel ratio', () => {
    const one = bubbles([400, 400], [400, 400]);
    const three = bubbles([400, 400], [400, 400]);
    spread(one, NONE, 0, 2, 1);
    spread(three, NONE, 0, 2, 3);
    expect(x(one, 1) - x(one, 0)).toBeCloseTo(WIDTH + 4);
    expect(x(three, 1) - x(three, 0)).toBeCloseTo(WIDTH + 12);
  });

  it('drops a bubble just below a control that covers its top', () => {
    const bottom = 400 + TILE_HALF_HEIGHT;
    const out = bubbles([300, 400]);
    spread(out, controls([0, 0, 600, bottom - HEIGHT + 10]));
    expect(x(out, 0)).toBe(300);
    expect(y(out, 0)).toBeGreaterThan(400);
    expect(y(out, 0) - 400).toBeLessThan(20);
  });

  it('moves a bubble sideways out from beside a control edge', () => {
    const out = bubbles([310, 400]);
    spread(out, controls([0, 0, 300, VIEW]));
    expect(x(out, 0)).toBe(300 + WIDTH / 2 + 4);
    expect(y(out, 0)).toBe(400);
  });

  it('stays put when no clear place lies within its own width', () => {
    const out = bubbles([500, 400]);
    spread(out, controls([0, 0, VIEW, 700]));
    expect([x(out, 0), y(out, 0)]).toEqual([500, 400]);
  });

  it('does not move a bubble clear of a control onto another bubble', () => {
    // A is under the control; the clear spot to its right is where B already is.
    const out = bubbles([290, 400], [340, 400]);
    spread(out, controls([0, 0, 300, VIEW]));
    expect(Math.abs(x(out, 1) - x(out, 0))).toBeGreaterThanOrEqual(WIDTH);
  });

  it('keeps a bubble over a person at the screen edge wholly on screen', () => {
    const out = bubbles([10, 400], [VIEW - 5, 400]);
    spread(out);
    expect(x(out, 0)).toBe(WIDTH / 2);
    expect(x(out, 1)).toBe(VIEW - WIDTH / 2);
  });

  it('separates a pair at the screen edge by moving the inner bubble the whole way', () => {
    const out = bubbles([VIEW - 40, 400], [VIEW - 5, 400]);
    spread(out);
    expect(x(out, 1)).toBe(VIEW - WIDTH / 2);
    expect(x(out, 1) - x(out, 0)).toBeGreaterThanOrEqual(WIDTH);
  });

  it('does not pull in a bubble over someone off screen', () => {
    const out = bubbles([-10, 400], [VIEW + 300, 400]);
    spread(out);
    expect(x(out, 0)).toBe(-10);
    expect(x(out, 1)).toBe(VIEW + 300);
  });

  it('never moves a bubble more than its own width from where it was drawn', () => {
    const out = bubbles([500, 400], [500, 400], [500, 400], [500, 400]);
    spread(out);
    for (let i = 0; i < 4; i++) expect(Math.abs(x(out, i) - 500)).toBeLessThanOrEqual(WIDTH + 1e-6);
  });

  it('keeps the same sides while two people stand level and pass each other', () => {
    const before = bubbles([400, 400], [401, 400]);
    const after = bubbles([401, 400], [400, 400]);
    spread(before);
    spread(after);
    expect(x(before, 0)).toBeLessThan(x(before, 1));
    expect(x(after, 0)).toBeLessThan(x(after, 1));
  });

  it('ignores the range outside start and count', () => {
    const out = bubbles([400, 400], [410, 400], [420, 400]);
    spread(out, NONE, 1, 2);
    expect(x(out, 0)).toBe(400);
  });

  it('reuses one spreader across frames of different sizes', () => {
    const spreader = new AnnotationSpread();
    const small = bubbles([400, 400], [400, 400]);
    const large = bubbles(...Array.from({ length: 12 }, (_, i) => [100 + i * 60, 400] as [number, number]));
    spreader.spread(small, 0, 2, 1, NONE, VIEW, VIEW);
    spreader.spread(large, 0, 12, 1, NONE, VIEW, VIEW);
    spreader.spread(small, 0, 2, 1, NONE, VIEW, VIEW);
    expect(x(small, 1) - x(small, 0)).toBeGreaterThanOrEqual(WIDTH);
    expect(x(large, 3)).toBe(280);
  });
});

describe('control rectangles in canvas pixels', () => {
  it('scales and offsets client rectangles to the canvas and skips empty ones', () => {
    const out = new Float64Array(8);
    const count = toCanvasRects(
      [{ left: 18, top: 28, width: 100, height: 50 }, { left: 0, top: 0, width: 0, height: 0 }, { left: 10, top: 20, width: 10, height: 10 }],
      { left: 10, top: 20, width: 390, height: 844 }, 1170, 2532, out);
    expect(count).toBe(2);
    expect(Array.from(out)).toEqual([24, 24, 300, 150, 0, 0, 30, 30]);
  });
});
