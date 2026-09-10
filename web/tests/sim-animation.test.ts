import { describe, expect, it } from 'vitest';
import { distanceAnimationFrame, tickAnimationFrame } from '../src/render/sim-animation.js';

describe('distanceAnimationFrame', () => {
  it('advances all eight samples forward in each physical facing', () => {
    for (const facing of [1, 2, 3, 4]) {
      const frames = Array.from({ length: 16 }, (_, i) => {
        const position = (i + 0.01) / 8;
        const signed = facing === 2 || facing === 4 ? -position : position;
        return distanceAnimationFrame(
          facing <= 2 ? signed : 0,
          facing >= 3 ? signed : 0,
          facing, 8, 1, false,
        );
      });
      expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('meets at frame zero for every signed integer corner', () => {
    for (const x of [-3, 0, 7]) for (const y of [-4, 0, 8]) {
      for (const facing of [1, 2, 3, 4]) {
        expect(distanceAnimationFrame(x, y, facing, 8, 1, false)).toBe(0);
      }
    }
  });

  it('uses the displayed axis rather than cancelling a diagonal first segment', () => {
    expect(distanceAnimationFrame(-0.3, 0.3, 2, 8, 1, false)).toBe(2);
    expect(distanceAnimationFrame(-0.3, 0.3, 3, 8, 1, false)).toBe(2);
  });

  it('has no time or hidden state to advance while paused or after load', () => {
    expect(distanceAnimationFrame(5.4, 7, 1, 8, 1, false)).toBe(3);
    distanceAnimationFrame(18.8, -4, 2, 8, 1, false);
    expect(distanceAnimationFrame(5.4, 7, 1, 8, 1, false)).toBe(3);
    expect(distanceAnimationFrame(5.4, 7, 1, 8, 1, true)).toBe(0);
  });

  it('rejects unauthored cycle lengths that cannot meet at tile corners', () => {
    expect(() => distanceAnimationFrame(0, 0, 1, 8, 0.64, false)).toThrow('tile corners');
  });
});

describe('tickAnimationFrame', () => {
  it('samples the whole clip and wraps, without freezing after one cycle', () => {
    expect(Array.from({ length: 10 }, (_, i) => tickAnimationFrame(i * 12, 0, 4, 12, false)))
      .toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    expect(tickAnimationFrame(11, 0, 4, 12, false)).toBe(0);
    expect(tickAnimationFrame(12, 0, 4, 12, false)).toBe(1);
  });

  it('keeps explicit entity phase and reduced-motion hold deterministic', () => {
    expect(tickAnimationFrame(8, 4, 4, 12, false)).toBe(1);
    expect(tickAnimationFrame(8, 4, 4, 12, true)).toBe(0);
  });
});
