import { describe, it, expect } from 'vitest';
import {
  BOUNDARY_SPRITE_NAMES,
  buildStaticInstances,
  setCutAwayWalls,
} from '../src/render/tiles.js';
import { SPRITES, spriteIndex } from '../src/render/atlas.js';
import type { TileLighting } from '../src/render/lighting.js';
import { spriteFramingHeight } from '../src/render/sprite-anchors.js';
import { lotExtent } from '../src/render/camera.js';
import {
  FLOATS_PER_INSTANCE,
  OFFSET_COLOURWAY_HUE,
  OFFSET_COLOURWAY_LIGHTNESS,
  OFFSET_COLOURWAY_STRENGTH,
  OFFSET_DEPTH,
  OFFSET_EMISSIVE,
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

describe('explicit edge instances', () => {
  it('draws endpoint-owned halves on exact half-tile planes without legacy panels', () => {
    const built = buildStaticInstances({
      width: 3, height: 2, walls: Uint32Array.from([1, 1]),
      edges: Uint32Array.from([0, 1, 0, 0, 0, 1, 1, 1]),
    }, ORIGIN_X, ORIGIN_Y, GRID);
    const all = rows(built.instances, built.count);
    expect(built.floorCount).toBe(6);
    expect(built.count).toBe(14);
    expect(find(all, 0.5, -0.5).map((r) => SPRITES[r.sprite].name)).toEqual(['wallJoin14']);
    expect(find(all, 0.5, 0.5).map((r) => SPRITES[r.sprite].name)).toEqual(['wallHalf1']);
    expect(find(all, 0.5, 1).map((r) => SPRITES[r.sprite].name)).toEqual(['doorwayJoinedNS']);
    expect(find(all, 1, 1).map((r) => SPRITES[r.sprite].name)).toEqual(['floor']);
  });

  it('samples the cells beside each edge, including door frames and junctions', () => {
    const built = buildStaticInstances({
      width: 3, height: 2, walls: new Uint32Array(),
      edges: Uint32Array.from([0, 1, 0, 0, 0, 1, 1, 1]),
    }, ORIGIN_X, ORIGIN_Y, GRID, 1, tileLighting(3, 2, [[1, 0, 0.7], [0, 1, 0.4]]));
    const all = rows(built.instances, built.count);
    expect(find(all, 0.5, 0.5)[0].emissive).toBeCloseTo(0.7);
    expect(find(all, 0.5, 1)[0].emissive).toBeCloseTo(0.4);
    expect(find(all, 0.5, -0.5)[0].emissive).toBeCloseTo(0.7);
  });

  it('distinguishes explicit empty architecture from absent legacy edge data', () => {
    const lot = { width: 3, height: 2, walls: Uint32Array.from([1, 1]) };
    const legacy = buildStaticInstances(lot, ORIGIN_X, ORIGIN_Y, GRID);
    expect(find(rows(legacy.instances, legacy.count), 1, 1)).toHaveLength(2);
    const empty = buildStaticInstances({ ...lot, edges: new Uint32Array() }, ORIGIN_X, ORIGIN_Y, GRID);
    expect(find(rows(empty.instances, empty.count), 1, 1)).toHaveLength(1);
    expect(empty.count).toBe(12);
  });
});

interface Row {
  x: number;
  y: number;
  depth: number;
  sprite: number;
  emissive: number;
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
      emissive: instances[base + OFFSET_EMISSIVE],
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
  return find(all, wx, wy).filter((r) => r.sprite === ns || r.sprite === ew || SPRITES[r.sprite].name.startsWith('wallJoin') || SPRITES[r.sprite].name.startsWith('wallCornerStart'));
}

/** A sparse, ring-inclusive field for testing static geometry sampling. */
function tileLighting(
  width: number,
  height: number,
  entries: readonly (readonly [number, number, number])[],
): TileLighting {
  const stride = width + 2;
  const values = new Float32Array(stride * (height + 2));
  for (const [x, y, value] of entries) {
    values[(y + 1) * stride + x + 1] = value;
  }
  return { width, height, stride, values };
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

  it('emits floor only on the playable grid, without a decorative border', () => {
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
    // The former border must not leave floor visible behind the exterior walls.
    expect(
      floors.filter((r) => r.x === at(-1, -1).x && r.y === at(-1, -1).y),
    ).toHaveLength(0);
  });

  it('emits one wall per blocked tile and none anywhere else', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    const walls = all.filter((r) => r.sprite === ns || r.sprite === ew || SPRITES[r.sprite].name.startsWith('wallJoin') || SPRITES[r.sprite].name.startsWith('wallCornerStart'));

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
    expect(find(all, 2, 0).map((r) => r.sprite)).toContain(spriteIndex('wallCornerStartNS'));
    expect(find(all, 2, 1).map((r) => r.sprite)).toContain(ns);
    // The east-west run. (3, 2) and (4, 2) have x-axis neighbours only.
    expect(find(all, 3, 2).map((r) => r.sprite)).toContain(ew);
    expect(find(all, 4, 2).map((r) => r.sprite)).toContain(ew);
    // The elbow includes its north and east half-panels.
    expect(wallsAt(all, 2, 2).map((r) => r.sprite)).toEqual([spriteIndex('wallJoin3')]);
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
  it('joins all three arms of a T-junction in one sprite', () => {
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

    // One sprite contains the through-run and the connecting half-panel.
    expect(wallsAt(rowsOf, 2, 1).map((r) => r.sprite)).toEqual([spriteIndex('wallJoin14')]);
    // The run either side of it is unbroken and single.
    for (const wx of [0, 1, 3, 4]) {
      expect(wallsAt(rowsOf, wx, 1).map((r) => r.sprite)).toEqual([wx === 0 ? spriteIndex('wallCornerStartEW') : ew]);
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
  it('joins the transposed T without dropping its east arm', () => {
    const ns = spriteIndex('wallNS');
    const ew = spriteIndex('wallEW');
    const tee = {
      width: 4,
      height: 5,
      walls: Uint32Array.from([1, 0, 1, 1, 1, 2, 1, 3, 1, 4, 2, 2, 3, 2]),
    };
    const built = buildStaticInstances(tee, ORIGIN_X, ORIGIN_Y, GRID);
    const rowsOf = rows(built.instances, built.count);

    expect(wallsAt(rowsOf, 1, 2).map((r) => r.sprite)).toEqual([spriteIndex('wallJoin7')]);
    for (const wy of [0, 1, 3, 4]) {
      expect(wallsAt(rowsOf, 1, wy).map((r) => r.sprite)).toEqual([wy === 0 ? spriteIndex('wallCornerStartNS') : ns]);
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

  it('keeps every arm of all elbows, T-junctions and crossroads in one sprite', () => {
    const neighbours = [[3, 2], [4, 3], [3, 4], [2, 3]];
    for (const mask of [3, 6, 7, 9, 11, 12, 13, 14, 15]) {
      const walls = [3, 3];
      neighbours.forEach((tile, index) => {
        if (mask & (1 << index)) walls.push(...tile);
      });
      const built = buildStaticInstances(
        { width: 7, height: 6, walls: Uint32Array.from(walls) },
        ORIGIN_X, ORIGIN_Y, GRID,
      );
      expect(wallsAt(rows(built.instances, built.count), 3, 3).map((r) => r.sprite))
        .toEqual([spriteIndex(`wallJoin${mask}`)]);
    }
  });

  it('joins far-edge interior runs to exterior walls without border extensions', () => {
    const built = buildStaticInstances(
      { width: 6, height: 4, walls: Uint32Array.from([0, 2, 1, 2, 4, 0, 4, 1]) },
      ORIGIN_X, ORIGIN_Y, GRID,
    );
    const all = rows(built.instances, built.count);
    expect(wallsAt(all, 0, 2).map((row) => row.sprite)).toEqual([spriteIndex('wallCornerStartEW')]);
    expect(wallsAt(all, 4, 0).map((row) => row.sprite)).toEqual([spriteIndex('wallCornerStartNS')]);
    expect(wallsAt(all, -1, 2)).toEqual([]);
    expect(wallsAt(all, 4, -1)).toEqual([]);
    expect(wallsAt(all, -1, 1)).toEqual([]);
    expect(wallsAt(all, 3, -1)).toEqual([]);
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
      expect(panelsAt(-0.5, y)).toEqual([ns]);
    }
    for (let x = 0; x < LOT.width; x++) {
      expect(panelsAt(x, -0.5)).toEqual([x === 0 ? spriteIndex('wallCornerStartEW') : ew]);
    }
    // The runs meet at the slab corner without a separate post.
    expect(panelsAt(-1, -1)).toEqual([]);
    expect(all.some((r) => r.sprite === spriteIndex('wallCornerNW'))).toBe(false);
    // Only the two FAR sides. The near ones would stand between the
    // camera and the room.
    expect(find(all, LOT.width, 0)).toHaveLength(0);
    expect(find(all, 0, LOT.height)).toHaveLength(0);
  });

  it('joins both runs at the back corner and aligns their free ends with the slab at every zoom', () => {
    for (const scale of [0.5, 1, 1.375, 2.5]) {
      const geometry = buildStaticInstances(
        { ...LOT, walls: new Uint32Array() }, ORIGIN_X, ORIGIN_Y, GRID, scale,
      );
      const all = rows(geometry.instances, geometry.count);
      const floors = all.filter((row) => row.sprite === spriteIndex('floor'));
      const west = all.filter((row) => row.sprite === spriteIndex('wallNS'));
      const north = all.filter((row) =>
        [spriteIndex('wallEW'), spriteIndex('wallCornerStartEW')].includes(row.sprite));
      const left = (row: Row): number => row.x - SPRITES[row.sprite].w * scale / 2;
      const right = (row: Row): number => row.x + SPRITES[row.sprite].w * scale / 2;
      expect(west).toHaveLength(LOT.height);
      expect(north).toHaveLength(LOT.width);
      // A thin post cannot cover the interval between two separate runs.
      expect(right(west[0])).toBe(left(north[0]));
      expect(west[0].y).toBe(north[0].y);
      for (let i = 1; i < west.length; i++) {
        expect(right(west[i])).toBe(left(west[i - 1]));
      }
      for (let i = 1; i < north.length; i++) {
        expect(left(north[i])).toBe(right(north[i - 1]));
      }
      // Floor wedges appear if either wall ends inside the slab silhouette.
      expect(left(west.at(-1)!)).toBe(Math.min(...floors.map(left)));
      expect(right(north.at(-1)!)).toBe(Math.max(...floors.map(right)));
    }
  });

  it('puts every quad on a depth inside the clip range', () => {
    // The boundary sits at x = -0.5 or y = -0.5, where `worldDepth` alone
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
        (_, y) => find(all, -0.5, y).filter((r) => r.sprite !== floorSprite)[0].depth,
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
    // Playable floor, five interior walls and two boundary runs; no doorway gaps.
    expect(built.count).toBe(
      LOT.width * LOT.height + 5 + LOT.height + LOT.width,
    );
    expect(built.floorCount).toBe(LOT.width * LOT.height);
  });

  it('preserves junction arms where interior walls meet both exterior edges', () => {
    const edgeLot = {
      width: 6,
      height: 5,
      walls: Uint32Array.from([
        0, 2, 0, 1, 1, 2, 0, 3,
        3, 0, 2, 0, 4, 0, 3, 1,
      ]),
    };
    const built = buildStaticInstances(edgeLot, ORIGIN_X, ORIGIN_Y, GRID);
    const all = rows(built.instances, built.count);
    for (const [x, y] of [[0, 2], [3, 0]]) {
      expect(wallsAt(all, x, y).map((row) => row.sprite)).toEqual([
        spriteIndex('wallJoin15'),
      ]);
    }
  });

  it('samples floor, interior wall, boundary wall, and doorway light without changing geometry', () => {
    const litLot = {
      width: 5,
      height: 4,
      walls: Uint32Array.from([
        0, 1, 1, 1, 3, 1, 4, 1, // EW run, doorway gap at (2, 1)
        2, 3, // separate interior wall with controlled neighbours
      ]),
    };
    const unlitBuilt = buildStaticInstances(
      litLot,
      ORIGIN_X,
      ORIGIN_Y,
      GRID,
    );
    const unlitRows = rows(unlitBuilt.instances, unlitBuilt.count);
    const lighting = tileLighting(litLot.width, litLot.height, [
      [0, 0, 0.13], // floor and the adjacent west boundary wall
      [1, 0, 0.23], // north boundary must sample its own integer neighbour
      [2, 1, 0.44], // doorway samples its own tile
      [1, 3, 0.31], // brightest neighbour of the interior wall at (2, 3)
      [2, 2, 0.17], // dimmer neighbour proves the wall takes the maximum
    ]);
    const litBuilt = buildStaticInstances(
      litLot,
      ORIGIN_X,
      ORIGIN_Y,
      GRID,
      1,
      lighting,
    );
    const litRows = rows(litBuilt.instances, litBuilt.count);

    expect(unlitRows.every((row) => row.emissive === 0)).toBe(true);
    expect(litBuilt.count).toBe(unlitBuilt.count);
    expect(litBuilt.count).toBe(35);
    expect(litBuilt.floorCount).toBe(20);
    expect(litRows.map(({ emissive: _emissive, ...row }) => row)).toEqual(
      unlitRows.map(({ emissive: _emissive, ...row }) => row),
    );

    const floor = find(litRows, 0, 0).find(
      (row) => row.sprite === spriteIndex('floor'),
    );
    const interiorWall = wallsAt(litRows, 2, 3)[0];
    const boundaryWall = wallsAt(litRows, -0.5, 0)[0];
    const doorway = find(litRows, 2, 1).find(
      (row) => row.sprite === spriteIndex('doorwayJoinedEW'),
    );

    expect(floor?.emissive).toBe(Math.fround(0.13));
    expect(interiorWall?.emissive).toBe(Math.fround(0.31));
    expect(boundaryWall?.emissive).toBe(Math.fround(0.13));
    const northCorner = wallsAt(litRows, 0, -0.5)[0];
    const northWall = wallsAt(litRows, 1, -0.5)[0];
    expect(northCorner?.sprite).toBe(spriteIndex('wallCornerStartEW'));
    expect(northCorner?.emissive).toBe(Math.fround(0.13));
    expect(northWall?.sprite).toBe(spriteIndex('wallEW'));
    expect(northWall?.emissive).toBe(Math.fround(0.23));
    expect(doorway?.emissive).toBe(Math.fround(0.44));
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
    const doorNS = spriteIndex('doorwayJoinedNS');
    const doorEW = spriteIndex('doorwayJoinedEW');

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

describe('BOUNDARY_SPRITE_NAMES', () => {
  // `cameraOrigin` reserves headroom for the whole atlas above the lot's
  // FIRST tile and only for these above the boundary half a half-row
  // higher. The separate reservation is only sound
  // while this list is complete: a boundary piece taller than every name
  // in it would be reserved for at the wrong row and go off the top of
  // the page, which is the exact bug the split was introduced to fix,
  // reintroduced from the other side.
  //
  // So this checks the claim against what `buildStaticInstances` really
  // emits, rather than against a second hand-written list.

  /** Every sprite index drawn at a tile with a negative coordinate. */
  const drawnOutside = (): Set<number> => {
    const outside = new Set<number>();
    for (const lot of [LOT, {
      ...LOT, edges: Uint32Array.from([0, 2, 0, 0, 1, 0, 2, 0]),
    }]) {
      const built = buildStaticInstances(lot, ORIGIN_X, ORIGIN_Y, GRID);
      for (const row of rows(built.instances, built.count)) {
        const dx = (row.x - ORIGIN_X) / 32;
        const dy = (row.y - ORIGIN_Y) / 21;
        if ((dx + dy) / 2 < 0 || (dy - dx) / 2 < 0) outside.add(row.sprite);
      }
    }
    return outside;
  };

  it('names every sprite that is actually drawn outside the lot', () => {
    // Incompleteness is the dangerous direction: a boundary piece missing
    // from the list is reserved for at the lot's row, half a half-row too
    // low, and goes off the top of the page.
    const outside = drawnOutside();
    const named = new Set(
      BOUNDARY_SPRITE_NAMES.map((name) => spriteIndex(name)),
    );
    expect(outside.size).toBeGreaterThan(0);
    for (const sprite of outside) expect(named).toContain(sprite);
  });

  it('does not name a sprite that is never drawn outside the lot', () => {
    // The mirror, and the one that keeps the list from being padded "just
    // in case": a name that never reaches the boundary row inflates the
    // reservation on every canvas, which is how the over-reservation this
    // replaced got there in the first place. A doorway piece is the live
    // temptation - it is static geometry and it is a wall-ish thing, but
    // `tiles.ts` only ever places it at x and y of 0 or more.
    const outside = drawnOutside();
    for (const name of BOUNDARY_SPRITE_NAMES) {
      expect(outside).toContain(spriteIndex(name));
    }
    expect(outside).not.toContain(spriteIndex('doorwayJoinedNS'));
  });

  it('keeps endpoint art inside camera headroom at both zoom limits', () => {
    const tallest = Math.max(...SPRITES.map((_, index) => spriteFramingHeight(index)));
    const boundary = Math.max(...BOUNDARY_SPRITE_NAMES.map((name) => spriteFramingHeight(spriteIndex(name))));
    const lot = { ...LOT, edges: Uint32Array.from([0, 2, 0, 0, 1, 0, 2, 0]) };
    for (const scale of [0.5, 1, 2.5]) {
      const built = buildStaticInstances(lot, 0, 0, GRID, scale);
      const extent = lotExtent(lot.width, lot.height, tallest, boundary, scale);
      const panels = rows(built.instances, built.count).slice(built.floorCount);
      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) {
        const top = panel.y + (21 - spriteFramingHeight(panel.sprite)) * scale;
        expect(top).toBeGreaterThanOrEqual(extent.top);
      }
    }
  });
});

// [OS-yard] in docs/specs/2026-09-22-the-outside.md: a yard tile is the floor's
// art under the yard's colour shift, written as a colourway's is; a house tile,
// and every tile of a lot that is all house, is drawn as it always was.
describe('the yard', () => {
  const floorShifts = (built: { instances: Float32Array; count: number }): number[][] => {
    const floor = spriteIndex('floor');
    const shifts: number[][] = [];
    for (let i = 0; i < built.count; i++) {
      const base = i * FLOATS_PER_INSTANCE;
      if (built.instances[base + OFFSET_SPRITE] !== floor) continue;
      shifts.push([OFFSET_COLOURWAY_HUE, OFFSET_COLOURWAY_STRENGTH, OFFSET_COLOURWAY_LIGHTNESS]
        .map((offset) => Math.round(built.instances[base + offset] * 100) / 100));
    }
    return shifts;
  };
  const lot = { width: 3, height: 2, walls: new Uint32Array(), edges: new Uint32Array() };

  it("draws a yard tile under the yard's look and a house tile as drawn", () => {
    const built = buildStaticInstances({ ...lot, house: [2, 1], yardLook: [65, 2, -0.22] },
      ORIGIN_X, ORIGIN_Y, GRID);
    const yard = [65, 1, -0.22];
    const drawn = [0, 0, 0];
    // Row by row: (0, 0) and (1, 0) are house, the rest yard.
    expect(floorShifts(built)).toEqual([drawn, drawn, yard, yard, yard, yard]);
  });

  it('draws every tile as drawn when the lot is all house or has no look', () => {
    const drawn = Array.from({ length: 6 }, () => [0, 0, 0]);
    expect(floorShifts(buildStaticInstances({ ...lot, yardLook: [65, 2, -0.22] },
      ORIGIN_X, ORIGIN_Y, GRID))).toEqual(drawn);
    expect(floorShifts(buildStaticInstances({ ...lot, house: [2, 1] },
      ORIGIN_X, ORIGIN_Y, GRID))).toEqual(drawn);
  });

  // [OS-daylight]: each floor tile carries its sky shade, and a wall the
  // shade of the more open tile beside it on the lot.
  it('shades the floor and walls by how far the sky reaches in', async () => {
    const { buildSkyExposure } = await import('../src/render/sky.js');
    const { OFFSET_SHADE, FLOATS_PER_INSTANCE } = await import('../src/render/instances.js');
    // The house is the west 2 by 2 of a 3 by 2 lot, closed on the east
    // (x = 2) but for a doorway on row 0.
    const edges = Uint32Array.from([0, 2, 0, 1, 0, 2, 1, 0]);
    const sky = buildSkyExposure(3, 2, edges, [2, 2], 0.25);
    const built = buildStaticInstances({ ...lot, edges, house: [2, 2] }, ORIGIN_X, ORIGIN_Y, GRID, 1, null, sky);
    const floor = spriteIndex('floor');
    const shades: number[] = [];
    for (let i = 0; i < built.count; i++) {
      const base = i * FLOATS_PER_INSTANCE;
      if (built.instances[base + OFFSET_SPRITE] === floor) shades.push(built.instances[base + OFFSET_SHADE]);
    }
    // Row by row: (0, 0) 0.5, (1, 0) 0.25, (2, 0) yard; (0, 1) 0.75, (1, 1) 0.5, (2, 1) yard.
    expect(shades).toEqual([0.5, 0.25, 0, 0.75, 0.5, 0]);
    // The wall on the east line at row 1 has the house tile (1, 1) and the
    // yard tile (2, 1) beside it: it takes the yard's open sky.
    const wallShades = [];
    for (let i = 0; i < built.count; i++) {
      const base = i * FLOATS_PER_INSTANCE;
      if (built.instances[base + OFFSET_SPRITE] !== floor) wallShades.push(built.instances[base + OFFSET_SHADE]);
    }
    expect(wallShades.length).toBeGreaterThan(0);
    // The back walls on the north and west lines see only the house's tiles
    // on the lot, so they are shaded as the room is, never fully lit.
    expect(Math.max(...wallShades)).toBeGreaterThan(0);
    // Without a sky, everything is fully exposed, as before.
    const open = buildStaticInstances({ ...lot, edges, house: [2, 2] }, ORIGIN_X, ORIGIN_Y, GRID);
    for (let i = 0; i < open.count; i++) expect(open.instances[i * FLOATS_PER_INSTANCE + OFFSET_SHADE]).toBe(0);
  });

  it('draws the cut-away walls while a wall tool asks, and keeps the yard green', () => {
    const edges = Uint32Array.from([0, 2, 0, 1]);
    const shown = buildStaticInstances({ ...lot, edges, house: [2, 1], showCutAwayWalls: true },
      ORIGIN_X, ORIGIN_Y, GRID);
    expect(find(rows(shown.instances, shown.count), 1.5, 0).map((r) => SPRITES[r.sprite].name))
      .toEqual(['doorwayJoinedNS']);
    const hidden = buildStaticInstances({ ...lot, edges, house: [2, 1] }, ORIGIN_X, ORIGIN_Y, GRID);
    expect(floorShifts(shown)).toEqual(floorShifts(hidden));
  });

  it("leaves the front door's own frame alone when the front walls are shown", () => {
    const edges = Uint32Array.from([0, 2, 0, 1]);
    const shown = buildStaticInstances({ ...lot, edges, house: [2, 1], showCutAwayWalls: true,
      frontDoors: Uint32Array.from([2, 0]) }, ORIGIN_X, ORIGIN_Y, GRID);
    expect(find(rows(shown.instances, shown.count), 1.5, 0)).toEqual([]);
  });

  it('rebuilds only when the cut-away walls are turned on or off', () => {
    const state: { showCutAwayWalls?: boolean } = {};
    expect([setCutAwayWalls(state, false), setCutAwayWalls(state, true), setCutAwayWalls(state, true),
      setCutAwayWalls(state, false), setCutAwayWalls(state, false)]).toEqual([false, true, false, true, false]);
    expect(state.showCutAwayWalls).toBe(false);
  });

  it("passes the house to the walls, so its front walls are cut away", () => {
    const edges = Uint32Array.from([0, 2, 0, 1]);
    const house = buildStaticInstances({ ...lot, edges, house: [2, 1] }, ORIGIN_X, ORIGIN_Y, GRID);
    const whole = buildStaticInstances({ ...lot, edges }, ORIGIN_X, ORIGIN_Y, GRID);
    expect(find(rows(whole.instances, whole.count), 1.5, 0).map((r) => SPRITES[r.sprite].name))
      .toEqual(['doorwayJoinedNS']);
    expect(find(rows(house.instances, house.count), 1.5, 0)).toEqual([]);
  });
});

// [OS-street] in docs/specs/2026-09-22-the-outside.md: the street's column is
// the floor under the street's look, whatever else the tile is.
describe('the street', () => {
  const shifts = (built: { instances: Float32Array; count: number }): number[][] => {
    const floor = spriteIndex('floor');
    const out: number[][] = [];
    for (let i = 0; i < built.count; i++) {
      const base = i * FLOATS_PER_INSTANCE;
      if (built.instances[base + OFFSET_SPRITE] !== floor) continue;
      out.push([OFFSET_COLOURWAY_HUE, OFFSET_COLOURWAY_STRENGTH, OFFSET_COLOURWAY_LIGHTNESS]
        .map((offset) => Math.round(built.instances[base + offset] * 100) / 100));
    }
    return out;
  };

  it("draws the street's column under the street's look, beside the yard", () => {
    const built = buildStaticInstances({
      width: 3, height: 2, walls: new Uint32Array(), edges: new Uint32Array(),
      house: [1, 1], yardLook: [65, 2, -0.22], street: 2, streetLook: [0, 0.15, -0.22],
    }, ORIGIN_X, ORIGIN_Y, GRID);
    const drawn = [0, 0, 0];
    const yard = [65, 1, -0.22];
    const street = [0, -0.85, -0.22];
    // Row by row: (0, 0) house, (1, 0) yard, (2, 0) street, then the yard row.
    expect(shifts(built)).toEqual([drawn, yard, street, yard, yard, street]);
  });
});
