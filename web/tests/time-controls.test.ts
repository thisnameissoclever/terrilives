import { describe, it, expect } from 'vitest';
import { SPEED_OPTIONS } from '../src/ui/time-controls.js';
import { FixedStepDriver } from '../src/frame.js';

describe('SPEED_OPTIONS', () => {
  it('offers exactly the pause, 1x, 2x and 3x that [D-8] names', () => {
    expect(SPEED_OPTIONS.map((option) => option.ticksPerFrame)).toEqual([
      0, 1, 2, 3,
    ]);
    // Distinct labels, because two buttons reading the same thing is a
    // control the player cannot use even when it works.
    const labels = SPEED_OPTIONS.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('offers only speeds the driver accepts, and each runs its own multiple', () => {
    // The list and the driver are separate files, so nothing but this
    // stops an option being added that `setSpeed` refuses - which would
    // be a button that throws when clicked, discovered by a player rather
    // than by a test.
    //
    // It also re-checks the multiplication end to end from the list the
    // page actually builds its buttons from, so a fractional speed added
    // here fails on the arithmetic as well as on the door check.
    const ELAPSED_MS = 1000;
    const counts = SPEED_OPTIONS.map((option) => {
      const driver = new FixedStepDriver(10, 1000);
      driver.setSpeed(option.ticksPerFrame);
      let ticks = 0;
      driver.advance(ELAPSED_MS, () => ticks++);
      // The step is the same size at every one of them; that is [D2] and
      // it is the half a step count cannot see.
      expect(driver.stepDurationMs).toBe(100);
      return ticks;
    });

    expect(counts).toEqual([0, 10, 20, 30]);
  });
});
