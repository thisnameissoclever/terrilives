import { describe, expect, it } from 'vitest';
import { bandsInHundredths, preferenceHundredths, reactionOf } from '../src/reaction-band.js';

const BANDS = bandsInHundredths({ loves: 0.6, likes: 0.2 });

describe('reaction bands', () => {
  it('converts the tuning edges to hundredths', () => {
    expect(BANDS).toEqual({ loves: 60, likes: 20 });
  });

  it('rounds a preference half away from zero, as the simulation records it', () => {
    // 0.125 is exact in binary, so 12.5 is a true half.
    expect(preferenceHundredths(0.125)).toBe(13);
    expect(preferenceHundredths(-0.125)).toBe(-13);
    // Single precision decides these: a double-precision product would give 19 and -19.
    expect(preferenceHundredths(Math.fround(0.195))).toBe(20);
    expect(preferenceHundredths(Math.fround(-0.195))).toBe(-20);
    expect(preferenceHundredths(0)).toBe(0);
    expect(preferenceHundredths(Number.NaN)).toBe(0);
  });

  it('names each band at and across its edges', () => {
    const cases: [number, string][] = [
      [100, 'loves'], [60, 'loves'], [59, 'likes'], [20, 'likes'], [19, 'neutral'],
      [0, 'neutral'], [-19, 'neutral'], [-20, 'dislikes'], [-59, 'dislikes'], [-60, 'hates'], [-100, 'hates'],
    ];
    for (const [hundredths, reaction] of cases) expect(reactionOf(hundredths, BANDS)).toBe(reaction);
  });
});
