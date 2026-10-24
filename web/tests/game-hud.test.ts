import { describe, expect, it } from 'vitest';
import { textWriteProbe } from './helpers/text-write-probe.js';

import {
  GameHud,
  SEASON_NAMES,
  WEEKDAY_NAMES,
  formatActivity,
  formatCareerSchedule,
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
    careerScheduleOf: () => ({ workingDays: 31, shiftStart: 360, shiftTicks: 480 }),
    activityOf: () => 1,
    chainStatusOf: () => null,
    stallReasonOf: () => null,
    queuedOrdersOf: () => 2,
    funds: () => 1234,
    clockTick: () => 1530,
    dayTicks: () => 1440,
    weekdayIndex: () => 1,
    seasonIndex: () => 0,
    weatherTuning: () => null,
    ...overrides,
  };
}

describe('game HUD formatting', () => {
  it('puts the season and current weather below the date and time', () => {
    expect(formatSimTime(360, 1440, 0, 3, 'snowing')).toBe('Day 1, Monday\n06:00\nWinter: snowing');
  });
  it('reads the current weather from content and keeps the weather when paused', () => {
    const view = roots(), hud = new GameHud(view, 100);
    const weather = { seed: 73517, chance: [0, 1, 1, 1], eventHours: 2,
      earliestHour: 10, latestHour: 10, leafHours: 2, fallMinutes: 15 };
    const winter = source({ clockTick: () => 600, seasonIndex: () => 3, weatherTuning: () => weather });
    hud.update(0, winter);
    expect(view.clock.textContent).toBe('Day 1, Tuesday\n10:00\nWinter: snowing');
    hud.update(1000, winter);
    expect(view.clock.textContent).toBe('Day 1, Tuesday\n10:00\nWinter: snowing');
    hud.update(2000, source({ clockTick: () => 720, seasonIndex: () => 3, weatherTuning: () => weather }));
    expect(view.clock.textContent).toBe('Day 1, Tuesday\n12:00\nWinter: mild');
  });
  it('calls the residual state idle instead of implying ongoing deliberation', () => {
    expect(formatActivity(0, null, null)).toBe('Idle');
  });

  it('identifies the person a committed initiator is waiting to talk to', () => {
    const r = roots();
    const s = source({ activityOf: () => 2,
      activityStatusOf: () => ({ code: 2, partner: 35, needs: 0 }),
      simName: () => 'Bill' });
    const hud = new GameHud(r, 100);
    hud.update(1000, s);
    expect(r.activity.textContent).toBe('Waiting to talk to Bill');
  });
  it.each(['Clean floor', 'Wipe surface - 1/1', 'Empty bin - 1/1'])(
    'preserves the active chore label %s when native context reports active work', (label) => {
      const r = roots();
      const s = source({ activityOf: () => 24, chainStatusOf: () => label,
        activityStatusOf: () => ({ code: 0, partner: null, needs: 0 }) });
      new GameHud(r, 100).update(1000, s);
      expect(r.activity.textContent).toBe(label);
    },
  );
  it.each([
    [12, 'Showering'], [13, 'Using the toilet'], [14, 'Watching TV'],
    [15, 'Lying down'], [16, 'Washing hands'], [17, 'Washing dishes'],
    [18, 'Listening to the radio'], [19, 'Handling correspondence'],
    [20, 'Bathing'], [21, 'Getting ingredients'], [22, 'Preparing food'], [23, 'Cooking'],
  ])('names exact authored activity %i as %s', (code, label) => {
    expect(formatActivity(code, null, null)).toBe(label);
  });
  it('formats day boundaries and the authored day length', () => {
    expect(formatSimTime(0, 1440, 0, 0)).toBe('Day 1, Monday\n00:00\nSpring: mild');
    expect(formatSimTime(359, 1440, 0, 0)).toBe('Day 1, Monday\n05:59\nSpring: mild');
    expect(formatSimTime(1440, 1440, 1, 0)).toBe('Day 2, Tuesday\n00:00\nSpring: mild');
    expect(formatSimTime(1440 * 6, 1440, 6, 0)).toBe('Day 7, Sunday\n00:00\nSpring: mild');
    // A nonstandard content day still maps across a 24-hour display.
    expect(formatSimTime(50, 100, 0, 0)).toBe('Day 1, Monday\n12:00\nSpring: mild');
  });

  it('keeps the day and the time on three lines whatever the weekday is called', () => {
    // Three fixed lines, so the HUD panel does not change height at midnight.
    for (const [weekday] of WEEKDAY_NAMES.entries()) {
      expect(formatSimTime(1440 * 99 + 1439, 1440, weekday, 2).split('\n')).toEqual([
        `Day 100, ${WEEKDAY_NAMES[weekday]}`,
        '23:59',
        'Autumn: mild',
      ]);
    }
    expect(formatSimTime(Number.NaN, 1440, 0, 0)).not.toContain('\n');
  });

  it('names every weekday in full, Monday first', () => {
    expect(WEEKDAY_NAMES).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    WEEKDAY_NAMES.forEach((name, weekday) => {
      expect(formatSimTime(0, 1440, weekday, 0)).toBe(`Day 1, ${name}\n00:00\nSpring: mild`);
    });
  });

  it('names the weekday the simulation reports instead of counting from the day number', () => {
    // A pack whose first day is a Sunday puts day 7 on a Saturday; only the
    // simulation knows first_weekday, so the clock prints what it is given.
    expect(formatSimTime(1440 * 6, 1440, 5, 0)).toBe('Day 7, Saturday\n00:00\nSpring: mild');
    expect(formatSimTime(1440 * 6, 1440, 0, 0)).toBe('Day 7, Monday\n00:00\nSpring: mild');
  });

  it('shows no clock rather than a wrong or missing weekday', () => {
    for (const weekday of [-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatSimTime(0, 1440, weekday, 0)).toBe('Day and time unavailable');
    }
  });

  // [SEA-hud] in docs/specs/2026-10-17-seasons.md: the season leads the
  // third line, below the time, and the clock stays three lines.
  it('names every season in full, Spring first, below the time', () => {
    expect(SEASON_NAMES).toEqual(['Spring', 'Summer', 'Autumn', 'Winter']);
    // The shipped year: days 1, 8, 15 and 22 begin the four seasons.
    expect(formatSimTime(0, 1440, 0, 0)).toBe('Day 1, Monday\n00:00\nSpring: mild');
    expect(formatSimTime(1440 * 7 + 360, 1440, 0, 1)).toBe('Day 8, Monday\n06:00\nSummer: mild');
    expect(formatSimTime(1440 * 14 + 720, 1440, 0, 2)).toBe('Day 15, Monday\n12:00\nAutumn: mild');
    expect(formatSimTime(1440 * 21 + 1439, 1440, 0, 3)).toBe('Day 22, Monday\n23:59\nWinter: mild');
    // The authored season names remain unchanged.
    for (const name of SEASON_NAMES) expect(name).toHaveLength(6);
  });

  it('names the season the simulation reports instead of counting from the day number', () => {
    // A pack that starts in Winter puts day 1 in Winter; only the simulation
    // knows first_season and days_per_season, so the clock prints its answer.
    expect(formatSimTime(0, 1440, 0, 3)).toBe('Day 1, Monday\n00:00\nWinter: mild');
    expect(formatSimTime(1440 * 7, 1440, 0, 0)).toBe('Day 8, Monday\n00:00\nSpring: mild');
  });

  it('shows no clock rather than a wrong or missing season', () => {
    for (const season of [-1, 4, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatSimTime(0, 1440, 0, season)).toBe('Day and time unavailable');
    }
  });

  it('describes a job by its working days and shift hours', () => {
    const office = { workingDays: 31, shiftStart: 360, shiftTicks: 480 };
    expect(formatCareerSchedule('Office clerk', office, 1440)).toBe(
      'Office clerk, Monday to Friday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1000001 }, 1440)).toBe(
      'Office clerk, Sunday to Monday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1001111 }, 1440)).toBe(
      'Office clerk, Sunday to Thursday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1110011 }, 1440)).toBe(
      'Office clerk, Friday to Tuesday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1000010 }, 1440)).toBe(
      'Office clerk, Tuesday, Sunday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1011001 }, 1440)).toBe(
      'Office clerk, Monday, Thursday, Friday, Sunday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1111111 }, 1440)).toBe(
      'Office clerk, every day, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b0010000 }, 1440)).toBe(
      'Office clerk, Friday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b1100000 }, 1440)).toBe(
      'Office clerk, Saturday to Sunday, 06:00 to 14:00',
    );
    expect(formatCareerSchedule('Office clerk', { ...office, workingDays: 0b0010101 }, 1440)).toBe(
      'Office clerk, Monday, Wednesday, Friday, 06:00 to 14:00',
    );
  });

  it('writes a shift that runs past midnight on the clock it ends on', () => {
    const night = { workingDays: 31, shiftStart: 1320, shiftTicks: 480 };
    expect(formatCareerSchedule('Night porter', night, 1440)).toBe(
      'Night porter, Monday to Friday, 22:00 to 06:00',
    );
    // A nonstandard content day maps onto the same 24-hour display.
    expect(formatCareerSchedule('Office clerk', { workingDays: 31, shiftStart: 25, shiftTicks: 25 }, 100))
      .toBe('Office clerk, Monday to Friday, 06:00 to 12:00');
  });

  it('keeps the job label when the schedule is missing or malformed', () => {
    const office = { workingDays: 31, shiftStart: 360, shiftTicks: 480 };
    expect(formatCareerSchedule('Office clerk', null, 1440)).toBe('Office clerk');
    expect(formatCareerSchedule('Office clerk', office, 0)).toBe('Office clerk');
    expect(formatCareerSchedule('Office clerk', office, Number.NaN)).toBe('Office clerk');
    for (const workingDays of [0, 128, -1, 1.5]) {
      expect(formatCareerSchedule('Office clerk', { ...office, workingDays }, 1440)).toBe('Office clerk');
    }
    expect(formatCareerSchedule('Office clerk', { ...office, shiftStart: Number.NaN }, 1440))
      .toBe('Office clerk');
    expect(formatCareerSchedule('Office clerk', { ...office, shiftTicks: -1 }, 1440))
      .toBe('Office clerk');
  });

  it('does not print NaN or Infinity into the player HUD', () => {
    expect(formatSimTime(Number.NaN, 1440, 0, 0)).toBe('Day and time unavailable');
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
    hud.update(200, source({ weekdayIndex: () => 2 }));
    expect(view.clock.textContent).toBe('Day 2, Wednesday\n01:30\nSpring: mild');
    expect(probes[0].writes).toBe(1);
    hud.update(300, source({ funds: () => 4321 }));
    expect(view.funds.textContent).toBe('4,321');
    expect(probes[1].writes).toBe(1);
    expect(view.clock.textContent).toBe('Day 2, Tuesday\n01:30\nSpring: mild');
    expect(probes[0].writes).toBe(2);
    // A new season rewrites the clock once, like a new weekday.
    hud.update(400, source({ seasonIndex: () => 1 }));
    expect(view.clock.textContent).toBe('Day 2, Tuesday\n01:30\nSummer: mild');
    expect(probes[0].writes).toBe(3);
    // The external edit is one write and the repair another.
    view.clock.textContent = 'External change';
    hud.update(500, source());
    expect(view.clock.textContent).toBe('Day 2, Tuesday\n01:30\nSpring: mild');
    expect(probes[0].writes).toBe(5);
  });

  it('names the held shift on the assembled Career row (issue 296, [WS-shell] item 1)', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    hud.update(0, source({
      careerScheduleOf: () => ({ workingDays: 0b1001111, shiftStart: 1320, shiftTicks: 480, kind: 3, index: 0 }),
    }));
    expect(view.careerRow.hidden).toBe(false);
    expect(view.career.textContent).toBe('Office clerk, Night shift, Sunday to Thursday, 22:00 to 06:00');
  });

  it('shows the clock, funds and selected sim state together', () => {
    const view = roots();
    const hud = new GameHud(view, 100);

    expect(hud.update(0, source())).toBe(true);
    expect(view.clock.textContent).toBe('Day 2, Tuesday\n01:30\nSpring: mild');
    expect(view.funds.textContent).toBe('1,234');
    expect(view.satisfaction.textContent).toBe('12.3');
    expect(view.careerRow.hidden).toBe(false);
    expect(view.career.textContent).toBe('Office clerk, Monday to Friday, 06:00 to 14:00');
    expect(view.activity.textContent).toBe('Walking');
    expect(view.ordersRow.hidden).toBe(false);
    expect(view.orders.textContent).toBe('2');
  });

  it('reads the career schedule of the selected sim only', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    const asked: number[] = [];
    hud.update(0, source({
      careerScheduleOf: entity => {
        asked.push(entity);
        return { workingDays: 0b1000001, shiftStart: 360, shiftTicks: 480 };
      },
    }));
    expect(asked).toEqual([34]);
    expect(view.career.textContent).toBe('Office clerk, Sunday to Monday, 06:00 to 14:00');
    hud.update(100, source({ careerScheduleOf: () => null }));
    expect(view.careerRow.hidden).toBe(false);
    expect(view.career.textContent).toBe('Office clerk');
  });

  it('hides the Career row and reads no schedule for a selected person without a job', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    let scheduleReads = 0;
    hud.update(0, source({
      careerOf: () => null,
      careerScheduleOf: () => {
        scheduleReads++;
        return { workingDays: 31, shiftStart: 360, shiftTicks: 480 };
      },
    }));
    expect(view.careerRow.hidden).toBe(true);
    expect(view.career.textContent).toBe('');
    expect(scheduleReads).toBe(0);
    expect(view.activity.textContent).toBe('Walking');
  });

  it('clears selection-only state and hides an absent career', () => {
    const view = roots();
    const hud = new GameHud(view, 100);
    let scheduleReads = 0;
    hud.update(
      0,
      source({
        selectedIndex: () => null,
        careerOf: () => 'stale career',
        careerScheduleOf: () => {
          scheduleReads++;
          return { workingDays: 31, shiftStart: 360, shiftTicks: 480 };
        },
      }),
    );
    expect(scheduleReads).toBe(0);

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
      weekdayIndex: () => {
        reads++;
        return 0;
      },
      seasonIndex: () => {
        reads++;
        return 0;
      },
    });

    expect(hud.update(0, counted)).toBe(true);
    expect(hud.update(99, counted)).toBe(false);
    expect(hud.update(100, counted)).toBe(true);
    // The tick, the weekday and the season, once each per refresh.
    expect(reads).toBe(6);
  });
});

