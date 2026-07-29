/**
 * The lot's floor and walls, as GPU instances.
 *
 * These are the only things on screen that are not entities. They are
 * also the only things that cannot move: a lot's dimensions and its wall
 * tiles are fixed for the session, so this runs **once at load** and its
 * output is uploaded to the front of the instance buffer and left there.
 *
 * That placement is deliberate rather than incidental. `buildInstances`
 * in `frame.ts` runs every frame under [D11]'s no-allocation rule, and
 * [V11] measured what a single unexamined allocation on that path costs:
 * 57.76 MB over 2,394 frames, from a two-element array nobody had
 * checked. The shipped lot is 432 floor tiles and 39 wall panels, so
 * rebuilding this per frame would be that mistake an order of magnitude
 * larger, for geometry that is incapable of changing.
 *
 * Pure arithmetic and no GPU, like `iso.ts` and `instances.ts`, so it is
 * testable in Node.
 */

import { spriteIndex } from './atlas.js';
import {
  FLOATS_PER_INSTANCE,
  writeInstance,
  type InstanceArray,
} from './instances.js';
import { LAYER_FLOOR, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';

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
}

/**
 * Which of the two wall sprites a tile gets.
 *
 * A wall panel is drawn along one axis, so a run of them only looks like
 * a wall if every tile in the run picks the same orientation. The rule is
 * "if this tile has a wall neighbour to the north or south it is part of
 * a north-south run", which resolves every tile of the shipped lot's two
 * runs correctly and gives a corner tile - which qualifies both ways -
 * to the north-south run, so the two runs meet rather than overlapping.
 *
 * An isolated wall tile has no neighbour either way and gets the
 * east-west panel. There is no better answer; a single free-standing
 * panel has no run to agree with.
 */
function wallOrientation(
  x: number,
  y: number,
  isWall: (x: number, y: number) => boolean,
): 'wallNS' | 'wallEW' {
  return isWall(x, y - 1) || isWall(x, y + 1) ? 'wallNS' : 'wallEW';
}

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
): StaticGeometry {
  const floorSprite = spriteIndex('floor');
  const wallSprites = {
    wallNS: spriteIndex('wallNS'),
    wallEW: spriteIndex('wallEW'),
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
  // Only the two FAR sides, at x = -1 and y = -1. The near sides would
  // stand between the camera and the room and hide most of it, which is
  // why isometric games have never drawn them.
  const boundary: [number, number, number][] = [];
  for (let y = 0; y < lot.height; y++) {
    boundary.push([-1, y, wallSprites.wallNS]);
  }
  for (let x = -1; x < lot.width; x++) {
    boundary.push([x, -1, wallSprites.wallEW]);
  }

  const count = lot.width * lot.height + walls.size + boundary.length;
  const instances: InstanceArray = new Float32Array(count * FLOATS_PER_INSTANCE);
  let slot = 0;

  const write = (x: number, y: number, layer: number, sprite: number): void => {
    writeInstance(
      instances,
      slot++,
      screenX(x, y, originX),
      screenY(x, y, originY),
      layeredDepth(x, y, gridSize, layer),
      sprite,
    );
  };

  for (let y = 0; y < lot.height; y++) {
    for (let x = 0; x < lot.width; x++) {
      write(x, y, LAYER_FLOOR, floorSprite);
    }
  }
  // Interior walls are read back out of the set rather than off
  // `lot.walls`, so a duplicated tile in the export cannot produce two
  // quads fighting for one pixel.
  for (const key of walls) {
    const [x, y] = key.split(',').map(Number);
    write(x, y, LAYER_PROP, wallSprites[wallOrientation(x, y, isWall)]);
  }
  for (const [x, y, sprite] of boundary) {
    write(x, y, LAYER_PROP, sprite);
  }

  return { instances, count: slot };
}
