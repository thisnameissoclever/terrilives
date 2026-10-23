import { describe, expect, it } from 'vitest';
import { sampleWeatherParticles, weatherCandidates, INITIAL_WEATHER_PARTICLES, WEATHER_PARTICLE_FLOATS } from '../src/render/weather-particles.js';
import type { WeatherSample } from '../src/render/weather.js';

const leaves: WeatherSample = { kind: 2, condition: 'breezy', start: 0, end: 120,
  groundTicks: 120, fallTicks: 15, seed: 77 };
const outside = Float32Array.from([4, 0, 4, 1, 4, 2]);
const output = () => new Float32Array(INITIAL_WEATHER_PARTICLES * WEATHER_PARTICLE_FLOATS);

it.each([[10, 0], [0, 10], [10, 10]])('keeps physical leaf identity when land shifts the lot by %s,%s', (dx, dy) => {
  const tiles: [number, number][] = [];
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) tiles.push([x, y]);
  const candidates = weatherCandidates(tiles);
  const rows = output(), shifted = output();
  const count = sampleWeatherParticles(rows, 120, leaves, candidates, false);
  const moved = weatherCandidates(tiles.map(([x, y]) => [x + dx, y + dy]), dx, dy);
  expect(moved.length).toBe(candidates.length);
  expect(moved).toEqual(candidates);
  expect(sampleWeatherParticles(shifted, 120, leaves, moved, false)).toBe(count);
  for (let row = 0; row < count; row++) {
    const at = row * WEATHER_PARTICLE_FLOATS;
    expect(shifted[at]).toBe(rows[at]);
    expect(shifted[at + 1]).toBe(rows[at + 1]);
    expect(shifted.slice(at + 2, at + WEATHER_PARTICLE_FLOATS)).toEqual(rows.slice(at + 2, at + WEATHER_PARTICLE_FLOATS));
  }
});

describe('weather particles', () => {
  it('keeps leaves on the same outdoor tiles after unrelated land or room edits', () => {
    const rows = output();
    const count = sampleWeatherParticles(rows, 120, leaves, outside, false);
    expect(count).toBeGreaterThan(0);
    const before = rows.slice(0, count * WEATHER_PARTICLE_FLOATS);
    const larger = Float32Array.from([4, 0, 4, 1, 4, 2, 4, 3]);
    sampleWeatherParticles(rows, 120, leaves, larger, false);
    expect(rows.slice(0, before.length)).toEqual(before);
    const smaller = Float32Array.from([4, 1, 4, 2]);
    const remaining = sampleWeatherParticles(rows, 120, leaves, smaller, false);
    expect(remaining).toBe(2);
    expect(rows.slice(0, remaining * WEATHER_PARTICLE_FLOATS)).toEqual(before.slice(WEATHER_PARTICLE_FLOATS));
  });
  it('settles into the same position and angle without snapping at landing', () => {
    const rows = output();
    sampleWeatherParticles(rows, 120, leaves, outside, false);
    const birth = rows[11];
    sampleWeatherParticles(rows, birth + 14.999, leaves, outside, false);
    const before = rows.slice(0, 6);
    sampleWeatherParticles(rows, birth + 15.001, leaves, outside, false);
    expect(rows[0]).toBeCloseTo(before[0], 3);
    expect(rows[5]).toBeCloseTo(before[5], 2);
  });
  it('lands autumn leaves, retains them for two hours, then removes them without needing intervening frames', () => {
    const rows = output();
    sampleWeatherParticles(rows, 120, leaves, outside, false);
    const birth = rows[11];
    expect(sampleWeatherParticles(rows, birth + 5, leaves, outside, false)).toBeGreaterThan(0);
    expect(rows[2]).toBeGreaterThan(0);
    expect(sampleWeatherParticles(rows, birth + 16, leaves, outside, false)).toBeGreaterThan(0);
    expect(rows[2]).toBe(0);
    const firstLeaf = [rows[0], rows[1]];
    expect(sampleWeatherParticles(rows, birth + 134, leaves, outside, false)).toBeGreaterThan(0);
    expect(rows[7]).toBeLessThan(1);
    const count = sampleWeatherParticles(rows, birth + 135.001, leaves, outside, false);
    expect(count).toBeGreaterThan(0);
    // The first leaf expires at minute 135; later leaves remain independently.
    expect([rows[0], rows[1]]).not.toEqual(firstLeaf);
    expect(sampleWeatherParticles(rows, 255, leaves, outside, false)).toBe(0);
  });

  it('spawns only within supplied outdoor tiles and clears particles when those tiles become enclosed', () => {
    const rows = output();
    const count = sampleWeatherParticles(rows, 90, leaves, outside, false);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      expect(Math.floor(rows[i * 12] + 0.5)).toBe(4);
      expect(Math.floor(rows[i * 12 + 1] + 0.5)).toBeGreaterThanOrEqual(0);
      expect(Math.floor(rows[i * 12 + 1] + 0.5)).toBeLessThanOrEqual(2);
    }
    expect(sampleWeatherParticles(rows, 90, leaves, new Float32Array(), false)).toBe(0);
    expect(sampleWeatherParticles(rows, 90, leaves, outside, true)).toBe(0);
  });

  it('bounds snow, leaves no accumulation, and freezes exactly at a paused game tick', () => {
    const rows = output(), snow = { ...leaves, kind: 3, condition: 'snowing' as const };
    const count = sampleWeatherParticles(rows, 50, snow, outside, false);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(INITIAL_WEATHER_PARTICLES);
    const before = rows.slice();
    expect(sampleWeatherParticles(rows, 50, snow, outside, false)).toBe(count);
    expect(rows).toEqual(before);
    sampleWeatherParticles(rows, 51, snow, outside, false);
    expect(rows).not.toEqual(before);
    expect(sampleWeatherParticles(rows, 120, snow, outside, false)).toBe(0);
    expect(sampleWeatherParticles(rows, -1, snow, outside, false)).toBe(0);
    expect(sampleWeatherParticles(rows, 50, { ...snow, kind: 1 }, outside, false)).toBe(0);
  });
});

it('keeps the production sparse field stable beyond the old 32-leaf cap', () => {
  const tiles: [number, number][] = [];
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) tiles.push([x, y]);
  const candidates = weatherCandidates(tiles);
  expect(candidates.length / 2).toBeGreaterThan(32);
  const rows = output();
  const count = sampleWeatherParticles(rows, 120, leaves, candidates, false);
  const before = rows.slice(0, count * WEATHER_PARTICLE_FLOATS);
  const more = weatherCandidates([...tiles, [17, 3], [18, 4], [19, 5]]);
  expect(more.length).toBeGreaterThan(candidates.length);
  sampleWeatherParticles(rows, 120, leaves, more, false);
  expect(rows.slice(0, before.length)).toEqual(before);
});
