/** Clip sampling uses simulation values only, so Pause and Load need no cache. */
function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Advance along the displayed facing. Using x+y can cancel movement when a
 * redirected path begins with a diagonal segment. Integer waypoints meet at
 * phase zero when a tile contains a whole number of authored gait cycles.
 */
export function distanceAnimationFrame(
  x: number,
  y: number,
  facing: number,
  frameCount: number,
  cycleTiles: number,
  reducedMotion: boolean,
): number {
  if (cycleTiles <= 0 || !Number.isFinite(cycleTiles) ||
      Math.abs(1 / cycleTiles - Math.round(1 / cycleTiles)) > 1e-9) {
    throw new Error('Gait cycle length must meet at integer tile corners');
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error('Animation frame count must be a positive integer');
  }
  if (reducedMotion || facing < 1 || facing > 4 || !Number.isInteger(facing)) return 0;
  const axis = facing <= 2 ? x : y;
  const sign = facing === 2 || facing === 4 ? -1 : 1;
  return Math.floor(positiveModulo(sign * axis, cycleTiles) / cycleTiles * frameCount);
}

/** Keep the authored action cadence while supporting more than two samples. */
export function tickAnimationFrame(
  simulationTick: number,
  phaseTicks: number,
  frameCount: number,
  ticksPerFrame: number,
  reducedMotion: boolean,
): number {
  if (!Number.isInteger(frameCount) || frameCount < 1 ||
      !Number.isFinite(ticksPerFrame) || ticksPerFrame <= 0) {
    throw new Error('Animation count and frame duration must be positive');
  }
  return reducedMotion ? 0 : positiveModulo(
    Math.floor((simulationTick + phaseTicks) / ticksPerFrame), frameCount,
  );
}
