/** Stable authored sleep-presentation wire code, independent of gameplay sleep tags. */
export const SLEEP_VISUAL_ACTION = 9;

export interface EncodedCoverage {
  readonly size: readonly [number, number];
  readonly box: readonly [number, number, number, number];
  readonly values: string;
  /** Scene alpha retains additive sums above 255 until after interpolation. */
  readonly bitDepth?: 16;
  readonly encoding?: 'float16';
}

export interface BedOwner {
  readonly coverage: number;
  /** Visible-owner center relative to the registered bed origin; UI only. */
  readonly marker: readonly [number, number];
}

export interface BedScene {
  readonly sprite: number;
  readonly alpha: number;
  readonly owners: readonly (BedOwner | null)[];
}

export type BedCatalog = Readonly<Record<number, Readonly<Record<number, BedScene>>>>;

export function bedSceneKey(mask: number, palette0: number, palette1: number): number {
  return mask * 9 + (mask & 1 ? palette0 : 0) * 3 + (mask & 2 ? palette1 : 0);
}

const decoded = new WeakMap<EncodedCoverage, Uint8Array | Uint16Array | Float32Array>();

function halfFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = value >> 10 & 31, fraction = value & 1023;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

/** Sample the original grayscale fill, with the atlas sampler's texel-center convention. */
export function sampleBedCoverage(record: EncodedCoverage, x: number, y: number): number {
  let values = decoded.get(record);
  if (!values) {
    const bytes = atob(record.values);
    const raw = Uint8Array.from(bytes, (value) => value.charCodeAt(0));
    const stride = record.bitDepth === 16 || record.encoding === 'float16' ? 2 : 1;
    const [left, top, right, bottom] = record.box;
    if (raw.length !== (right - left) * (bottom - top) * stride) {
      throw new Error('bed coverage length differs from its registered box');
    }
    values = stride === 1 ? raw : Uint16Array.from(
      { length: raw.length / 2 }, (_, index) => raw[index * 2] | raw[index * 2 + 1] << 8);
    if (record.encoding === 'float16') values = Float32Array.from(values, halfFloat);
    decoded.set(record, values);
  }
  const [left, top, right, bottom] = record.box;
  const width = right - left;
  x = Math.max(0, Math.min(record.size[0] - 1, x));
  y = Math.max(0, Math.min(record.size[1] - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, record.size[0] - 1);
  const y1 = Math.min(y0 + 1, record.size[1] - 1);
  const at = (px: number, py: number): number =>
    px < left || py < top || px >= right || py >= bottom ? 0 : values![(py - top) * width + px - left];
  const ax = x - x0, ay = y - y0;
  return ((at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay)
    + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay) / (record.encoding === 'float16' ? 1 : 255);
}

/** Startup-only descriptors keep the historical sprite-table layout unchanged. */
export { packVisibleSceneLayers as packBedLayers } from './visible-scene-layers.js';
