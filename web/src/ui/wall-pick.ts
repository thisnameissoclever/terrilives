// Choosing a wall line from a click on the wall the player sees - [WB-pick]
// in docs/specs/2026-09-22-walls-in-build.md.
//
// A wall stands up from its line, so the pixels the player aims at lie one to
// two tiles behind the line on the floor. This tests the drawn face of every
// barrier first, the nearest one to the camera winning, and only then falls
// back to the floor under the pointer.

import { screenToWorld, screenX, screenY } from '../render/iso.js';
import { nearestLine, type WallLine } from './wall-tool.js';

/** Logical pixels a full-height wall rises above its line: 2 world units of 39 pixels. */
export const WALL_FACE_FULL = 78;
/** Logical pixels a low wall rises above its line: 2/3 of a world unit ([WB-height]). */
export const WALL_FACE_LOW = 26;
/** Pixels of slack around a face, at scale 1, so a click on its outline or cap still counts. */
const FACE_SLACK = 4;
/** How far outside the lot, in tiles, a floor click still reaches the lot's outer lines. */
export const EDGE_REACH = 0.4;

export interface WallFace {
  readonly line: WallLine;
  /** Logical pixels at scale 1. */
  readonly height: number;
}

export interface PickCamera {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
}

export const lineKey = (line: WallLine): string => `${line.axis}/${line.x}/${line.y}`;

/** Both ground ends of a line, in world units: tiles are centred on whole numbers. */
function ends(line: WallLine): [[number, number], [number, number]] {
  const x = line.x - 0.5, y = line.y - 0.5;
  return line.axis === 0 ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]];
}

/**
 * The barrier whose drawn face covers the screen point, or null. Screen
 * coordinates are canvas buffer pixels, as the camera's origin is.
 */
export function pickWallFace(sx: number, sy: number, camera: PickCamera,
  faces: readonly WallFace[]): WallLine | null {
  const { originX, originY, scale } = camera;
  const slack = FACE_SLACK * scale;
  let best: WallLine | null = null, bestDepth = -Infinity, bestCentre = Infinity;
  for (const face of faces) {
    const [[ax, ay], [bx, by]] = ends(face.line);
    const x0 = screenX(ax, ay, originX, scale), y0 = screenY(ax, ay, originY, scale);
    const x1 = screenX(bx, by, originX, scale), y1 = screenY(bx, by, originY, scale);
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    if (sx < left - slack || sx > right + slack) continue;
    const t = Math.max(0, Math.min(1, (sx - x0) / (x1 - x0)));
    const ground = y0 + (y1 - y0) * t;
    if (sy > ground + slack || sy < ground - face.height * scale - slack) continue;
    // The nearer face hides the farther one; at a shared corner, the face
    // whose middle is closer to the pointer is the one being aimed at.
    const depth = ax + ay + bx + by, centre = Math.abs(sx - (left + right) / 2);
    if (depth > bestDepth || (depth === bestDepth && centre < bestCentre)) {
      best = face.line; bestDepth = depth; bestCentre = centre;
    }
  }
  return best;
}

/** The floor point under a screen point, pulled onto the lot when it lies just outside it. */
export function floorPoint(sx: number, sy: number, camera: PickCamera, width: number,
  height: number): [number, number] | null {
  const [wx, wy] = screenToWorld(sx, sy, camera.originX, camera.originY, camera.scale);
  const pull = (value: number, size: number): number | null => {
    if (value < -0.5 - EDGE_REACH || value > size - 0.5 + EDGE_REACH) return null;
    return Math.max(-0.5, Math.min(size - 0.5, value));
  };
  const x = pull(wx, width), y = pull(wy, height);
  return x === null || y === null ? null : [x, y];
}

/** A drawn face first, then the nearest line on the floor, or null off the lot. */
export function pickWallLine(sx: number, sy: number, camera: PickCamera, width: number,
  height: number, faces: readonly WallFace[]): WallLine | null {
  const face = pickWallFace(sx, sy, camera, faces);
  if (face) return face;
  const point = floorPoint(sx, sy, camera, width, height);
  return point ? nearestLine(point[0], point[1], width, height) : null;
}

export interface WallFaceSource {
  readonly width: number;
  readonly height: number;
  readonly house: readonly [number, number];
  readonly houseOrigin: readonly [number, number];
  /** Four words per wall or doorway record: axis, x, y, doorway. */
  readonly edges: ArrayLike<number>;
  /** Three words per covered window line: axis, x, y. */
  readonly windowLines: ArrayLike<number>;
  /** Vertical and horizontal lines, `[x, y]` pairs, that hold a hinged door. */
  readonly hinged: ArrayLike<number>;
  readonly horizontalHinged: ArrayLike<number>;
  /** Interior and front walls are drawn low ([WB-height]). */
  readonly low: boolean;
  /** Lines drawn full height even when the rest are low: the selection. */
  readonly raised: ReadonlySet<string>;
}

/** Every barrier line and the height it is drawn at, as the static wall geometry draws it. */
export function wallFaces(source: WallFaceSource): WallFace[] {
  const [houseX, houseY] = source.houseOrigin;
  const faces = new Map<string, WallFace>();
  const doors = new Set<string>();
  for (let i = 0; i + 1 < source.hinged.length; i += 2) doors.add(`0/${source.hinged[i]}/${source.hinged[i + 1]}`);
  for (let i = 0; i + 1 < source.horizontalHinged.length; i += 2) {
    doors.add(`1/${source.horizontalHinged[i]}/${source.horizontalHinged[i + 1]}`);
  }
  const add = (axis: number, x: number, y: number): void => {
    if (axis !== 0 && axis !== 1) return;
    const line: WallLine = { axis, x, y };
    const key = lineKey(line);
    const rear = axis === 0 ? x === houseX : y === houseY;
    const tall = !source.low || rear || doors.has(key) || source.raised.has(key);
    faces.set(key, { line, height: tall ? WALL_FACE_FULL : WALL_FACE_LOW });
  };
  for (let y = houseY; y < Math.min(source.height, houseY + source.house[1]); y++) add(0, houseX, y);
  for (let x = houseX; x < Math.min(source.width, houseX + source.house[0]); x++) add(1, x, houseY);
  for (let i = 0; i + 3 < source.edges.length; i += 4) add(source.edges[i], source.edges[i + 1], source.edges[i + 2]);
  for (let i = 0; i + 2 < source.windowLines.length; i += 3) {
    add(source.windowLines[i], source.windowLines[i + 1], source.windowLines[i + 2]);
  }
  return [...faces.values()];
}
