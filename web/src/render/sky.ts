/**
 * How much open sky each floor tile sees - [OS-daylight] in
 * `docs/specs/2026-09-22-the-outside.md`.
 *
 * Every tile outside the house is under open sky and has an exposure of 1.
 * Inside, the sky reaches in through open lines and doorways and loses
 * `reachPerTile` for each tile it travels; a wall stops it. The shader uses
 * the result to take a share of the day's light off shaded instances, so a
 * room far from any doorway reads as indoors by day.
 *
 * Presentation only, like the lamp field in `lighting.ts`: it is built from
 * the lot's edges when the lot changes, never per frame, and nothing flows
 * back into the simulation.
 */

export interface SkyExposure {
  readonly width: number;
  readonly height: number;
  /** One value per tile, row by row, in `[0, 1]`. */
  readonly values: Float32Array;
}

/** Everything open to the sky: what a lot with no edge walls, or no house, draws. */
export const OPEN_SKY: SkyExposure = { width: 0, height: 0, values: new Float32Array(0) };

/**
 * Floods the sky in from every tile outside the house. `edges` are the lot's
 * `[axis, x, y, door]` rows: axis 0 is the vertical line at `x` between
 * tiles `(x - 1, y)` and `(x, y)`, axis 1 the horizontal line at `y`
 * between `(x, y - 1)` and `(x, y)`. A wall (door 0) blocks; a doorway
 * (door 1) does not. `edges` null means a save older than edge walls, and
 * `house` null a lot with no house: both are open sky everywhere, as is a
 * reach outside `(0, 1]`. An empty edge list is a house with no walls, which
 * the sky reaches into from the yard on every side, still losing
 * `reachPerTile` per tile.
 */
export function buildSkyExposure(
  width: number,
  height: number,
  edges: ArrayLike<number> | null,
  house: readonly [number, number] | null,
  reachPerTile: number,
): SkyExposure {
  if (edges === null || house === null || !(width > 0 && height > 0)
    || !(reachPerTile > 0 && reachPerTile <= 1)) {
    return OPEN_SKY;
  }
  const values = new Float32Array(width * height).fill(-1);
  // Wall lines, one byte per line: bit 1 blocks the step west from a tile,
  // bit 2 the step north.
  const walls = new Uint8Array(width * height);
  for (let i = 0; i + 3 < edges.length; i += 4) {
    const [axis, x, y, door] = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]];
    if (door === 1 || x >= width || y >= height) continue;
    walls[y * width + x] |= axis === 0 ? 1 : 2;
  }
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= house[0] || y >= house[1]) {
        values[y * width + x] = 1;
        queue.push(y * width + x);
      }
    }
  }
  // Every step loses the same amount, so a breadth-first flood from all the
  // open tiles at once reaches each tile first along its shortest open way,
  // which is also its brightest.
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    const x = at % width;
    const y = (at - x) / width;
    const next = values[at] - reachPerTile;
    if (next <= 0) continue;
    const visit = (to: number, open: boolean): void => {
      if (open && values[to] < 0) {
        values[to] = next;
        queue.push(to);
      }
    };
    if (x > 0) visit(at - 1, (walls[at] & 1) === 0);
    if (x + 1 < width) visit(at + 1, (walls[at + 1] & 1) === 0);
    if (y > 0) visit(at - width, (walls[at] & 2) === 0);
    if (y + 1 < height) visit(at + width, (walls[at + width] & 2) === 0);
  }
  for (let i = 0; i < values.length; i++) if (values[i] < 0) values[i] = 0;
  return { width, height, values };
}

/** A tile's exposure; a tile off the field is open sky. */
export function sampleSky(sky: SkyExposure, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= sky.width || y >= sky.height) {
    return 1;
  }
  return sky.values[y * sky.width + x];
}

/** How shaded an instance on this tile is: 1 minus its exposure. */
export function sampleShade(sky: SkyExposure, x: number, y: number): number {
  return 1 - sampleSky(sky, x, y);
}
