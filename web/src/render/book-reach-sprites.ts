import type { BedScene } from './bed-sprites.js';

export const FETCH_BOOK_STAGE = 6;
export const SHELVE_BOOK_STAGE = 7;

export interface BookReachFrame {
  readonly scene: BedScene;
  /** True draws the copy with its carrier; false shows it in its home shelf slot. */
  readonly suppressStock: boolean;
}

export interface BookReachProfile {
  readonly model: string;
  readonly slots: number;
  readonly phases: number;
  readonly scenes: Readonly<Record<string, BookReachFrame>>;
}

export type BookReachCatalog = Readonly<Record<number, BookReachProfile>>;

export interface BookReachShelf {
  readonly stock: number;
  readonly correction?: number;
  readonly canvas: readonly [number, number];
  /** Logical pixel offset from the reach canvas origin to the shelf canvas origin. */
  readonly offset: readonly [number, number];
}
export interface BookReachShelves {
  readonly scenes?: Readonly<Record<number, BookReachShelf>>;
  readonly tables?: readonly (readonly (readonly [number, number])[])[];
}

/** Reuse the shelf's inventory layers without baking unowned copies into a reach. */
export function packBookReachShelves(table: Uint32Array<ArrayBuffer>, count: number,
  profiles: BookReachShelves): Uint32Array<ArrayBuffer> {
  if (Object.keys(profiles).some(key => key !== 'scenes' && key !== 'tables')) {
    throw new Error('Book reach stock tables have an unknown field');
  }
  const entries = Object.entries(profiles.scenes ?? {}), tables = profiles.tables ?? [];
  const result = new Uint32Array(table.length + entries.length * 8 + tables.length * 256 * 8);
  result.set(table);
  const floats = new Float32Array(result.buffer);
  let next = table.length / 8;
  const starts: number[] = [];
  for (const rows of tables) {
    if (rows.length !== 256) throw new Error('Book reach stock table is incomplete');
    starts.push(next + 1);
    for (const pair of rows) {
      if (pair.length !== 2 || (pair[0] === -1) !== (pair[1] === -1)
          || pair.some(ref => !Number.isInteger(ref) || ref < -1 || ref >= count)) {
        throw new Error('Book reach stock pair is invalid');
      }
      result[next * 8] = pair[0] + 1; result[next * 8 + 1] = pair[1] + 1;
      next++;
    }
  }
  for (const [key, profile] of entries) {
    const sprite = Number(key);
    if (!Number.isInteger(sprite) || sprite < 0 || sprite >= count
        || !Number.isInteger(profile.stock) || profile.stock < 0 || profile.stock >= tables.length
        || (profile.correction !== undefined && (!Number.isInteger(profile.correction)
          || profile.correction < 0 || profile.correction >= tables.length))
        || profile.canvas.length !== 2 || profile.canvas.some(value => !Number.isInteger(value) || value <= 0)
        || profile.offset.length !== 2 || !profile.offset.every(Number.isFinite)
        || table[sprite * 8] === 0 || table[sprite * 8 + 5] !== 0) {
      throw new Error('Book reach shelf composition is invalid');
    }
    const start = next * 8;
    result[start] = starts[profile.stock];
    result[start + 1] = profile.correction === undefined ? 0 : starts[profile.correction];
    floats[start + 2] = profile.canvas[0];
    floats[start + 3] = profile.canvas[1];
    floats[start + 4] = profile.offset[0];
    floats[start + 5] = profile.offset[1];
    result[start + 6] = table[sprite * 8 + 7];
    result[sprite * 8 + 5] = next + 1;
    next++;
  }
  return result;
}

/** Progress comes from the saved journey, so pausing and loading preserve its pose. */
export function bookReachPhase(remaining: number, total: number, phases: number): number {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(remaining)
      || remaining < 0 || remaining > total || !Number.isInteger(phases) || phases <= 0) {
    throw new Error('Book reach duration or phase count is invalid');
  }
  return Math.min(phases - 1, Math.floor((total - remaining) * phases / total));
}

export function bookReachFrame(profile: BookReachProfile, stage: number, slot: number,
  remaining: number, total: number, palette: number): BookReachFrame {
  if ((stage !== FETCH_BOOK_STAGE && stage !== SHELVE_BOOK_STAGE)
      || !Number.isInteger(slot) || slot < 0 || slot >= profile.slots
      || !Number.isInteger(palette) || palette < 0 || palette > 2) {
    throw new Error('Book reach stage, shelf slot or palette is invalid');
  }
  const phase = bookReachPhase(remaining, total, profile.phases);
  const frame = profile.scenes[`${stage}:${slot}:${phase}:${palette}`];
  if (!frame || frame.scene.owners.length !== 1 || !frame.scene.owners[0]) {
    throw new Error('Book reach scene is missing its exact stage, slot, phase or owner');
  }
  return frame;
}
