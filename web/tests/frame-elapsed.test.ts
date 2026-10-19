import { expect, it } from 'vitest';
import { FixedStepDriver, frameElapsedMs } from '../src/frame.js';

it('does not run game time backward when the first animation timestamp precedes setup', () => {
  const driver = new FixedStepDriver(10, 5);
  let ticks = 0;
  expect(driver.advance(frameElapsedMs(980, 1000), () => ticks++)).toBe(0);
  driver.advance(frameElapsedMs(1080, 980), () => ticks++);
  expect(ticks).toBe(1);
  expect(frameElapsedMs(1080, 1080)).toBe(0);
  expect(frameElapsedMs(1105, 1080)).toBe(25);
});
