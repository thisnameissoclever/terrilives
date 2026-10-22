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

/** Exterior components from saved architecture; doors and windows enclose rooms. */
function currentOutside(width: number, height: number, edges: ArrayLike<number>, windows: ArrayLike<number>): Uint8Array {
  const barriers=new Uint8Array(width*height), outside=new Uint8Array(width*height), queue:number[]=[];
  const block=(axis:number,x:number,y:number):void=>{
    if (!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0) return;
    if(axis===0&&x<=width&&y<height){if(x>0)barriers[y*width+x-1]|=2;if(x<width)barriers[y*width+x]|=1;}
    if(axis===1&&y<=height&&x<width){if(y>0)barriers[(y-1)*width+x]|=8;if(y<height)barriers[y*width+x]|=4;}
  };
  for(let i=0;i+3<edges.length;i+=4)block(edges[i],edges[i+1],edges[i+2]);
  for(let i=0;i+2<windows.length;i+=3)block(windows[i],windows[i+1],windows[i+2]);
  const visit=(at:number):void=>{if(!outside[at]){outside[at]=1;queue.push(at);}};
  for(let y=0;y<height;y++){if(!(barriers[y*width]&1))visit(y*width);if(!(barriers[y*width+width-1]&2))visit(y*width+width-1);}
  for(let x=0;x<width;x++){if(!(barriers[x]&4))visit(x);if(!(barriers[(height-1)*width+x]&8))visit((height-1)*width+x);}
  for(let head=0;head<queue.length;head++){
    const at=queue[head],x=at%width,y=Math.floor(at/width),mask=barriers[at];
    if(x>0&&!(mask&1))visit(at-1);if(x+1<width&&!(mask&2))visit(at+1);
    if(y>0&&!(mask&4))visit(at-width);if(y+1<height&&!(mask&8))visit(at+width);
  }
  return outside;
}

/**
 * Current worlds derive exterior tiles from saved enclosure. Light crosses
 * doorways and windows with distance falloff. Historical callers without
 * surfaces retain their original house rectangle and implicit rear shell.
 * Rebuild on geometry changes, not each rendered frame.
 */
export function buildSkyExposure(
  width: number,
  height: number,
  edges: ArrayLike<number> | null,
  house: readonly [number, number] | null,
  reachPerTile: number,
  windows: ArrayLike<number> = [],
  houseOrigin: readonly [number, number] = [0, 0],
  surfaces?: ArrayLike<number>,
): SkyExposure {
  if (edges === null || (house === null && !surfaces?.length)
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > 1_000_000
    || !(reachPerTile > 0 && reachPerTile <= 1)) {
    return OPEN_SKY;
  }
  if(surfaces?.length && surfaces.length!==width*height) throw new Error('Surface grid dimensions do not match the lot.');
  const outside=surfaces?.length ? currentOutside(width,height,edges,windows) : null;
  const values = new Float32Array(width * height).fill(-1);
  // Wall lines, one byte per line: bit 1 blocks the step west from a tile,
  // bit 2 the step north.
  const walls = new Uint8Array(width * height);
  for (let i = 0; i + 3 < edges.length; i += 4) {
    const [axis, x, y, door] = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]];
    if (door === 1 || (axis !== 0 && axis !== 1)
      || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= width || y >= height) continue;
    walls[y * width + x] |= axis === 0 ? 1 : 2;
  }
  const [houseX, houseY] = houseOrigin;
  const inHouse = (x: number, y: number): boolean => outside
    ? outside[y * width + x] === 0
    : house !== null && x >= houseX && x < houseX + house[0] && y >= houseY && y < houseY + house[1];
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inHouse(x, y)) {
        values[y * width + x] = 1;
        queue.push(y * width + x);
      }
    }
  }
  // Rear apertures have no exterior floor tile. Their adjacent indoor tile
  // is one step from virtual sky. Yard seeds stay first (distance zero),
  // then these seeds (distance one), so the first visit is always brightest.
  // Glass on the lot's south or east edge looks out the same way, from the
  // tile on its near side.
  const apertures=Array.from(windows);
  if(outside)for(let i=0;i+3<edges.length;i+=4)if(edges[i+3]===1)apertures.push(edges[i],edges[i+1],edges[i+2]);
  for (let i = 0; i + 2 < apertures.length; i += 3) {
    const [axis, lineX, lineY] = [apertures[i], apertures[i + 1], apertures[i + 2]];
    const edge = (axis === 0 && lineX === width) || (axis === 1 && lineY === height);
    const x = edge && axis === 0 ? lineX - 1 : lineX, y = edge && axis === 1 ? lineY - 1 : lineY;
    if (!Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= width || y >= height
      || !inHouse(x, y)) continue;
    const rear = surfaces?.length === width * height
      ? (axis === 0 && lineX === 0) || (axis === 1 && lineY === 0)
      : (axis === 0 && x === houseX) || (axis === 1 && y === houseY);
    const at = y * width + x;
    if (!(rear || edge) || (!edge && (walls[at] & (axis === 0 ? 1 : 2)) !== 0) || values[at] >= 0) continue;
    values[at] = Math.max(0, 1 - reachPerTile);
    queue.push(at);
  }
  // Every step loses the same amount, so a breadth-first flood from all the
  // open tiles at once reaches each tile first along its shortest open way,
  // which is also its brightest.
  for (let head = 0; head < queue.length && head < values.length; head++) {
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
