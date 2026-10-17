import { describe, expect, it } from 'vitest';
import {
  GROUND_SELECTION_COMMAND, HOUSEMATE_MARKER_RADIUS, MARKER_BLUE, MARKER_BORDER_CONSTANT, MARKER_BORDER_SHORT_AXIS,
  MARKER_RED, MARKER_UNIFORM_FLOATS, MAX_GROUND_MARKERS, OFFSET_MARKER_BORDER, OFFSET_MARKER_SEMI_AXIS_X,
  OFFSET_MARKER_SEMI_AXIS_Y, PLACEMENT_MARKER_MARGIN, drawAroundMarkers, groundMarkerRows, markerAxes,
  placementMarkerSemiAxis, writeHousemateMarker, writeMarkerUniform, writePlacementMarker,
} from '../src/render/ground-selection.js';
import { buildInstanceBatch, type RenderSource } from '../src/frame.js';
import { spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_WALL_MASK, VERTICES_PER_QUAD } from '../src/render/instances.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH, screenX, screenY } from '../src/render/iso.js';
import type { PlacementPreview } from '../src/bridge.js';

/** The uniform block of one marker row, in doubles so the geometry checks are not limited by storage precision. */
function uniform(row: Float32Array, scale: number): Float64Array {
  const out = new Float64Array(MARKER_UNIFORM_FLOATS);
  writeMarkerUniform(out, 0, row, 0, scale);
  return out;
}

/** A screen offset from the marker centre, mapped to the marker's unit circle. */
function unit(block: Float64Array, x: number, y: number): [number, number] {
  return [block[4] * x + block[5] * y, block[6] * x + block[7] * y];
}

/** The screen offset of a world offset (dx, dy) from the marker centre. */
function screenOffset(dx: number, dy: number, scale: number): [number, number] {
  return [(dx - dy) * TILE_HALF_WIDTH * scale, (dx + dy) * TILE_HALF_HEIGHT * scale];
}

function placementRow(width: number, depth: number, valid = true, margin = PLACEMENT_MARKER_MARGIN): Float32Array {
  const row = new Float32Array(FLOATS_PER_INSTANCE);
  writePlacementMarker(row, 0, 40, 60, width, depth, valid);
  row[OFFSET_MARKER_SEMI_AXIS_X] = placementMarkerSemiAxis(width, margin);
  row[OFFSET_MARKER_SEMI_AXIS_Y] = placementMarkerSemiAxis(depth, margin);
  return row;
}

