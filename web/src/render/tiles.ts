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
 * checked. The shipped lot is 192 floor tiles, 28 interior wall panels and
 * 29 boundary panels, so rebuilding this per frame would be that mistake
 * an order of magnitude larger, for geometry that is incapable of
 * changing.
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
import { FLOOR_DEPTH, LAYER_PROP, layeredDepth, screenX, screenY } from './iso.js';

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
 * Which of the two wall sprites a tile draws.
 *
 * A wall panel is drawn along one axis, so a run only looks like a wall if
 * every tile in the run picks the same orientation. A tile with a wall
 * neighbour to the north or south is part of a north-south run; one with a
 * neighbour east or west is part of an east-west run.
 *
 * **The interesting case is a tile that qualifies both ways, and the rule
 * is: the run that PASSES THROUGH wins.** A T-junction has neighbours on
 * both sides of one axis and on only one side of the other, and that
 * asymmetry is the answer - the through-run is a continuous surface and
 * the spur is a wall that ends against it. Drawing the spur's orientation
 * there puts a panel turned 90 degrees in the middle of the through-run,
 * which reads as a hole punched in it.
 *
 * This was got wrong twice, and both attempts are worth recording because
 * the second one looked like it worked.
 *
 * The FIRST rule was `ns ? NS : EW` - one panel, ties to north-south. It
 * was correct on the one-room flat, whose two runs met at a single L
 * corner where either panel closes the join, and it was wrong the moment
 * a T-junction existed. `content/lot.toml`'s spine runs east-west and
 * three of its tiles carry a north-south divider hanging off them; all
 * three took the north-south panel. Found by looking at a PNG of the
 * running game, not by a test. [L52].
 *
 * The SECOND was to draw BOTH panels at such a tile, on the reasoning
 * that a 32 px panel on a 64 px tile leaves room for two. **That
 * reasoning was false and the fix mostly did not work.** `sprites.wgsl`
 * centres every quad on its anchor, so two panels written at one tile
 * occupy the same 32 px rather than two halves; measured off the atlas,
 * only 14% of the east-west panel's opaque pixels fall where the
 * north-south panel is transparent. A pixel diff of the two frames showed
 * exactly that 14% changing and nothing else - the junction still read as
 * a north-south panel with a sliver behind it. Two coincident quads is
 * also [V12]'s depth conflict waiting to happen, since `layeredDepth`
 * gives them the same value and `depthCompare` is `less`.
 *
 * So: one panel per tile, and pick the through-run.
 *
 * A true crossroads - through on both axes - has no right answer with one
 * sprite per tile, and falls through to north-south. The shipped lot has
 * none. An isolated tile has no neighbour either way and gets the
 * east-west panel; a single free-standing panel has no run to agree with.
 */
function wallOrientation(
  x: number,
  y: number,
  isWall: (x: number, y: number) => boolean,
): 'wallNS' | 'wallEW' {
  const nsThrough = isWall(x, y - 1) && isWall(x, y + 1);
  const ewThrough = isWall(x - 1, y) && isWall(x + 1, y);
  if (ewThrough && !nsThrough) return 'wallEW';
  if (nsThrough && !ewThrough) return 'wallNS';
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

  /** A prop - a wall - which is depth-sorted per tile like any entity. */
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
      screenX(x, y, originX),
      screenY(x, y, originY),
      FLOOR_DEPTH,
      sprite,
    );
  };

  for (let y = 0; y < lot.height; y++) {
    for (let x = 0; x < lot.width; x++) {
      writeFloor(x, y, floorSprite);
    }
  }
  // Interior walls are read back out of the set rather than off
  // `lot.walls`, so a duplicated tile in the export cannot produce two
  // quads fighting for one pixel - which at one tile means one depth, and
  // `depthCompare: 'less'` rejects the second outright ([V12]).
  for (const key of walls) {
    const [x, y] = key.split(',').map(Number);
    write(x, y, LAYER_PROP, wallSprites[wallOrientation(x, y, isWall)]);
  }
  for (const [x, y, sprite] of boundary) {
    write(x, y, LAYER_PROP, sprite);
  }

  return { instances, count: slot };
}
