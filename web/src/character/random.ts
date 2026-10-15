/** A draft owns this generator; it never reads or advances simulation randomness. */
export class DraftRandom {
  private current: number;
  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid draft seed.');
    this.current = seed;
  }
  get state(): number { return this.current; }
  private next(): number {
    let value = this.current = (this.current + 0x6d2b79f5) >>> 0;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return (value ^ value >>> 14) >>> 0;
  }
  index(length: number): number {
    if (!Number.isInteger(length) || length <= 0 || length > 0x100000000) throw new Error('Invalid random choice count.');
    const limit = Math.floor(0x100000000 / length) * length;
    let value: number;
    do { value = this.next(); } while (value >= limit);
    return value % length;
  }
  choose<T>(values: readonly T[]): T { return values[this.index(values.length)]; }
}
