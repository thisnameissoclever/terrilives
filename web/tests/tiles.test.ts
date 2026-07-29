import { describe, it, expect } from 'vitest';
import { buildStaticInstances } from '../src/render/tiles.js';
import { spriteIndex } from '../src/render/atlas.js';
import {
  FLOATS_PER_INSTANCE,
  OFFSET_DEPTH,
  OFFSET_SCREEN_X,
  OFFSET_SCREEN_Y,
  OFFSET_SPRITE,
} from '../src/render/instances.js';
import {
  LAYER_FLOOR,
  LAYER_PROP,
  layeredDepth,
  screenX,
  screenY,
} from '../src/render/iso.js';

// The floor and the walls are built once at load and never again, which
// makes them the easiest thing in the renderer to get quietly wrong: a
// mistake here is baked in for the session and looks like a level design
// problem rather than a code one.

const ORIGIN_X = 100;
const ORIGIN_Y = 50;
const GRID = 8;

interface Row {
  x: number;
  y: number;
  depth: number;
  sprite: number;
}

/** Every live instance, decoded back into named fields. */
function rows(instances: Float32Array, count: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * FLOATS_PER_INSTANCE;
    out.push({
      x: instances[base + OFFSET_SCREEN_X],
      y: instances[base + OFFSET_SCREEN_Y],
      depth: instances[base + OFFSET_DEPTH],
      sprite: instances[base + OFFSET_SPRITE],
    });
  }
  return out;
}

/** The screen position `tiles.ts` should have put a tile at. */
function at(wx: number, wy: number): { x: number; y: number } {
  return {
    x: screenX(wx, wy, ORIGIN_X),
    y: screenY(wx, wy, ORIGIN_Y),
  };
}

function find(all: Row[], wx: number, wy: number): Row[] {
  const want = at(wx, wy);
  return all.filter((r) => r.x === want.x && r.y === want.y);
}

/**
 * A 5 x 3 lot - non-square, so a transposed loop is visible - with an
 * L-shaped wall run: three tiles going down the y axis from (2, 0) and
 * two going along the x axis from (3, 2). The corner at (2, 2) belongs to
 * both, which is the case the orientation rule has to resolve.
 */
const LOT = {
  width: 5,
  height: 3,
  walls: Uint32Array.from([2, 0, 2, 1, 2, 2, 3, 2, 4, 2]),
};

