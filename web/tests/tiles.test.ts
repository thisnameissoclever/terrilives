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
  FLOOR_DEPTH,
  LAYER_FLOOR,
  LAYER_PROP,
  LAYER_SIM,
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
 * The WALL panels at a tile, with the floor tile that shares its screen
 * position filtered out.
 *
 * `find` matches on position, so it always returns the floor as well. That
 * was harmless while every assertion used `toContain`, and it stops being
 * harmless once a junction tile has to be checked for having exactly two
 * panels: the floor makes every count one too high and every sprite set one
 * member too large.
 */
function wallsAt(all: Row[], wx: number, wy: number): Row[] {
  const ns = spriteIndex('wallNS');
  const ew = spriteIndex('wallEW');
  return find(all, wx, wy).filter((r) => r.sprite === ns || r.sprite === ew);
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

  it('emits one floor tile per tile of the lot plus the boundary ring', () => {
    const floor = spriteIndex('floor');
    const floors = all.filter((r) => r.sprite === floor);
    // The ring at x = -1 and y = -1 is floored too, so the boundary
    // walls stand on ground instead of past the slab's edge - [A-11].
    expect(floors).toHaveLength((LOT.width + 1) * (LOT.height + 1));

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
    // The ring's own far corner is floored - the tile the wall corner
    // piece stands on.
    expect(
      floors.filter((r) => r.x === at(-1, -1).x && r.y === at(-1, -1).y),
    ).toHaveLength(1);
  });

  it('emits one wall per blocked tile and none anywhere else', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    const walls = all.filter((r) => r.sprite === ns || r.sprite === ew);

    // Five interior walls, plus the boundary: one panel per row down the
    // west side and one per column along the north side. The meeting
    // tile at (-1,-1) is the CORNER piece now, not a flat panel, so it
    // is deliberately absent from this ns/ew count.
    const boundary = LOT.height + LOT.width;
    expect(walls).toHaveLength(5 + boundary);

    // **One panel per tile, the corner included.** Two coincident quads at
    // one tile share a depth, and `depthCompare: 'less'` rejects the second
    // ([V12]); they also share their 32 px of screen, because the shader
    // centres a quad on its anchor. Drawing both was tried and measured -
    // 14% of the second panel survived - and the through-run rule replaced
    // it. This count is what fails if anyone tries it again.
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
    // The L corner qualifies both ways with a neighbour on ONE side of
    // each axis, so neither run passes through it and the tie-break
    // decides. Either panel closes an L, which is exactly why this fixture
    // could not see the bug the T-junction test below covers.
    expect(wallsAt(all, 2, 2).map((r) => r.sprite)).toEqual([ns]);
    expect(ew).not.toBe(ns);
  });

  /**
   * **A T-junction, which is what a real floor plan is made of and what the
   * L-shaped fixture above cannot express.**
   *
   * `content/lot.toml`'s spine runs east-west with three north-south
   * dividers hanging off it. Each of those tiles has east-west neighbours
   * on BOTH sides and a north-south one on only one side, so the run
   * PASSES THROUGH east-west and merely ends against it going south. The
   * original rule turned the tile 90 degrees and the spine read as a wall
   * with holes punched in it. An L corner cannot see that: it has a
   * neighbour on one side of each axis, so nothing passes through and both
   * rules agree.
   *
   * Three separate claims, and the run tiles either side are what make the
   * first one mean something - "everything is east-west" would satisfy the
   * junction assertion on its own.
   */
  it('gives a T-junction the orientation of the run that passes through it', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    // An east-west run across y = 1, with a spur going south from (2, 1).
    // Non-square lot again, so a transposed loop is visible.
    const tee = {
      width: 5,
      height: 4,
      walls: Uint32Array.from([0, 1, 1, 1, 2, 1, 3, 1, 4, 1, 2, 2, 2, 3]),
    };
    const built = buildStaticInstances(tee, ORIGIN_X, ORIGIN_Y, GRID);
    const rowsOf = rows(built.instances, built.count);

    // The junction goes with the through-run, not with the spur.
    expect(wallsAt(rowsOf, 2, 1).map((r) => r.sprite)).toEqual([ew]);
    // The run either side of it is unbroken and single.
    for (const wx of [0, 1, 3, 4]) {
      expect(wallsAt(rowsOf, wx, 1).map((r) => r.sprite)).toEqual([ew]);
    }
    // And the spur is still a north-south wall, including its far end,
    // which has a neighbour on one axis only.
    expect(wallsAt(rowsOf, 2, 2).map((r) => r.sprite)).toEqual([ns]);
    expect(wallsAt(rowsOf, 2, 3).map((r) => r.sprite)).toEqual([ns]);
  });

  /**
   * **The transposed T: a north-south run with an east-west spur.**
   *
   * The rule reads two booleans and returns one of two sprites, so the
   * mutation that survives every fixture above is "always prefer
   * east-west at a junction" - which the T-junction test cannot see,
   * because there the through-run IS east-west. This is the same case with
   * the axes swapped, and between them the two pin that the rule reads
   * which run is through rather than which axis it likes.
   */
  it('gives a transposed T-junction the other orientation, so the rule is not a fixed preference', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    const tee = {
      width: 4,
      height: 5,
      walls: Uint32Array.from([1, 0, 1, 1, 1, 2, 1, 3, 1, 4, 2, 2, 3, 2]),
    };
    const built = buildStaticInstances(tee, ORIGIN_X, ORIGIN_Y, GRID);
    const rowsOf = rows(built.instances, built.count);

    expect(wallsAt(rowsOf, 1, 2).map((r) => r.sprite)).toEqual([ns]);
    for (const wy of [0, 1, 3, 4]) {
      expect(wallsAt(rowsOf, 1, wy).map((r) => r.sprite)).toEqual([ns]);
    }
    expect(wallsAt(rowsOf, 2, 2).map((r) => r.sprite)).toEqual([ew]);
    expect(wallsAt(rowsOf, 3, 2).map((r) => r.sprite)).toEqual([ew]);
  });

  /**
   * An isolated wall tile - no neighbour on either axis - gets exactly one
   * panel, like every other tile. Nothing in the rule can produce two, and
   * this is the cheapest input that would catch a version that did.
   */
  it('gives a free-standing wall tile one panel', () => {
    const lone = { width: 3, height: 3, walls: Uint32Array.from([1, 1]) };
    const built = buildStaticInstances(lone, ORIGIN_X, ORIGIN_Y, GRID);
    expect(wallsAt(rows(built.instances, built.count), 1, 1)).toHaveLength(1);
  });

  it('draws the lot boundary the simulation treats as solid but content never lists', () => {
    // `lot.toml` lists interior walls only, because `is_walkable`
    // already refuses everything off the grid. Undrawn, the lot is a
    // slab floating in the dark rather than a room.
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');

    const floor = spriteIndex('floor');
    const panelsAt = (wx: number, wy: number): number[] =>
      find(all, wx, wy)
        .filter((r) => r.sprite !== floor)
        .map((r) => r.sprite);

    for (let y = 0; y < LOT.height; y++) {
      expect(panelsAt(-1, y)).toEqual([ns]);
    }
    for (let x = 0; x < LOT.width; x++) {
      expect(panelsAt(x, -1)).toEqual([ew]);
    }
    // Where the two runs meet: the corner piece, closing the join two
    // flat panels left open - [A-11].
    expect(panelsAt(-1, -1)).toEqual([spriteIndex('wallCornerNW')]);
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
    const floorSprite = spriteIndex('floor');
    const boundaryDepths = new Set(
      Array.from(
        { length: LOT.height },
        (_, y) => find(all, -1, y).filter((r) => r.sprite !== floorSprite)[0].depth,
      ),
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
    // The wall is still the value `iso.ts` would produce, so the layers are the
    // shared ones rather than a second set invented here.
    expect(wallAt22!.depth).toBeCloseTo(layeredDepth(2, 2, GRID, LAYER_PROP), 12);
    // **The floor is NOT**, and that is the fix rather than a slip.** It carries
    // one shared `FLOOR_DEPTH` instead of a per-tile one, because a per-tile
    // floor depth let a nearer tile draw over a sim's feet - measured at 19 x 21
    // px of overlap. See `FLOOR_DEPTH`.
    expect(floorAt22!.depth).toBe(FLOOR_DEPTH);
  });

  it('puts every floor tile behind everything a layer can produce, and in front of the clear value', () => {
    // The two bounds `FLOOR_DEPTH` has to sit between, asserted against the
    // real extremes rather than against the constant's own arithmetic - so a
    // change to `DEPTH_LAYER_STEP`, to `DEPTH_LAYERS` or to the margin has to
    // keep the relationship rather than merely keep the formula.
    //
    // The upper bound is the one that fails silently: `sprites.ts` clears depth
    // to 1.0 and compares with `less`, and a fragment at exactly 1.0 is not less
    // than 1.0 - so a floor at 1.0 would make the ENTIRE FLOOR vanish with no
    // error anywhere.
    let worstLayered = -Infinity;
    for (const layer of [LAYER_FLOOR, LAYER_PROP, LAYER_SIM]) {
      for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
          worstLayered = Math.max(worstLayered, layeredDepth(x, y, GRID, layer));
        }
      }
    }
    expect(FLOOR_DEPTH).toBeGreaterThan(worstLayered);
    expect(FLOOR_DEPTH).toBeLessThan(1);

    // And every floor tile the builder emits really is at it, so the invariant
    // is about the drawn lot and not only about the constant.
    const floors = all.filter((r) => r.sprite === spriteIndex('floor'));
    expect(floors.length).toBeGreaterThan(0);
    expect(floors.every((r) => r.depth === FLOOR_DEPTH)).toBe(true);
  });

  it('reports a count that matches the array it filled', () => {
    // `draw` uploads `count * FLOATS_PER_INSTANCE` floats, so a count
    // larger than what was written uploads uninitialised zeroes - quads
    // at screen (0, 0) with depth 0, which draw in front of everything.
    expect(built.instances.length).toBe(built.count * FLOATS_PER_INSTANCE);
    // Ring-inclusive floor, five interior walls, the two boundary runs,
    // and the corner piece. This fixture has no doorway gaps.
    expect(built.count).toBe(
      (LOT.width + 1) * (LOT.height + 1) + 5 + LOT.height + LOT.width + 1,
    );
  });

  /**
   * A doorway is a GAP in a wall run in the data ([B7] defers real
   * doors to build mode), and the renderer now says what the gap means:
   * a floor tile with wall neighbours on both sides along one axis gets
   * the kit's doorway piece, oriented with the run it interrupts.
   */
  it('marks a gap in a wall run with a doorway piece oriented like the run', () => {
    // An east-west run with a gap at (2, 1), and a north-south run with
    // a gap at (4, 2) - both on one non-square lot so the axes cannot
    // be conflated.
    const gapped = {
      width: 6,
      height: 5,
      walls: Uint32Array.from([
        0, 1, 1, 1, 3, 1, // EW run, gap at (2, 1)
        4, 1, // shared tile: continues the EW run
        4, 3, 4, 4, // NS run below, gap at (4, 2)
      ]),
    };
    const built = buildStaticInstances(gapped, ORIGIN_X, ORIGIN_Y, GRID);
    const rowsOf = rows(built.instances, built.count);
    const doorNS = spriteIndex('doorwayNS');
    const doorEW = spriteIndex('doorwayEW');

    const sprites = (wx: number, wy: number): number[] =>
      rowsOf
        .filter((r) => r.x === at(wx, wy).x && r.y === at(wx, wy).y)
        .map((r) => r.sprite);

    expect(sprites(2, 1)).toContain(doorEW);
    expect(sprites(4, 2)).toContain(doorNS);
    // A doorway does not replace the floor: a sim walks through it.
    expect(sprites(2, 1)).toContain(spriteIndex('floor'));
    // And an ordinary open tile beside a single wall gets no doorway -
    // one wall neighbour is a wall's SIDE, not a gap in a run.
    expect(sprites(2, 2)).not.toContain(doorEW);
    expect(sprites(2, 2)).not.toContain(doorNS);
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
