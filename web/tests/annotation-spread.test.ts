import { describe, expect, it } from 'vitest';
import { spreadAnnotations, type ScreenRect } from '../src/render/annotation-spread.js';
import { SPRITES, spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_SPRITE } from '../src/render/instances.js';
import { TILE_HALF_HEIGHT } from '../src/render/iso.js';

const BUBBLE = spriteIndex('conversationTalkLike');
const WIDTH = SPRITES[BUBBLE].w / (SPRITES[BUBBLE].pixel_density ?? 1);
const HEIGHT = SPRITES[BUBBLE].h / (SPRITES[BUBBLE].pixel_density ?? 1);
const VIEW = 1000;

function bubbles(...positions: [number, number][]): Float32Array {
  const out = new Float32Array(positions.length * FLOATS_PER_INSTANCE);
  positions.forEach(([x, y], i) => {
    out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X] = x;
    out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y] = y;
    out[i * FLOATS_PER_INSTANCE + OFFSET_SPRITE] = BUBBLE;
  });
  return out;
}
const x = (out: Float32Array, i: number) => out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X];
const y = (out: Float32Array, i: number) => out[i * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y];

describe('spreading bubbles (issue 360)', () => {
  it('leaves bubbles that touch nothing where they are', () => {
    const out = bubbles([200, 400], [600, 400]);
    spreadAnnotations(out, 0, 2, 1, [], VIEW, VIEW);
    expect([x(out, 0), y(out, 0), x(out, 1), y(out, 1)]).toEqual([200, 400, 600, 400]);
  });

  it('moves two overlapping bubbles apart sideways by equal amounts', () => {
    const out = bubbles([400, 400], [420, 410]);
    spreadAnnotations(out, 0, 2, 1, [], VIEW, VIEW);
    expect(x(out, 1) - x(out, 0)).toBeGreaterThanOrEqual(WIDTH);
    expect((x(out, 0) + x(out, 1)) / 2).toBeCloseTo(410);
    expect([y(out, 0), y(out, 1)]).toEqual([400, 410]);
  });

  it('drops a bubble just below a control that covers its top', () => {
    const bottom = 400 + TILE_HALF_HEIGHT;
    const control: ScreenRect = { left: 0, top: 0, width: 600, height: bottom - HEIGHT + 10 };
    const out = bubbles([300, 400]);
    spreadAnnotations(out, 0, 1, 1, [control], VIEW, VIEW);
    expect(x(out, 0)).toBe(300);
    expect(y(out, 0)).toBeGreaterThan(400);
    expect(y(out, 0) - 400).toBeLessThan(20);
  });

  it('stays put when no clear place lies within its own width', () => {
    const control: ScreenRect = { left: 0, top: 0, width: VIEW, height: 700 };
    const out = bubbles([500, 400]);
    spreadAnnotations(out, 0, 1, 1, [control], VIEW, VIEW);
    expect([x(out, 0), y(out, 0)]).toEqual([500, 400]);
  });

  it('does not move a bubble clear of a control onto another bubble', () => {
    const control: ScreenRect = { left: 0, top: 0, width: 300, height: VIEW };
    const out = bubbles([290, 500], [300 + WIDTH, 500]);
    spreadAnnotations(out, 0, 2, 1, [control], VIEW, VIEW);
    const left = Math.min(x(out, 0), x(out, 1)), right = Math.max(x(out, 0), x(out, 1));
    expect(right - left).toBeGreaterThanOrEqual(WIDTH);
    expect(left - WIDTH / 2).toBeGreaterThanOrEqual(300);
  });

  it('keeps a bubble over a person at the screen edge wholly on screen', () => {
    const out = bubbles([10, 400], [VIEW - 5, 400]);
    spreadAnnotations(out, 0, 2, 1, [], VIEW, VIEW);
    expect(x(out, 0)).toBe(WIDTH / 2);
    expect(x(out, 1)).toBe(VIEW - WIDTH / 2);
  });

  it('separates a pair at the screen edge by moving the inner bubble the whole way', () => {
    const out = bubbles([VIEW - 40, 400], [VIEW - 5, 400]);
    spreadAnnotations(out, 0, 2, 1, [], VIEW, VIEW);
    expect(x(out, 1)).toBe(VIEW - WIDTH / 2);
    expect(x(out, 1) - x(out, 0)).toBeGreaterThanOrEqual(WIDTH);
  });

  it('leaves a bubble over someone well off screen off screen', () => {
    const out = bubbles([-300, 400], [VIEW + 300, 400]);
    spreadAnnotations(out, 0, 2, 1, [], VIEW, VIEW);
    expect(x(out, 0)).toBe(-300 + WIDTH);
    expect(x(out, 1)).toBe(VIEW + 300 - WIDTH);
  });

  it('never moves a bubble more than its own width from where it was drawn', () => {
    // Four people in one spot: spreading them all clear would carry the outer
    // bubbles away from everyone, so they keep some overlap instead.
    const out = bubbles([500, 400], [500, 400], [500, 400], [500, 400]);
    spreadAnnotations(out, 0, 4, 1, [], VIEW, VIEW);
    for (let i = 0; i < 4; i++) expect(Math.abs(x(out, i) - 500)).toBeLessThanOrEqual(WIDTH + 1e-6);
  });

  it('ignores the range outside start and count', () => {
    const out = bubbles([400, 400], [410, 400], [420, 400]);
    spreadAnnotations(out, 1, 2, 1, [], VIEW, VIEW);
    expect(x(out, 0)).toBe(400);
  });
});
