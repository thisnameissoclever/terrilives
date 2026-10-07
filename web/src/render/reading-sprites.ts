import type { BedScene } from './bed-sprites.js';
import { distanceAnimationFrame } from './sim-animation.js';

export interface ReadingBodyProfile {
  readonly frameTicks: number;
  readonly frames: Readonly<Record<string, readonly BedScene[]>>;
}
export type ReadingBodyCatalog = Readonly<Record<string, ReadingBodyProfile>>;

/** Copy identity comes from native physical state; zero is a valid copy. */
export function readingBodyScene(catalog: ReadingBodyCatalog, stage: number, copy: number,
  action: number, facing: number, palette: number, tick: number, reducedMotion: boolean,
  x: number, y: number): BedScene | undefined {
  const key = stage === 3 && action === 4 ? 'standingRead'
    : copy !== 0xffffffff && stage !== 3 && stage !== 0
      ? action === 5 ? 'carry_walk' : 'carry_idle' : undefined;
  if (!key || !catalog[key] || facing < 1 || facing > 4) return undefined;
  const profile = catalog[key], frames = profile.frames[`${['SE', 'NW', 'SW', 'NE'][facing - 1]}:${palette}`];
  if (!frames?.length) throw new Error('Owned reading body is missing its facing or palette');
  const frame = reducedMotion ? 0 : key === 'carry_walk'
    ? distanceAnimationFrame(x, y, facing, frames.length, 1, false)
    : Math.floor(tick / profile.frameTicks) % frames.length;
  return frames[frame];
}
