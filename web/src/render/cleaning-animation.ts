/** Cleaning poses follow saved work progress, rather than a wall-clock timer. */
export function cleaningFrame(action: number, progress: number, count: number, reducedMotion: boolean): number {
  if (count <= 1) return 0;
  if (reducedMotion) return Math.floor(count / 2);
  const phase = Math.max(0, Math.min(1000, progress));
  if (action === 17) return Math.min(count - 1, Math.floor(phase * count / 1000));
  const cycles = action === 14 ? 1 : 3;
  return Math.floor(((phase * cycles) % 1000) * count / 1000);
}
