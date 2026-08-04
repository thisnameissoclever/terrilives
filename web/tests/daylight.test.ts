import { describe, it, expect } from 'vitest';
import {
  AMBIENT_FLOOR,
  AMBIENT_NEUTRAL,
  ambientFor,
} from '../src/render/daylight.js';

// The day/night curve is the one piece of [ML-ambient] with arithmetic in
// it, so it is the piece that can be tested in Node rather than looked at.
// Same reasoning as iso.ts and instances.ts.

const DAY = 1440; // as authored in content/tuning.toml
const at = (hour: number): number => Math.round((hour / 24) * DAY);

describe('the daylight curve', () => {
  it('is a pure function of the tick', () => {
    // Lighting must never enter the world hash ([D12], and [ML-hash] in
    // the spec). The renderer cannot make that guarantee on its own, but
    // it can at least guarantee it never introduces state of its own:
    // same tick in, same colour out, no matter how often it is asked.
    const first = ambientFor(at(13), DAY);
    for (let i = 0; i < 5; i += 1) {
      expect(ambientFor(at(13), DAY)).toEqual(first);
    }
  });

  it('wraps at the end of the day instead of clamping', () => {
    // The last keyframe is at 22:30 and the first is midnight, so the
    // segment between them spans the wrap. Getting this wrong is not
    // subtle in the arithmetic and is very subtle on screen: the sky
    // would freeze for the last ninety minutes of every day.
    const beforeMidnight = ambientFor(DAY - 1, DAY);
    const afterMidnight = ambientFor(1, DAY);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs(beforeMidnight[channel] - afterMidnight[channel]),
        'the curve must be continuous across midnight',
      ).toBeLessThan(0.05);
    }
  });

  it('repeats every day', () => {
    expect(ambientFor(at(9), DAY)).toEqual(ambientFor(at(9) + DAY * 7, DAY));
  });

  it('is brighter at noon than at midnight', () => {
    const noon = ambientFor(at(12), DAY);
    const midnight = ambientFor(0, DAY);
    const sum = (c: readonly number[]): number => c[0]! + c[1]! + c[2]!;
    expect(sum(noon)).toBeGreaterThan(sum(midnight));
  });

  it('is cool at night and warm in the evening', () => {
    // Night that is merely DIM reads as a brightness slider rather than
    // as night; the blue channel leading is what sells it. Evening is the
    // mirror image, and if these two ever agree the curve has collapsed
    // into a single grey ramp.
    const midnight = ambientFor(0, DAY);
    expect(midnight[2], 'midnight must be blue-led').toBeGreaterThan(midnight[0]);

    const evening = ambientFor(at(19), DAY);
    expect(evening[0], 'evening must be red-led').toBeGreaterThan(evening[2]);
  });

  it('never falls below the readability floor', () => {
    // [ML-a11y]. The worst case is a dim phone in daylight, not a dark
    // room, and a night the player cannot read is a bug rather than
    // atmosphere. Every tick of a whole day, not a sampled few.
    for (let tick = 0; tick < DAY; tick += 1) {
      const ambient = ambientFor(tick, DAY);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          ambient[channel],
          `tick ${tick} channel ${channel} is below the floor`,
        ).toBeGreaterThanOrEqual(AMBIENT_FLOOR);
      }
    }
  });

  it('never exceeds 1, so no hour can blow out the art', () => {
    // The shader multiplies, so anything above 1 brightens past the
    // palette. Muted Line's whole point is that the palette is the
    // palette; the hour may darken and tint it, never overexpose it.
    for (let tick = 0; tick < DAY; tick += 1) {
      const ambient = ambientFor(tick, DAY);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(ambient[channel]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('answers neutral rather than dividing by zero on a broken clock', () => {
    // A zero-length day is a confused caller, not a colour. Answering
    // neutral keeps the world visible so whatever is actually wrong
    // surfaces where it happens rather than as a black screen here.
    expect(ambientFor(10, 0)).toEqual(AMBIENT_NEUTRAL);
    expect(ambientFor(10, -5)).toEqual(AMBIENT_NEUTRAL);
    expect(ambientFor(Number.NaN, DAY)).toEqual(AMBIENT_NEUTRAL);
  });

  it('handles a negative tick without indexing off the curve', () => {
    // JavaScript's `%` keeps the sign of the dividend, so a negative tick
    // lands outside [0, 1) unless it is normalised. Nothing produces one
    // today; this pins the normalisation so nothing has to remember.
    const ambient = ambientFor(-DAY - 30, DAY);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Number.isFinite(ambient[channel])).toBe(true);
      expect(ambient[channel]).toBeGreaterThanOrEqual(AMBIENT_FLOOR);
    }
  });

  it('works with the short days the simulation tests use', () => {
    // tuning.toml's day is 1440 ticks but the Rust tests run days of 23
    // and 30. The curve takes `dayTicks` as a parameter for exactly this
    // reason rather than assuming the shipped calendar.
    for (const day of [1, 23, 30]) {
      for (let tick = 0; tick < day; tick += 1) {
        const ambient = ambientFor(tick, day);
        expect(ambient.every((c) => Number.isFinite(c))).toBe(true);
      }
    }
  });
});
