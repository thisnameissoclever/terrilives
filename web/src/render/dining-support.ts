import { sampleBedCoverage, type EncodedCoverage } from './bed-sprites.js';

/** Complementary fragments preserve complete colour while using two depths. */
export const DINING_BACKGROUND = -3;
export const DINING_FOREGROUND = -4;

export interface DiningSupport {
  readonly sprite: number;
  readonly coverage: number;
  readonly offset: readonly [number, number];
}

export function packDiningSupport(count: number, catalog: Readonly<Record<number, DiningSupport>>): Float32Array<ArrayBuffer> {
  const records = new Float32Array(count * 4);
  for (const [key, support] of Object.entries(catalog)) {
    const body = Number(key);
    if (!Number.isInteger(body) || body < 0 || body >= count
        || !Number.isInteger(support.sprite) || support.sprite < 0 || support.sprite >= count) {
      throw new Error('dining support sprite is outside the atlas');
    }
    records.set([support.sprite + 1, ...support.offset, 0], body * 4);
  }
  return records;
}

export function sampleDiningSupport(support: DiningSupport, masks: readonly EncodedCoverage[],
  bodyX: number, bodyY: number, density: number): number {
  const mask = masks[support.coverage];
  const x = (bodyX - support.offset[0]) * density;
  const y = (bodyY - support.offset[1]) * density;
  // The texture sampler clamps at an edge; fragments outside its quad do not.
  if (x < 0 || y < 0 || x > mask.size[0] || y > mask.size[1]) return 0;
  return sampleBedCoverage(mask, x - .5, y - .5);
}
