export interface StressSpawnTarget {
  readonly count: number;
  spawnAgent(x: number, y: number, hunger: number): void;
}

/** Bound URL-driven stress work independently of whether any tile accepts spawns. */
export const MAX_STRESS_AGENTS = 10_000;

/**
 * Adds exactly the requested population, or throws when the request cannot finish.
 * Probe each grid cell once, then reuse accepted positions. Agents do not occupy
 * grid cells, so repeated spawns there remain valid during this synchronous call.
 * Work is O(width * height + requested); hunger 100 keeps stress agents satisfied.
 */
export function spawnStressAgents(
  sim: StressSpawnTarget,
  width: number,
  height: number,
  requested: number,
): number {
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_STRESS_AGENTS) {
    throw new Error(`Stress agent count must be an integer from 0 to ${MAX_STRESS_AGENTS}.`);
  }
  if (requested === 0) return 0;
  // Match the save loader's 1,048,576-cell limit to bound a rejected full scan.
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > 1_048_576) {
    throw new Error('Stress grid dimensions must be positive integers covering at most 1048576 cells.');
  }
  const initialCount = sim.count;
  const attemptSpawn = (x: number, y: number): boolean => {
    const before = sim.count;
    sim.spawnAgent(x, y, 100);
    const added = sim.count - before;
    if (added !== 0 && added !== 1) {
      throw new Error('Cannot finish stress spawn: entity count changed unexpectedly.');
    }
    return added === 1;
  };
  const accepted: Array<readonly [number, number]> = [];
  for (let cell = 0; cell < width * height && sim.count - initialCount < requested; cell++) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (attemptSpawn(x, y)) accepted.push([x, y]);
  }
  if (requested > 0 && accepted.length === 0) {
    throw new Error('Cannot spawn stress agents: no grid cell accepted a spawn.');
  }
  const remaining = requested - (sim.count - initialCount);
  for (let i = 0; i < remaining; i++) {
    const [x, y] = accepted[i % accepted.length];
    if (!attemptSpawn(x, y)) {
      throw new Error('Cannot finish stress spawn: a previously accepted grid cell rejected a spawn.');
    }
  }
  return sim.count - initialCount;
}
