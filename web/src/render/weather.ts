export interface WeatherTuning {
  readonly seed: number;
  readonly chance: readonly number[];
  readonly eventHours: number;
  readonly earliestHour: number;
  readonly latestHour: number;
  readonly leafHours: number;
  readonly fallMinutes: number;
}

export type WeatherCondition = 'mild' | 'hot' | 'breezy' | 'snowing';
export interface WeatherSample {
  readonly condition: WeatherCondition;
  readonly kind: number;
  readonly start: number;
  readonly end: number;
  readonly groundTicks: number;
  readonly fallTicks: number;
  readonly seed: number;
}

export function weatherAt(tick: number, dayTicks: number, season: number, tuning: WeatherTuning): WeatherSample {
  if (!Number.isFinite(tick) || tick < 0 || !Number.isFinite(dayTicks) || dayTicks <= 0
      || !Number.isInteger(season) || season < 0 || season > 3) {
    throw new Error(`Weather requires a valid game clock and season: tick=${tick}, dayTicks=${dayTicks}, season=${season}.`);
  }
  const day = Math.floor(tick / dayTicks);
  const seed = weatherHash(tuning.seed ^ weatherHash(day >>> 0) ^ weatherHash(Math.floor(day / 0x100000000)));
  const kind = season > 0 && weatherUnit(seed) < tuning.chance[season] ? season : 0;
  const startHour = tuning.earliestHour + weatherUnit(seed ^ 0x719a3d51) * (tuning.latestHour - tuning.earliestHour);
  const start = day * dayTicks + startHour * dayTicks / 24;
  const end = start + tuning.eventHours * dayTicks / 24;
  const active = kind !== 0 && tick >= start && tick < end;
  return { condition: active ? (['mild', 'hot', 'breezy', 'snowing'] as const)[kind] : 'mild',
    kind, start, end, groundTicks: dayTicks * tuning.leafHours / 24,
    fallTicks: dayTicks * tuning.fallMinutes / 1440, seed };
}

/** Stable presentation noise; never reads or advances the household's random generator. */
export function weatherHash(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function weatherUnit(value: number): number { return weatherHash(value) / 0x100000000; }