describe('placement marker geometry', () => {
  it('sizes each world semi-axis to pass through the footprint corners, plus the margin', () => {
    expect(PLACEMENT_MARKER_MARGIN).toBe(0.08);
    expect(placementMarkerSemiAxis(1)).toBeCloseTo(Math.SQRT1_2 + 0.08, 12);
    expect(placementMarkerSemiAxis(2)).toBeCloseTo(Math.SQRT2 + 0.08, 12);
    expect(placementMarkerSemiAxis(3, 0)).toBeCloseTo(3 / Math.SQRT2, 12);
  });

  it.each([
    [1, 1, 1], [2, 2, 1], [1, 2, 1], [2, 1, 1], [1, 2, 2], [2, 1, 2.5],
  ])('projects a %i by %i footprint at scale %s onto the two world axes', (width, depth, scale) => {
    const a = placementMarkerSemiAxis(width), b = placementMarkerSemiAxis(depth);
    const axes = new Float64Array(4);
    markerAxes(a, b, scale, axes);
    // World x runs down and right on screen, world y down and left.
    expect(Array.from(axes)).toEqual([32 * a * scale, 21 * a * scale, -32 * b * scale, 21 * b * scale]);
    const u = Math.hypot(axes[0], axes[1]), v = Math.hypot(axes[2], axes[3]);
    if (width === depth) expect(u).toBeCloseTo(v, 12);
    else expect(width > depth ? u > v : v > u).toBe(true);
  });

  it('turns a 1 by 2 marker with the object: its long axis follows the longer footprint side', () => {
    const along = (width: number, depth: number) => {
      const block = uniform(placementRow(width, depth), 1);
      // How far one tile along each world axis reaches in the marker's unit circle:
      // the longer the marker along that axis, the shorter the reach.
      const [xu, xv] = unit(block, 32, 21), [yu, yv] = unit(block, -32, 21);
      return { worldX: Math.hypot(xu, xv), worldY: Math.hypot(yu, yv) };
    };
    const lengthwiseY = along(1, 2), lengthwiseX = along(2, 1);
    expect(lengthwiseY.worldY).toBeLessThan(lengthwiseY.worldX);
    expect(lengthwiseX.worldX).toBeLessThan(lengthwiseX.worldY);
    expect(lengthwiseY.worldY).toBeCloseTo(lengthwiseX.worldX, 12);
  });

  it.each([[1, 1], [2, 2], [1, 2], [2, 1], [3, 1], [1, 3], [3, 2]])(
    'keeps every corner of a %i by %i footprint on the marker without margin and inside it with margin', (width, depth) => {
      for (const scale of [1, 1.75]) {
        for (const margin of [0, PLACEMENT_MARKER_MARGIN, 0.3]) {
          const block = uniform(placementRow(width, depth, true, margin), scale);
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const [ox, oy] = screenOffset(sx * width / 2, sy * depth / 2, scale);
            const radius = Math.hypot(...unit(block, ox, oy));
            // The row stores semi-axes as 32-bit floats, which limits the match to about 1e-7.
            if (margin === 0) expect(radius).toBeCloseTo(1, 6);
            else expect(radius).toBeLessThan(1);
          }
        }
      }
    });

  it('bounds the whole ellipse with its screen box', () => {
    for (const [width, depth] of [[1, 1], [1, 2], [2, 1], [3, 2]]) {
      const row = placementRow(width, depth), block = uniform(row, 1.5);
      const axes = new Float64Array(4);
      markerAxes(row[OFFSET_MARKER_SEMI_AXIS_X], row[OFFSET_MARKER_SEMI_AXIS_Y], 1.5, axes);
      let maxX = 0, maxY = 0;
      for (let step = 0; step < 7200; step++) {
        const t = step * Math.PI / 3600;
        maxX = Math.max(maxX, Math.abs(Math.cos(t) * axes[0] + Math.sin(t) * axes[2]));
        maxY = Math.max(maxY, Math.abs(Math.cos(t) * axes[1] + Math.sin(t) * axes[3]));
      }
      expect(block[2]).toBeGreaterThanOrEqual(maxX - 1e-9);
      expect(block[3]).toBeGreaterThanOrEqual(maxY - 1e-9);
      expect(block[2]).toBeCloseTo(maxX, 3);
      expect(block[3]).toBeCloseTo(maxY, 3);
    }
  });
});

describe('marker uniform blocks', () => {
  it.each([1, 2, 0.6])('keeps the housemate marker the approved 30 by 19.6875 pixel ellipse at scale %s', scale => {
    const row = new Float32Array(FLOATS_PER_INSTANCE);
    writeHousemateMarker(row, 0, 120, 80);
    expect(row[OFFSET_MARKER_SEMI_AXIS_X]).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    expect(row[OFFSET_MARKER_BORDER]).toBe(MARKER_BORDER_SHORT_AXIS);
    const block = uniform(row, scale);
    expect(block[0]).toBe(120);
    expect(block[1]).toBe(80);
    expect(block[2]).toBeCloseTo(30 * scale, 5);
    expect(block[3]).toBeCloseTo(19.6875 * scale, 5);
    expect(Array.from(block.slice(8, 11))).toEqual(MARKER_BLUE.map(Math.fround));
    // The approved border measures along the short axis, exactly as before.
    expect(block[13]).toBeCloseTo(19.6875 * scale, 5);
    // The unit circle is the old length(local / radius) for every screen offset.
    for (const [x, y] of [[30, 0], [0, 19.6875], [12, -7], [-25, 11]]) {
      const [ox, oy] = [x * scale, y * scale];
      expect(Math.hypot(...unit(block, ox, oy))).toBeCloseTo(Math.hypot(ox / (30 * scale), oy / (19.6875 * scale)), 5);
    }
  });

  it('gives a placement marker a constant-width border and its validity colour', () => {
    const valid = uniform(placementRow(1, 2), 1), refused = uniform(placementRow(1, 2, false), 1);
    expect(valid[13]).toBe(0);
    expect(Array.from(valid.slice(8, 11))).toEqual(MARKER_BLUE.map(Math.fround));
    expect(Array.from(refused.slice(8, 11))).toEqual(MARKER_RED.map(Math.fround));
    const row = placementRow(2, 2);
    expect(row[OFFSET_MARKER_BORDER]).toBe(MARKER_BORDER_CONSTANT);
    expect(row[OFFSET_WALL_MASK]).toBe(GROUND_SELECTION_COMMAND);
  });

  it('refuses a marker without two positive semi-axes', () => {
    const row = new Float32Array(FLOATS_PER_INSTANCE);
    row[OFFSET_WALL_MASK] = GROUND_SELECTION_COMMAND;
    expect(() => writeMarkerUniform(new Float32Array(MARKER_UNIFORM_FLOATS), 0, row, 0, 1)).toThrow(/positive semi-axes/);
  });
});

