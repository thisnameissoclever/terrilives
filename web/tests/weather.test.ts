import { describe, expect, it } from 'vitest';
import { weatherAt, type WeatherTuning } from '../src/render/weather.js';

const tuning: WeatherTuning = { seed: 73517, chance: [0, 0.35, 0.4, 0.2],
  eventHours: 2, earliestHour: 7, latestHour: 17, leafHours: 2, fallMinutes: 15 };

describe('presentation weather', () => {
  it('snows on about one winter day in five, for only two game hours', () => {
    let snowDays = 0;
    for (let day = 0; day < 10000; day++) {
      const schedule = weatherAt(day * 1440, 1440, 3, tuning);
      if (schedule.kind !== 3) continue;
      snowDays++;
      expect(schedule.end - schedule.start).toBe(120);
      expect(schedule.start - day * 1440).toBeGreaterThanOrEqual(420);
      expect(schedule.start - day * 1440).toBeLessThanOrEqual(1020);
      expect(weatherAt(schedule.start - 1, 1440, 3, tuning).condition).toBe('mild');
      expect(weatherAt(schedule.start, 1440, 3, tuning).condition).toBe('snowing');
      expect(weatherAt(schedule.end - 1, 1440, 3, tuning).condition).toBe('snowing');
      expect(weatherAt(schedule.end, 1440, 3, tuning).condition).toBe('mild');
    }
    expect(snowDays).toBeGreaterThan(1800);
    expect(snowDays).toBeLessThan(2200);
  });

  it('uses the supplied season, including retuned calendars, and supports short days', () => {
    const always = { ...tuning, chance: [0, 1, 1, 1] };
    for (const [season, condition] of [[0, 'mild'], [1, 'hot'], [2, 'breezy'], [3, 'snowing']] as const) {
      const schedule = weatherAt(0, 100, season, always);
      expect(weatherAt(schedule.start, 100, season, always).condition).toBe(condition);
      if (season > 0) expect(schedule.end - schedule.start).toBeCloseTo(100 / 12);
    }
  });

  it('reconstructs the same event after rewinding or skipping frames', () => {
    const always = { ...tuning, chance: [0, 1, 1, 1] };
    const original = weatherAt(1000, 1440, 2, always);
    weatherAt(100000, 1440, 3, tuning);
    expect(weatherAt(1000, 1440, 2, always)).toEqual(original);
    expect(weatherAt(1000, 1440, 2, always)).toEqual(original);
    expect(weatherAt(1000, 1440, 2, { ...always, seed: 73518 })).not.toEqual(original);
    expect(original.groundTicks).toBe(120);
    expect(original.fallTicks).toBe(15);
  });
});