describe('buildStaticInstances', () => {
  const built = buildStaticInstances(LOT, ORIGIN_X, ORIGIN_Y, GRID);
  const all = rows(built.instances, built.count);

  it('emits one floor tile per tile of the lot, at its own screen position', () => {
    const floor = spriteIndex('floor');
    const floors = all.filter((r) => r.sprite === floor);
    expect(floors).toHaveLength(LOT.width * LOT.height);

    // The four corners by name, so a loop that transposed width and
    // height - which on a 5 x 3 lot would still emit 15 tiles - fails.
    for (const [wx, wy] of [
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2],
    ]) {
      const here = floors.filter(
        (r) => r.x === at(wx, wy).x && r.y === at(wx, wy).y,
      );
      expect(here).toHaveLength(1);
    }
    // And nothing at (0, 4) or (4, 4), which exist only on the transpose.
    expect(floors.some((r) => r.x === at(0, 4).x && r.y === at(0, 4).y)).toBe(
      false,
    );
  });

  it('emits one wall per blocked tile and none anywhere else', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    const walls = all.filter((r) => r.sprite === ns || r.sprite === ew);

    // Five interior walls, plus the boundary: one panel per row down the
    // west side and one per column along the north side, with the corner
    // making an extra.
    const boundary = LOT.height + LOT.width + 1;
    expect(walls).toHaveLength(5 + boundary);

    for (const [wx, wy] of [
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 2],
      [4, 2],
    ]) {
      expect(find(walls, wx, wy)).toHaveLength(1);
    }
    // Inside the lot and not a wall. Both are transposes or neighbours
    // of real walls, so a rule reading one coordinate would light them.
    for (const [wx, wy] of [
      [0, 2],
      [2, 3],
      [3, 0],
      [1, 1],
    ]) {
      expect(find(walls, wx, wy)).toHaveLength(0);
    }
  });

  it('orients a wall run along the axis its neighbours lie on', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    expect(ns).not.toBe(ew);

    // The north-south run. (2, 0) and (2, 1) each have a neighbour on
    // the y axis and none on the x axis.
    expect(find(all, 2, 0).map((r) => r.sprite)).toContain(ns);
    expect(find(all, 2, 1).map((r) => r.sprite)).toContain(ns);
    // The east-west run. (3, 2) and (4, 2) have x-axis neighbours only.
    expect(find(all, 3, 2).map((r) => r.sprite)).toContain(ew);
    expect(find(all, 4, 2).map((r) => r.sprite)).toContain(ew);
    // The corner qualifies both ways and goes to the north-south run, so
    // the two runs meet at a tile rather than doubling up on one.
    expect(find(all, 2, 2).map((r) => r.sprite)).toContain(ns);
  });

  it('draws the lot boundary the simulation treats as solid but content never lists', () => {
    // `lot.toml` lists interior walls only, because `is_walkable`
    // already refuses everything off the grid. Undrawn, the lot is a
    // slab floating in the dark rather than a room.
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');

    for (let y = 0; y < LOT.height; y++) {
      expect(find(all, -1, y).map((r) => r.sprite)).toEqual([ns]);
    }
    for (let x = -1; x < LOT.width; x++) {
      expect(find(all, x, -1).map((r) => r.sprite)).toContain(ew);
    }
    // Only the two FAR sides. The near ones would stand between the
    // camera and the room.
    expect(find(all, LOT.width, 0)).toHaveLength(0);
    expect(find(all, 0, LOT.height)).toHaveLength(0);
  });

  it('puts every quad on a depth inside the clip range', () => {
    // The boundary sits at x = -1 and y = -1, where `worldDepth` alone
    // would clamp to the far plane and lose the ordering among the
    // panels entirely. DEPTH_MARGIN is what buys the room; this is what
    // notices if it is removed.
    const depths = all.map((r) => r.depth);
    expect(depths).toHaveLength(built.count);
    for (const depth of depths) {
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThanOrEqual(1);
    }
    // Distinct, among the boundary panels specifically. Clamping would
    // collapse the far ones onto one value and leave draw order to
    // decide which covers which.
    const boundaryDepths = new Set(
      Array.from({ length: LOT.height }, (_, y) => find(all, -1, y)[0].depth),
    );
    expect(boundaryDepths.size).toBe(LOT.height);
  });

  it('puts the floor behind the wall standing on the same tile', () => {
    // Smaller depth wins the pixel, so the floor must carry the LARGER
    // value. Inverted, every wall would be swallowed by the tile it
    // stands on and the lot would look wall-less again.
    const floorAt22 = find(all, 2, 2).find(
      (r) => r.sprite === spriteIndex('floor'),
    );
    const wallAt22 = find(all, 2, 2).find(
      (r) => r.sprite !== spriteIndex('floor'),
    );
    expect(floorAt22).toBeDefined();
    expect(wallAt22).toBeDefined();
    expect(wallAt22!.depth).toBeLessThan(floorAt22!.depth);
    // And both are the values `iso.ts` would produce, so the layers are
    // the shared ones rather than a second set invented here.
    expect(floorAt22!.depth).toBeCloseTo(layeredDepth(2, 2, GRID, LAYER_FLOOR), 12);
    expect(wallAt22!.depth).toBeCloseTo(layeredDepth(2, 2, GRID, LAYER_PROP), 12);
  });

  it('reports a count that matches the array it filled', () => {
    // `draw` uploads `count * FLOATS_PER_INSTANCE` floats, so a count
    // larger than what was written uploads uninitialised zeroes - quads
    // at screen (0, 0) with depth 0, which draw in front of everything.
    expect(built.instances.length).toBe(built.count * FLOATS_PER_INSTANCE);
    expect(built.count).toBe(LOT.width * LOT.height + 5 + LOT.height + LOT.width + 1);
  });

  it('ignores a repeated wall tile rather than stacking two quads on it', () => {
    // `wall_tiles` walks the grid so it cannot repeat, but this function
    // takes a plain array and a duplicate would put two identical quads
    // at one depth, where the second fails the depth test and wastes an
    // instance. Cheap to make impossible; expensive to notice otherwise.
    const doubled = buildStaticInstances(
      { ...LOT, walls: Uint32Array.from([2, 0, 2, 0, 2, 1, 2, 2, 3, 2, 4, 2]) },
      ORIGIN_X,
      ORIGIN_Y,
      GRID,
    );
    expect(doubled.count).toBe(built.count);
  });
});
