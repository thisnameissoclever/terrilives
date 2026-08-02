import { describe, expect, it } from 'vitest';

import { OverlayPauseController } from '../src/ui/overlay-pause.js';

describe('OverlayPauseController', () => {
  it('pauses for an overlay and restores the player-selected speed', () => {
    const applied: number[] = [];
    const recorded: number[] = [];
    const controller = new OverlayPauseController(
      { setSpeed: (speed) => applied.push(speed) },
      (speed) => recorded.push(speed),
      1,
    );

    controller.suspend('help');
    expect(controller.suspended).toBe(true);
    expect(applied).toEqual([0]);
    expect(recorded).toEqual([]);

    controller.resume('help');
    expect(controller.suspended).toBe(false);
    expect(applied).toEqual([0, 1]);
    expect(recorded).toEqual([]);
  });

  it('keeps the driver paused when a speed is selected behind an overlay', () => {
    const applied: number[] = [];
    const recorded: number[] = [];
    const controller = new OverlayPauseController(
      { setSpeed: (speed) => applied.push(speed) },
      (speed) => recorded.push(speed),
      1,
    );

    controller.suspend('load');
    controller.selectSpeed(3);

    expect(applied).toEqual([0]);
    expect(recorded).toEqual([3]);

    controller.resume('load');
    expect(applied).toEqual([0, 3]);
  });

  it('waits for every blocker and ignores repeated lifecycle calls', () => {
    const applied: number[] = [];
    const controller = new OverlayPauseController(
      { setSpeed: (speed) => applied.push(speed) },
      () => {},
      2,
    );

    controller.suspend('help');
    controller.suspend('help');
    controller.suspend('load');
    controller.resume('help');
    controller.resume('help');
    expect(applied).toEqual([0]);

    controller.resume('load');
    expect(applied).toEqual([0, 2]);
  });
});