describe('the held shift on the Career row (issue 296, [WS-shell] item 1)', () => {
  it('names the held shift on the Career row', () => {
    const office = { workingDays: 31, shiftStart: 360, shiftTicks: 480 };
    const named = ['Day shift', 'Early shift', 'Late shift', 'Night shift'];
    for (const [kind, name] of named.entries()) {
      expect(formatCareerSchedule('Office clerk', { ...office, kind, index: 0 }, 1440)).toBe(
        `Office clerk, ${name}, Monday to Friday, 06:00 to 14:00`,
      );
    }
    expect(formatCareerSchedule('Night watch', { workingDays: 0b1001111, shiftStart: 1320, shiftTicks: 480, kind: 3, index: 0 }, 1440))
      .toBe('Night watch, Night shift, Sunday to Thursday, 22:00 to 06:00');
    for (const kind of [4, -1, 0.5, Number.NaN, null, undefined]) {
      expect(formatCareerSchedule('Office clerk', { ...office, kind, index: 0 }, 1440), String(kind)).toBe(
        'Office clerk, Monday to Friday, 06:00 to 14:00',
      );
    }
    expect(formatCareerSchedule('Office clerk', { ...office, shiftTicks: -1, kind: 0 }, 1440)).toBe('Office clerk');
  });
});
