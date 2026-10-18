/**
 * The shell's copy of the session's activity log ([AL-bridge] in
 * docs/specs/2026-10-18-activity-log.md): one preallocated ring of 2,000
 * twelve-word records, filled once a frame from the simulation's drain
 * whether or not the panel is open. A drain copies into the ring and
 * allocates nothing beyond the one view the bridge builds.
 */

export const ACTIVITY_LOG_CAPACITY = 2_000;
export const RECORD_WORDS = 12;
/** The "nobody" and "no label" value of the `other`, `label` and `label2` words. */
export const NONE = 0xffff_ffff;

/** Record kinds, the low byte of word 2 ([AL-record]). */
export const KIND = {
  actionDone: 1,
  chatDone: 2,
  fightDone: 3,
  annoyed: 4,
  choresThisWeek: 5,
  duty: 6,
  choreOutcome: 7,
  feeling: 8,
  skillLevel: 9,
  weeklyReview: 10,
  careerChange: 11,
  death: 12,
} as const;

/** Flags in bits 16 to 23 of word 2: the actor's or the other person's Social total is partial. */
export const PARTIAL = 1 << 16;
export const OTHER_PARTIAL = 1 << 17;

/** Takes the staged records into `into` from record slot `at`, wrapping; returns the count. */
export interface ActivityLogSource {
  takeActivityLog(into: Uint32Array, at: number): number;
}

export class ActivityLogStore {
  readonly words: Uint32Array;
  private head = 0;
  private size = 0;
  private drained = 0;
  private lastSeq = 0;

  constructor(readonly capacity = ACTIVITY_LOG_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('Activity log capacity must be positive.');
    this.words = new Uint32Array(capacity * RECORD_WORDS);
  }

  /** Records held, at most `capacity`. Index 0 is the oldest. */
  get length(): number { return this.size; }

  /**
   * Records drained since the last reset, including any the ring has since
   * overwritten. The panel compares it between frames to find new records.
   */
  get total(): number { return this.drained; }

  /**
   * Copies every staged record into the ring and returns how many arrived.
   * A full ring overwrites its oldest records. A `seq` that does not rise is
   * a defect outside a Load, so the drain throws, as `BookResults.drain`
   * does.
   */
  drain(source: ActivityLogSource): number {
    const tail = (this.head + this.size) % this.capacity;
    const count = source.takeActivityLog(this.words, tail);
    if (count === 0) return 0;
    let previous = this.lastSeq;
    for (let offset = 0; offset < count; offset++) {
      const seq = this.words[((tail + offset) % this.capacity) * RECORD_WORDS];
      if (seq <= previous) throw new Error(`Activity log sequence went backwards at ${seq}.`);
      previous = seq;
    }
    this.lastSeq = previous;
    const overflow = Math.max(0, this.size + count - this.capacity);
    this.head = (this.head + overflow) % this.capacity;
    this.size = Math.min(this.capacity, this.size + count);
    this.drained += count;
    return count;
  }

  /** Empties the store after a successful Load; the fresh world starts again at `seq` 1. */
  resetAfterLoad(): void {
    this.head = 0;
    this.size = 0;
    this.drained = 0;
    this.lastSeq = 0;
  }

  private word(index: number, word: number): number {
    return this.words[((this.head + index) % this.capacity) * RECORD_WORDS + word];
  }

  seq(index: number): number { return this.word(index, 0); }
  tick(index: number): number { return this.word(index, 1); }
  kind(index: number): number { return this.word(index, 2) & 0xff; }
  triggers(index: number): number { return (this.word(index, 2) >>> 8) & 0xff; }
  flags(index: number): number { return this.word(index, 2) & 0x00ff_0000; }
  actor(index: number): number { return this.word(index, 3); }
  other(index: number): number { return this.word(index, 4); }
  label(index: number): number { return this.word(index, 5); }
  label2(index: number): number { return this.word(index, 6); }
  parent(index: number): number { return this.word(index, 7); }
  /** Value `slot` 0 to 3 as a signed 32-bit number. */
  value(index: number, slot: number): number { return this.word(index, 8 + slot) | 0; }

  /** The index of the record with `seq`, or -1. Sequence numbers rise through the ring. */
  indexOfSeq(seq: number): number {
    let low = 0;
    let high = this.size - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const found = this.seq(middle);
      if (found === seq) return middle;
      if (found < seq) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }
}

/** The two signed sixteen-bit halves of a packed value, low first. */
export function unpackPair(value: number): [number, number] {
  return [(value << 16) >> 16, value >> 16];
}
