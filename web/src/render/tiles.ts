/**
 * The lot's floor and walls, as GPU instances.
 *
 * These are the only things on screen that are not entities. They are
 * also the only things that cannot move: a lot's dimensions and its wall
 * tiles are fixed for the session, so this runs only through `main.ts`'s
 * camera-dirty gate: at startup, after Load, when the window or camera
 * changes, and when flat lighting changes the static tint. Its output is
 * uploaded to the front of the instance buffer and left there between changes.
 *
 * That placement is deliberate rather than incidental. `buildInstances`
 * in `frame.ts` runs every frame under [D11]'s no-allocation rule, and
 * [V11] measured what a single unexamined allocation on that path costs:
 * 57.76 MB over 2,394 frames, from a two-element array nobody had
 * checked. The shipped block is 221 floor tiles, 30 interior wall panels,
 * 30 boundary panels, and 5 doorway panels. Local-light values are baked into
 * those same rows; rebuilding or uploading them per frame would be that
 * mistake an order of magnitude larger.
 *
 * Pure arithmetic and no GPU, like `iso.ts` and `instances.ts`, so it is
 * testable in Node.
 */

import { spriteIndex } from './atlas.js';
import {
  FLOATS_PER_INSTANCE,
  TINT_NONE,
  writeInstance,
  type InstanceArray,
} from './instances.js';
import {
  sampleLight,
  sampleWallLight,
  type TileLighting,
} from './lighting.js';
import {
  FLOOR_DEPTH,
  LAYER_PROP,
  layeredDepth,
  screenX,
  screenY,
} from './iso.js';

/** What `buildStaticInstances` needs to know about the lot. */
export interface Lot {
  readonly width: number;
  readonly height: number;
  /**
   * Impassable interior tiles, interleaved `[x0, y0, x1, y1, ...]`, as
   * `SimHandle.wall_tiles` reports them. The lot boundary is not in
   * here; see `boundary` below.
   */
  readonly walls: Uint32Array;
}

/** A finished static block: the array and how many slots of it are live. */
export interface StaticGeometry {
  readonly instances: InstanceArray;
  readonly count: number;
  /** The contiguous floor prefix, used to prove lighting adds no geometry. */
  readonly floorCount: number;
}

/**
 * The one static-instance array, reused across rebuilds - the same
 * pattern and the same reason as `frame.ts`'s scratch. Rebuilds were
 * once-per-session when this file was written; pan made them
 * once-per-FRAME during a drag, and a per-frame 11 KB allocation is
 * [V11]'s mistake at a smaller size. The returned array is only valid
 * until the next call, which `setStaticGeometry` uploads immediately.
 */
let scratch: InstanceArray = new Float32Array(0);

/** Cardinal bits: north, east, south, west, matching the atlas generator. */
function wallConnections(
  x: number,
  y: number,
  connects: (x: number, y: number, axis: 'ns' | 'ew') => boolean,
): number {
  return (connects(x, y - 1, 'ns') ? 1 : 0)
    | (connects(x + 1, y, 'ew') ? 2 : 0)
    | (connects(x, y + 1, 'ns') ? 4 : 0)
    | (connects(x - 1, y, 'ew') ? 8 : 0);
}

/** Junctions include every connected half-panel in one depth-sorted sprite. */
function connectedWallSprite(mask: number): number {
  if ((mask & 5) !== 0 && (mask & 10) !== 0) {
    return spriteIndex(`wallJoin${mask}`);
  }
  return spriteIndex((mask & 5) !== 0 ? 'wallNS' : 'wallEW');
}

/**
 * The sprites drawn outside the lot, including the floor ring.
 *
 * `cameraOrigin` reserves headroom above that row for the tallest of
 * THESE, and reserves headroom for the whole atlas above the lot's first
 * tile 2.5 half-rows lower - because nothing but a boundary piece can
 * stand at a negative coordinate. That split is only sound while this
 * list is complete, so it lives here, beside the loop below that places
 * them, and `tiles.test.ts` checks the two agree.
 */
export const BOUNDARY_SPRITE_NAMES = [
  'floor',
  'wallNS',
  'wallEW',
  'wallCornerStartNS',
  'wallCornerStartEW',
] as const;

/**
 * Every floor tile and every wall of `lot`, packed as instances.
 *
 * `gridSize` is the same depth scale `buildInstances` is given, so the
 * static geometry and the entities sort against one another rather than
 * in two independent orders.
 */
