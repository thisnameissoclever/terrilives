import { coveragePayload } from './coverage-payload.js';

/** Stable authored sleep-presentation wire code, independent of gameplay sleep tags. */
export const SLEEP_VISUAL_ACTION = 9;

/**
 * One coverage image: its full size, the box that holds every nonzero
 * value, and where that box's row-major values start in the coverage payload.
 */
export interface EncodedCoverage {
  readonly size: readonly [number, number];
  readonly box: readonly [number, number, number, number];
  /** Byte offset into the decompressed coverage file; see coverage-payload.ts. */
  readonly offset: number;
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
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function halfFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = value >> 10 & 31, fraction = value & 1023;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

/**
 * The record's stored bytes, as a view into `payload` rather than a copy.
 * The values are little-endian; 16-bit records start on an even offset.
 */
export function coverageBytes(record: EncodedCoverage,
  payload: Uint8Array<ArrayBuffer> = coveragePayload()): Uint8Array<ArrayBuffer> {
  const stride = record.bitDepth === 16 || record.encoding === 'float16' ? 2 : 1;
  const [left, top, right, bottom] = record.box;
  const length = (right - left) * (bottom - top) * stride;
  if (!Number.isInteger(record.offset) || record.offset < 0 || record.offset + length > payload.byteLength
      || !(right >= left && bottom >= top)) {
    throw new Error('bed coverage box reaches outside the coverage data');
  }
  return payload.subarray(record.offset, record.offset + length);
}

function decode(record: EncodedCoverage, payload?: Uint8Array<ArrayBuffer>): Uint8Array | Uint16Array | Float32Array {
  const raw = coverageBytes(record, payload);
  if (record.bitDepth !== 16 && record.encoding !== 'float16') return raw;
  const absolute = raw.byteOffset;
  const values = littleEndian && absolute % 2 === 0
    ? new Uint16Array(raw.buffer, absolute, raw.byteLength / 2)
    : Uint16Array.from({ length: raw.length / 2 }, (_, index) => raw[index * 2] | raw[index * 2 + 1] << 8);
  return record.encoding === 'float16' ? Float32Array.from(values, halfFloat) : values;
}

/**
 * Sample the original grayscale fill, with the atlas sampler's texel-center convention.
 * `payload` defaults to the loaded coverage file; tests pass their own.
 */
export function sampleBedCoverage(record: EncodedCoverage, x: number, y: number,
  payload?: Uint8Array<ArrayBuffer>): number {
  let values = decoded.get(record);
  if (!values) {
    values = decode(record, payload);
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
