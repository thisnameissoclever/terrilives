import { describe, expect, it } from 'vitest';

import { OverlayPauseController } from '../src/ui/overlay-pause.js';

describe('OverlayPauseController', () => {
  it('distinguishes builder ownership from other blocking overlays', () => {
    const controller = new OverlayPauseController({ setSpeed() {} }, () => {}, 1);
    controller.suspend('builder');
    expect(controller.suspendedExcept('builder')).toBe(false);
    controller.suspend('help');
    expect(controller.suspendedExcept('builder')).toBe(true);
    controller.resume('help');
    expect(controller.suspendedExcept('builder')).toBe(false);
  });
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

describe('OverlayPauseController selectedSpeed', () => {
  it('reports the speed the player chose and never the temporary pause', () => {
    const controller = new OverlayPauseController({ setSpeed() {} }, () => {}, 2);
    expect(controller.selectedSpeed).toBe(2);
    controller.suspend('career-graph');
    expect(controller.selectedSpeed, 'an overlay pauses the driver, not the choice').toBe(2);
    controller.selectSpeed(3);
    expect(controller.selectedSpeed, 'a speed chosen behind an overlay is remembered').toBe(3);
    controller.resume('career-graph');
    expect(controller.selectedSpeed).toBe(3);
  });

  it('reports 0 when the player had paused, so a window can say the game stays paused', () => {
    const applied: number[] = [];
    const controller = new OverlayPauseController({ setSpeed: speed => applied.push(speed) }, () => {}, 1);
    controller.selectSpeed(0);
    controller.suspend('career-graph');
    expect(controller.selectedSpeed).toBe(0);
    controller.resume('career-graph');
    expect(applied, 'closing restores the pause exactly').toEqual([0, 0, 0]);
  });
});
