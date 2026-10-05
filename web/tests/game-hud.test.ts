import { describe, expect, it } from 'vitest';
import { textWriteProbe } from './helpers/text-write-probe.js';

import {
  GameHud,
  formatActivity,
  formatFunds,
  formatSimTime,
  formatSatisfaction,
  type GameHudRoots,
  type GameHudSource,
  type TextTarget,
} from '../src/ui/game-hud.js';

function target(): TextTarget {
  return { textContent: '', hidden: false };
}

function roots(): GameHudRoots {
  return {
    clock: target(),
    funds: target(),
    satisfaction: target(),
    careerRow: target(),
    career: target(),
    activity: target(),
    ordersRow: target(),
    orders: target(),
  };
}

function source(overrides: Partial<GameHudSource> = {}): GameHudSource {
  return {
    selectedIndex: () => 34,
    satisfactionOf: () => 12.25,
    careerOf: () => 'Office clerk',
    activityOf: () => 1,
    chainStatusOf: () => null,
    stallReasonOf: () => null,
    queuedOrdersOf: () => 2,
    funds: () => 1234,
    clockTick: () => 1530,
    dayTicks: () => 1440,
    ...overrides,
  };
}

describe('game HUD formatting', () => {
  it.each([
    [12, 'Showering'], [13, 'Using the toilet'], [14, 'Watching TV'],
    [15, 'Lying down'], [16, 'Washing hands'], [17, 'Washing dishes'],
    [18, 'Listening to the radio'], [19, 'Handling correspondence'],
    [20, 'Bathing'], [21, 'Getting ingredients'], [22, 'Preparing food'], [23, 'Cooking'],
  ])('names exact authored activity %i as %s', (code, label) => {
    expect(formatActivity(code, null, null)).toBe(label);
  });
  it('formats day boundaries and the authored day length', () => {
    expect(formatSimTime(0, 1440)).toBe('Day 1, 00:00');
    expect(formatSimTime(359, 1440)).toBe('Day 1, 05:59');
    expect(formatSimTime(1440, 1440)).toBe('Day 2, 00:00');
    // A nonstandard content day still maps across a 24-hour display.
    expect(formatSimTime(50, 100)).toBe('Day 1, 12:00');
  });

  it('does not print NaN or Infinity into the player HUD', () => {
    expect(formatSimTime(Number.NaN, 1440)).toBe('Day and time unavailable');
    expect(formatFunds(Number.POSITIVE_INFINITY)).toBe('unavailable');
    expect(formatSatisfaction(Number.NaN)).toBe('unavailable');
    expect(formatSatisfaction(null)).toBe('unavailable');
  });

  it('prefers a chain or stall explanation over a generic activity', () => {
    expect(formatActivity(1, 'Bringing dinner to the table', null)).toBe(
      'Bringing dinner to the table',
    );
    expect(formatActivity(0, null, 'the door is blocked')).toBe(
      'Waiting: the door is blocked',
    );
    expect(formatActivity(5, null, null)).toBe('Sleeping');
    expect(formatActivity(7, null, null)).toBe('Using object');
    expect(formatActivity(8, null, null)).toBe('Reading');
    expect(formatActivity(9, null, null)).toBe('Exercising');
    expect(formatActivity(10, null, null)).toBe('Watching fish');
    expect(formatActivity(11, null, null)).toBe('Sitting');
  });
});

describe('GameHud', () => {
  it('shares one satisfaction read with the numeric value and meter, including deselection', () => {
    const view = roots();
    const rendered: (number | null)[] = [];
    let reads = 0;
    const hud = new GameHud(view, 100, { render: value => rendered.push(value) });
    hud.update(0, source({ satisfactionOf: () => { reads++; return 50; } }));
    expect(reads).toBe(1);
    expect(view.satisfaction.textContent).toBe('50.0');
    expect(rendered).toEqual([50]);
    hud.update(100, source({ selectedIndex: () => null }));
    expect(rendered).toEqual([50, null]);
  });
  it('preserves unchanged text while applying changed state and repairing external edits', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    hud.update(0, source());
    const probes = Object.values(view).map(textWriteProbe);
    hud.update(100, source());
    expect(probes.map(probe => probe.writes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    hud.update(200, source({ funds: () => 4321 }));
    expect(view.funds.textContent).toBe('4,321');
    expect(probes[1].writes).toBe(1);
    view.clock.textContent = 'External change';
    hud.update(300, source());
    expect(view.clock.textContent).toBe('Day 2, 01:30');
    expect(probes[0].writes).toBe(2);
  });

  it('shows the clock, funds and selected sim state together', () => {
    const view = roots();
    const hud = new GameHud(view, 100);

    expect(hud.update(0, source())).toBe(true);
    expect(view.clock.textContent).toBe('Day 2, 01:30');
    expect(view.funds.textContent).toBe('1,234');
    expect(view.satisfaction.textContent).toBe('12.3');
    expect(view.careerRow.hidden).toBe(false);
    expect(view.career.textContent).toBe('Office clerk');
    expect(view.activity.textContent).toBe('Walking');
    expect(view.ordersRow.hidden).toBe(false);
    expect(view.orders.textContent).toBe('2');
  });

  it('clears selection-only state and hides an absent career', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    hud.update(
      0,
      source({ selectedIndex: () => null, careerOf: () => 'stale career' }),
    );

    expect(view.satisfaction.textContent).toBe('unavailable');
    expect(view.careerRow.hidden).toBe(true);
    expect(view.career.textContent).toBe('');
    expect(view.activity.textContent).toBe('Nothing selected');
    expect(view.ordersRow.hidden).toBe(true);
  });

  it('throttles all reads as one coherent snapshot', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    let reads = 0;
    const counted = source({
      clockTick: () => {
        reads++;
        return 0;
      },
    });

    expect(hud.update(0, counted)).toBe(true);
    expect(hud.update(99, counted)).toBe(false);
    expect(hud.update(100, counted)).toBe(true);
    expect(reads).toBe(2);
  });
});