export function buildStaticInstances(
  lot: Lot,
  originX: number,
  originY: number,
  gridSize: number,
  scale = 1,
  lighting: TileLighting | null = null,
): StaticGeometry {
  const floorSprite = spriteIndex('floor');
  const wallSprites = {
    wallNS: spriteIndex('wallNS'),
    wallEW: spriteIndex('wallEW'),
  };
  const cornerStarts = {
    ns: spriteIndex('wallCornerStartNS'),
    ew: spriteIndex('wallCornerStartEW'),
  };
  const doorwaySprites = {
    doorwayNS: spriteIndex('doorwayJoinedNS'),
    doorwayEW: spriteIndex('doorwayJoinedEW'),
  };

  const walls = new Set<string>();
  for (let i = 0; i + 1 < lot.walls.length; i += 2) {
    walls.add(`${lot.walls[i]},${lot.walls[i + 1]}`);
  }
  const isWall = (x: number, y: number): boolean => walls.has(`${x},${y}`);

  // The lot boundary. `TileGrid::is_walkable` treats everything off the
  // grid as blocked, so the boundary is as solid as any authored wall
  // even though `lot.toml` lists none of it - the file says so, and says
  // that listing 80 redundant tiles would be worse. Drawing it is what
  // turns the lot from a slab floating in the dark into a room.
  //
  // Only the two far sides. Include the outer floor ring's corner tile
  // in both runs; their half-tile panel ends meet at (-1.5, -1.5).
  // Keep integer coordinates here for lighting, then move each panel
  // half a tile outward when drawing so it follows the slab's edge.
  const boundary: [number, number, number][] = [];
  for (let y = -1; y < lot.height; y++) {
    boundary.push([-1, y, wallSprites.wallNS]);
  }
  for (let x = -1; x < lot.width; x++) {
    boundary.push([x, -1, x === -1 ? cornerStarts.ew : wallSprites.wallEW]);
  }

  // **Doorways are drawn out loud.** In the data a doorway is a GAP in a
  // wall run - lot.toml says so, and the deferred [B7] wall-on-edge
  // redesign is where doors become real things. But a 32 px panel on a
  // 64 px tile already leaves floor showing beside every wall, so a gap
  // read as "the wall just stops", not as "you may walk through here" -
  // [A-11]'s "no doors" report. The renderer can SAY what the gap means
  // without the data changing: a floor tile whose two neighbours along
  // one axis are both walls is a doorway in that run, and gets the
  // kit's doorway piece - one tile-edge wide, 18 px shorter than a wall
  // panel, which reads as a lintel over an opening.
  const doorways: [number, number, number][] = [];
  for (let y = 0; y < lot.height; y++) {
    for (let x = 0; x < lot.width; x++) {
      if (isWall(x, y)) continue;
      const nsGap = isWall(x, y - 1) && isWall(x, y + 1);
      const ewGap = isWall(x - 1, y) && isWall(x + 1, y);
      if (nsGap) {
        doorways.push([x, y, doorwaySprites.doorwayNS]);
      } else if (ewGap) {
        doorways.push([x, y, doorwaySprites.doorwayEW]);
      }
    }
  }

  const doorwayAxes = new Map<string, 'ns' | 'ew'>(
    doorways.map(([x, y, sprite]) => [
      `${x},${y}`, sprite === doorwaySprites.doorwayNS ? 'ns' : 'ew',
    ]),
  );
  const connects = (x: number, y: number, axis: 'ns' | 'ew'): boolean =>
    isWall(x, y) || doorwayAxes.get(`${x},${y}`) === axis;
  const interiorPanels: [number, number, number][] = [];
  for (const key of walls) {
    const [x, y] = key.split(',').map(Number);
    let mask = wallConnections(x, y, connects);
    // A run reaching the far edge must cross the decorative floor ring
    // before it meets the exterior wall. These panels are presentation only.
    if (x === 0 && (mask & 10) !== 0) {
      mask |= 8;
      interiorPanels.push([-1, y, cornerStarts.ew]);
    }
    if (y === 0 && (mask & 5) !== 0) {
      mask |= 1;
      interiorPanels.push([x, -1, cornerStarts.ns]);
    }
    interiorPanels.push([x, y, connectedWallSprite(mask)]);
  }

  // Floor extends one ring outward to sit under the boundary walls.
  // Without it the north and west runs stood on nothing and read as
  // extending past the slab's edge - the other half of [A-11]'s wall
  // report. The ring is (width+1) x (height+1) minus the interior.
  const floorCount = (lot.width + 1) * (lot.height + 1);
  const count = floorCount + interiorPanels.length + boundary.length + doorways.length;
  if (scratch.length < count * FLOATS_PER_INSTANCE) {
    scratch = new Float32Array(count * FLOATS_PER_INSTANCE);
  }
  const instances = scratch;
  let slot = 0;

  /** A prop - a wall - which is depth-sorted per tile like any entity. */
  const write = (
    x: number,
    y: number,
    layer: number,
    sprite: number,
    emissive = 0,
  ): void => {
    writeInstance(
      instances,
      slot++,
      screenX(x, y, originX, scale),
      screenY(x, y, originY, scale),
      layeredDepth(x, y, gridSize, layer),
      sprite,
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      emissive,
    );
  };

  /**
   * A floor tile, at the single shared `FLOOR_DEPTH` rather than a per-tile one.
   *
   * Separate from `write` above because the difference is the whole fix: a
   * per-tile floor depth let a nearer tile draw over a sim's feet. See
   * `FLOOR_DEPTH`.
   */
  const writeFloor = (x: number, y: number, sprite: number): void => {
    writeInstance(
      instances,
      slot++,
      screenX(x, y, originX, scale),
      screenY(x, y, originY, scale),
      FLOOR_DEPTH,
      sprite,
      TINT_NONE,
      TINT_NONE,
      TINT_NONE,
      lighting === null ? 0 : sampleLight(lighting, x, y),
    );
  };

  for (let y = -1; y < lot.height; y++) {
    for (let x = -1; x < lot.width; x++) {
      writeFloor(x, y, floorSprite);
    }
  }
  for (const [x, y, sprite] of interiorPanels) {
    write(
      x,
      y,
      LAYER_PROP,
      sprite,
      lighting === null ? 0 : sampleWallLight(lighting, x, y),
    );
  }
  for (const [x, y, sprite] of boundary) {
    write(
      x - (sprite === wallSprites.wallNS ? 0.5 : 0),
      y - (sprite === wallSprites.wallEW || sprite === cornerStarts.ew ? 0.5 : 0),
      LAYER_PROP,
      sprite,
      lighting === null ? 0 : sampleWallLight(lighting, x, y),
    );
  }
  for (const [x, y, sprite] of doorways) {
    write(
      x,
      y,
      LAYER_PROP,
      sprite,
      lighting === null ? 0 : sampleLight(lighting, x, y),
    );
  }

  return { instances, count: slot, floorCount };
}
