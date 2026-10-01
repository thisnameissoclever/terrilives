export type ProbeSeed = { readonly low: number; readonly high: number };

export function parseMemoryProbeSeed(search: string): ProbeSeed | null {
  const query = new URLSearchParams(search);
  if (!query.has('stress')) return null;
  const low = query.get('probeSeedLow');
  const high = query.get('probeSeedHigh');
  if (low === null && high === null) return null;
  const decimalU32 = (value: string | null): number => {
    if (value === null || !/^\d+$/.test(value) || Number(value) > 0xffff_ffff) {
      throw new RangeError('memory probe seeds must be decimal unsigned 32-bit integers');
    }
    return Number(value);
  };
  return { low: decimalU32(low), high: decimalU32(high) };
}

/** Owns only the endpoint, never simulation speed or a second clock. */
export class MemoryProbeTarget {
  private target: number | undefined;

  arm(targetTick: number, currentTick: number): void {
    if (!Number.isSafeInteger(targetTick) || targetTick <= currentTick) {
      throw new RangeError('memory probe target must be a safe integer above the current tick');
    }
    this.target = targetTick;
  }

  remaining(currentTick: number): number | undefined {
    return this.target === undefined ? undefined : Math.max(0, this.target - currentTick);
  }

  complete(currentTick: number): boolean {
    return this.target !== undefined && currentTick >= this.target;
  }
}
