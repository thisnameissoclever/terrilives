import { weatherHash, weatherUnit, type WeatherSample } from './weather.js';
export const WEATHER_PARTICLE_FLOATS = 12;
export const INITIAL_WEATHER_PARTICLES = 128;
export function weatherTileSeed(x: number, y: number): number {
  return weatherHash(weatherHash(x) ^ Math.imul(y, 0x632be5ab));
}

/** A stable sparse field; adding another tile cannot evict an existing leaf. */
export function weatherCandidates(tiles: readonly (readonly [number, number])[], originX = 0, originY = 0): Float32Array<ArrayBuffer> {
  const stable = tiles.map(([x, y]) => [x - originX, y - originY] as const);
  return Float32Array.from(stable.filter(tile => weatherTileSeed(...tile) % 4 === 0).flat());
}

/** Reuses packed world-space rows; sampling does not retain simulation history. */
export function sampleWeatherParticles(output: Float32Array, tick: number, weather: WeatherSample,
  outside: Float32Array, reducedMotion: boolean): number {
  if (reducedMotion || outside.length === 0 || tick < weather.start
      || (weather.kind !== 2 && weather.kind !== 3)) return 0;
  const snow = weather.kind === 3;
  if (snow && tick >= weather.end) return 0;
  const limit = Math.min(outside.length / 2, Math.floor(output.length / WEATHER_PARTICLE_FLOATS));
  let count = 0;
  for (let i = 0; i < limit; i++) {
    const tile = i * 2;
    const seed = weatherHash(weather.seed ^ weatherTileSeed(outside[tile], outside[tile + 1]));
    const birth = weather.start + (weather.end - weather.start) * weatherUnit(seed ^ 0x31f8);
    const age = snow ? (tick - weather.start + weatherUnit(seed) * weather.fallTicks) % weather.fallTicks : tick - birth;
    if (age < 0 || (!snow && age >= weather.fallTicks + weather.groundTicks)) continue;
    const progress = Math.min(1, age / weather.fallTicks);
    const at = count++ * WEATHER_PARTICLE_FLOATS;
    const flutter = Math.sin(progress * Math.PI * 4 + weatherUnit(seed) * 6) * 0.08 * (1 - progress);
    output[at] = outside[tile] + (weatherUnit(seed ^ 0x56a3) - 0.5) * 0.65 + flutter;
    output[at + 1] = outside[tile + 1] + (weatherUnit(seed ^ 0x741e) - 0.5) * 0.65;
    output[at + 2] = (1 - progress) * (snow ? 2.4 : 1.8);
    output[at + 3] = snow ? 1.3 : 3.8;
    output[at + 4] = snow ? 1.3 : 2.2;
    output[at + 5] = weatherUnit(seed ^ 0x93a2) * Math.PI * 2 + (snow ? 0 : progress * 5);
    output[at + 6] = snow ? 0 : 1;
    output[at + 7] = snow ? 0.85 : Math.min(1, (weather.fallTicks + weather.groundTicks - age) / (weather.groundTicks * 0.25));
    const palette = seed % 3;
    output[at + 8] = snow ? 0.95 : palette === 0 ? 0.86 : palette === 1 ? 0.95 : 0.68;
    output[at + 9] = snow ? 0.98 : palette === 0 ? 0.35 : palette === 1 ? 0.65 : 0.20;
    output[at + 10] = snow ? 1 : 0.12;
    output[at + 11] = birth;
  }
  return count;
}