describe('finding and skipping marker rows', () => {
  const none = 0xffffffff, box = spriteIndex('cardboardBoxOpen');

  function household(): RenderSource {
    const positions = new Float32Array([2, 3]), ids = new Uint32Array([100]);
    return {
      count: 1, positions: () => positions, prevPositions: () => positions,
      ids: () => ids, kinds: () => new Uint32Array([0]), sprites: () => new Uint32Array([box]),
      activities: () => new Uint32Array(1), visualActions: () => new Uint32Array(1),
      facings: () => new Uint32Array([1]), carrying: () => new Uint32Array([none]),
      foregroundSprites: () => new Uint32Array([none]), interactionTargets: () => new Uint32Array([none]),
      itemKinds: () => [],
    };
  }

  it('finds both the selected housemate marker and a purchase marker in one frame', () => {
    const purchase: PlacementPreview = { valid: false, reason: 'blocked', x: 6, y: 5,
      width: 2, depth: 1, facing: 0, sprite: box, foreground: null };
    const batch = buildInstanceBatch(household(), 1, 100, 50, 16, 100, 2, true, 0, null, undefined, purchase,
      { tiles: [[7, 8], [8, 8]], valid: true });
    const rows = new Int32Array(MAX_GROUND_MARKERS);
    expect(groundMarkerRows(batch.instances, batch.count, rows)).toBe(2);
    const field = (index: number, offset: number) => batch.instances[rows[index] * FLOATS_PER_INSTANCE + offset];
    expect(field(0, OFFSET_MARKER_SEMI_AXIS_X)).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    expect([field(0, OFFSET_SCREEN_X), field(0, OFFSET_SCREEN_Y)]).toEqual([screenX(2, 3, 100, 2), screenY(2, 3, 50, 2)]);
    expect(field(1, OFFSET_MARKER_SEMI_AXIS_X)).toBe(Math.fround(placementMarkerSemiAxis(2)));
    expect(field(1, OFFSET_MARKER_SEMI_AXIS_Y)).toBe(Math.fround(placementMarkerSemiAxis(1)));
    expect([field(1, OFFSET_SCREEN_X), field(1, OFFSET_SCREEN_Y)]).toEqual([screenX(6.5, 5, 100, 2), screenY(6.5, 5, 50, 2)]);
    expect(batch.owners[rows[0]]).toBe(0);
    expect(batch.owners[rows[1]]).toBe(0);
  });

  it('refuses more markers than the marker pass holds rather than leaving one for the sprite pass', () => {
    const data = new Float32Array((MAX_GROUND_MARKERS + 1) * FLOATS_PER_INSTANCE);
    for (let index = 0; index <= MAX_GROUND_MARKERS; index++) writeHousemateMarker(data, index, 0, 0);
    expect(groundMarkerRows(data, MAX_GROUND_MARKERS, new Int32Array(MAX_GROUND_MARKERS))).toBe(MAX_GROUND_MARKERS);
    expect(() => groundMarkerRows(data, MAX_GROUND_MARKERS + 1, new Int32Array(MAX_GROUND_MARKERS))).toThrow(/more floor markers/);
  });

  function draws(start: number, count: number, slots: number[]): number[][] {
    const calls: number[][] = [];
    drawAroundMarkers({ draw: (...args: number[]) => { calls.push(args); } } as Pick<GPURenderPassEncoder, 'draw'>,
      start, count, Int32Array.from(slots), slots.length);
    return calls;
  }

  it('draws every sprite row except each marker slot', () => {
    expect(draws(10, 5, [])).toEqual([[VERTICES_PER_QUAD, 5, 0, 10]]);
    expect(draws(10, 10, [14, 15])).toEqual([[VERTICES_PER_QUAD, 4, 0, 10], [VERTICES_PER_QUAD, 4, 0, 16]]);
    expect(draws(10, 10, [12, 17])).toEqual([
      [VERTICES_PER_QUAD, 2, 0, 10], [VERTICES_PER_QUAD, 4, 0, 13], [VERTICES_PER_QUAD, 2, 0, 18]]);
    expect(draws(10, 5, [10, 14])).toEqual([[VERTICES_PER_QUAD, 3, 0, 11]]);
    expect(draws(10, 5, [3, 20])).toEqual([[VERTICES_PER_QUAD, 5, 0, 10]]);
    expect(draws(10, 1, [10])).toEqual([]);
    expect(draws(10, 0, [])).toEqual([]);
  });
});
