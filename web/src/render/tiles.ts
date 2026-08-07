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
 * checked. The shipped block is 221 floor tiles, 28 interior wall panels,
 * 29 boundary panels, and 5 doorway panels. Local-light values are baked into
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
 * running game, not by a test. [L53].
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
  scale = 1,
  lighting: TileLighting | null = null,
): StaticGeometry {
  const floorSprite = spriteIndex('floor');
  const wallSprites = {
    wallNS: spriteIndex('wallNS'),
    wallEW: spriteIndex('wallEW'),
  };
  const cornerSprite = spriteIndex('wallCornerNW');
  const doorwaySprites = {
    doorwayNS: spriteIndex('doorwayNS'),
    doorwayEW: spriteIndex('doorwayEW'),
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
  //
  // The north-west tile (-1,-1) is where the two runs MEET, and it gets
  // the corner piece: it was previously an east-west panel butted
  // against a north-south one, two differently-oriented half-tile
  // panels meeting at an offset with nothing closing the join - one of
  // [A-11]'s "wall segments don't touch" sightings.
  const boundary: [number, number, number][] = [[-1, -1, cornerSprite]];
  for (let y = 0; y < lot.height; y++) {
    boundary.push([-1, y, wallSprites.wallNS]);
  }
  for (let x = 0; x < lot.width; x++) {
    boundary.push([x, -1, wallSprites.wallEW]);
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

  // Floor extends one ring outward to sit under the boundary walls.
  // Without it the north and west runs stood on nothing and read as
  // extending past the slab's edge - the other half of [A-11]'s wall
  // report. The ring is (width+1) x (height+1) minus the interior.
  const floorCount = (lot.width + 1) * (lot.height + 1);
  const count = floorCount + walls.size + boundary.length + doorways.length;
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
  // Interior walls are read back out of the set rather than off
  // `lot.walls`, so a duplicated tile in the export cannot produce two
  // quads fighting for one pixel - which at one tile means one depth, and
  // `depthCompare: 'less'` rejects the second outright ([V12]).
  for (const key of walls) {
    const [x, y] = key.split(',').map(Number);
    write(
      x,
      y,
      LAYER_PROP,
      wallSprites[wallOrientation(x, y, isWall)],
      lighting === null ? 0 : sampleWallLight(lighting, x, y),
    );
  }
  for (const [x, y, sprite] of boundary) {
    write(
      x,
      y,
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
