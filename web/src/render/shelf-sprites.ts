export interface ShelfProfile {
  readonly base: number;
  readonly rows: readonly (readonly [number, number])[];
}
export type ShelfProfiles = Readonly<Record<number, ShelfProfile>>;

/** Four six-bit row selectors; shelf word count is independent of entity rows. */
export function shelfPresence(row: number, offsets: Uint32Array | undefined,
  counts: Uint32Array | undefined, words: Uint32Array | undefined): number {
  if (!offsets || !counts || !words || counts[row] === 0) return 0;
  const offset = offsets[row];
  if (offset >= words.length) throw new Error('Shelf presence offset is outside the live word buffer');
  return words[offset] & 0xffffff;
}

/** The packed tint's red field carries the exact 24-bit mask for shelf scenes. */
export function packShelfLayers(table: Uint32Array<ArrayBuffer>, count: number,
  profiles: ShelfProfiles): Uint32Array<ArrayBuffer> {
  const entries = Object.entries(profiles);
  const packed = new Uint32Array(table.length + entries.length * 256 * 8);
  packed.set(table);
  let next = count;
  for (const [key, profile] of entries) {
    const sprite = Number(key);
    if (profile.rows.length !== 256 || sprite < 0 || sprite >= count
        || profile.base < 0 || profile.base >= count) throw new Error('Shelf profile is incomplete');
    packed[sprite * 8 + 5] = next + 1;
    packed[sprite * 8 + 6] = profile.base + 1;
    for (const pair of profile.rows) {
      if (pair.length !== 2 || (pair[0] === -1) !== (pair[1] === -1)
          || pair.some(ref => !Number.isInteger(ref) || ref < -1 || ref >= count)) {
        throw new Error('Shelf signed pair is invalid');
      }
      packed[next * 8] = pair[0] + 1;
      packed[next * 8 + 1] = pair[1] + 1;
      next++;
    }
  }
  return packed;
}
