import { describe, expect, it } from 'vitest';
import { screenToWorld, screenX, screenY } from '../src/render/iso.js';
import { EDGE_REACH, WALL_FACE_FULL, WALL_FACE_LOW, floorPoint, pickWallFace, pickWallLine, wallFaces,
  type WallFace } from '../src/ui/wall-pick.js';
import { nearestLine, type WallLine } from '../src/ui/wall-tool.js';

// The shipped lot's shape: 20 by 16, the house 16 by 12 in its north-west corner.
const WIDTH = 20, HEIGHT = 16;
const camera = { originX: 700, originY: 120, scale: 1.5 };

/** The screen pixel on a line's face, `up` logical pixels above the middle of its foot. */
function onFace(line: WallLine, up: number, along = 0.5): [number, number] {
  const [x, y] = line.axis === 0 ? [line.x - 0.5, line.y - 0.5 + along] : [line.x - 0.5 + along, line.y - 0.5];
  return [screenX(x, y, camera.originX, camera.scale), screenY(x, y, camera.originY, camera.scale) - up * camera.scale];
}

/** What the old floor-only pick chose for the same pixel. */
function floorOnly(sx: number, sy: number): WallLine | null {
  const [wx, wy] = screenToWorld(sx, sy, camera.originX, camera.originY, camera.scale);
  return nearestLine(wx, wy, WIDTH, HEIGHT);
}

const south: WallLine = { axis: 1, x: 18, y: 16 };
const east: WallLine = { axis: 0, x: 20, y: 14 };
const westShell: WallLine = { axis: 0, x: 0, y: 5 };
/** One step north-west of `south`, straight up the screen from it: the wall behind it. */
const interior: WallLine = { axis: 1, x: 17, y: 15 };
const full = (line: WallLine): WallFace => ({ line, height: WALL_FACE_FULL });

describe('pickWallLine', () => {
  it('chooses a lot-edge wall from a click high on its face, which the floor alone could not', () => {
    for (const line of [south, east]) {
      const [sx, sy] = onFace(line, WALL_FACE_FULL * 0.75);
      expect(floorOnly(sx, sy)).not.toEqual(line);
      expect(pickWallLine(sx, sy, camera, WIDTH, HEIGHT, [full(line)])).toEqual(line);
    }
  });

  it('chooses the rear shell, whose face lies off the lot', () => {
    const [sx, sy] = onFace(westShell, 40);
    expect(floorOnly(sx, sy)).toBeNull();
    expect(pickWallLine(sx, sy, camera, WIDTH, HEIGHT, [full(westShell)])).toEqual(westShell);
  });

  it('measures each face at the height it is drawn', () => {
    const low = { line: south, height: WALL_FACE_LOW };
    expect(pickWallFace(...onFace(south, WALL_FACE_LOW - 4), camera, [low])).toEqual(south);
    expect(pickWallFace(...onFace(south, WALL_FACE_FULL - 8), camera, [low])).toBeNull();
    expect(pickWallFace(...onFace(south, WALL_FACE_FULL - 8), camera, [full(south)])).toEqual(south);
  });

  it('chooses the nearer wall where a full-height face hides one behind it', () => {
    // High on the south wall's face, the wall one step north-west stands behind it.
    const [sx, sy] = onFace(south, WALL_FACE_FULL * 0.9);
    expect(pickWallFace(sx, sy, camera, [full(interior)])).toEqual(interior);
    expect(pickWallFace(sx, sy, camera, [full(interior), full(south)])).toEqual(south);
    expect(pickWallFace(sx, sy, camera, [full(south), full(interior)])).toEqual(south);
  });

  it('falls back to the floor, reaching a little past the lot edge but no further', () => {
    const outside = (beyond: number): [number, number] => {
      const x = 10, y = HEIGHT - 0.5 + beyond;
      return [screenX(x, y, camera.originX, camera.scale), screenY(x, y, camera.originY, camera.scale)];
    };
    expect(pickWallLine(...outside(EDGE_REACH * 0.6), camera, WIDTH, HEIGHT, [])).toEqual({ axis: 1, x: 10, y: HEIGHT });
    expect(pickWallLine(...outside(EDGE_REACH + 0.2), camera, WIDTH, HEIGHT, [])).toBeNull();
    const pulled = floorPoint(...outside(EDGE_REACH * 0.6), camera, WIDTH, HEIGHT)!;
    expect(pulled[0]).toBeCloseTo(10, 9);
    expect(pulled[1]).toBe(HEIGHT - 0.5);
  });
});

describe('wallFaces', () => {
  const source = {
    width: WIDTH, height: HEIGHT, house: [16, 12] as const, houseOrigin: [0, 0] as const,
    edges: [1, 18, 16, 0, 0, 20, 14, 0, 1, 4, 12, 1, 0, 8, 3, 1],
    windowLines: [1, 2, 12],
    hinged: [8, 3], horizontalHinged: [],
  };
  const heightOf = (faces: WallFace[], axis: number, x: number, y: number) =>
    faces.find(face => face.line.axis === axis && face.line.x === x && face.line.y === y)?.height;

  it('draws the rear shell and hinged doors full height and the rest low in the low view', () => {
    const faces = wallFaces({ ...source, low: true, raised: new Set() });
    expect(heightOf(faces, 0, 0, 5)).toBe(WALL_FACE_FULL);
    expect(heightOf(faces, 1, 7, 0)).toBe(WALL_FACE_FULL);
    expect(heightOf(faces, 0, 8, 3)).toBe(WALL_FACE_FULL);
    expect(heightOf(faces, 1, 18, 16)).toBe(WALL_FACE_LOW);
    expect(heightOf(faces, 1, 4, 12)).toBe(WALL_FACE_LOW);
    expect(heightOf(faces, 1, 2, 12)).toBe(WALL_FACE_LOW);
  });

  it('raises the chosen lines, and every line in the full view', () => {
    expect(heightOf(wallFaces({ ...source, low: true, raised: new Set(['1/18/16']) }), 1, 18, 16)).toBe(WALL_FACE_FULL);
    expect(wallFaces({ ...source, low: false, raised: new Set() }).every(face => face.height === WALL_FACE_FULL)).toBe(true);
  });
});
