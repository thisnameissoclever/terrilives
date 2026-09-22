import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPEN_SKY, buildSkyExposure, sampleShade, sampleSky } from '../src/render/sky.js';

// [OS-daylight] in docs/specs/2026-09-22-the-outside.md: a 6 by 3 lot whose
// house is the west 4 by 3, walled on its east side (the line at x = 4) but
// for a doorway on row 1.
const EDGES = [0, 4, 0, 0, 0, 4, 1, 1, 0, 4, 2, 0];
const exposure = (edges = EDGES, reach = 0.25) => buildSkyExposure(6, 3, edges, [4, 3], reach);

describe('buildSkyExposure', () => {
  it('opens every tile outside the house to the sky', () => {
    const sky = exposure();
    for (const [x, y] of [[4, 0], [5, 2], [4, 1]]) expect(sampleSky(sky, x, y)).toBe(1);
  });

  it('lets the sky in through the doorway, losing a step per tile', () => {
    const sky = exposure();
    expect([3, 2, 1, 0].map((x) => sampleSky(sky, x, 1))).toEqual([0.75, 0.5, 0.25, 0]);
    // Around the corner of the doorway: one more tile away.
    expect(sampleSky(sky, 3, 0)).toBe(0.5);
    expect(sampleSky(sky, 3, 2)).toBe(0.5);
  });

  it('is stopped by a wall, so a closed house is all shade', () => {
    const closed = [0, 4, 0, 0, 0, 4, 1, 0, 0, 4, 2, 0];
    const sky = exposure(closed);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) expect(sampleSky(sky, x, y)).toBe(0);
  });

  it('blocks a step through a horizontal wall too', () => {
    // A 2 by 3 lot: the house is the top 2 by 2, closed by a wall under row 1.
    const sky = buildSkyExposure(2, 3, [1, 0, 2, 0, 1, 1, 2, 0], [2, 2], 0.25);
    expect([sampleSky(sky, 0, 1), sampleSky(sky, 1, 1), sampleSky(sky, 0, 2)]).toEqual([0, 0, 1]);
    const open = buildSkyExposure(2, 3, [1, 0, 2, 0, 1, 1, 2, 1], [2, 2], 0.25);
    expect([sampleSky(open, 1, 1), sampleSky(open, 0, 1), sampleSky(open, 0, 0)]).toEqual([0.75, 0.5, 0.25]);
  });

  it('is open sky everywhere with no edges, no house, or a reach out of range', () => {
    expect(buildSkyExposure(6, 3, null, [4, 3], 0.25)).toBe(OPEN_SKY);
    expect(buildSkyExposure(6, 3, EDGES, null, 0.25)).toBe(OPEN_SKY);
    expect(buildSkyExposure(6, 3, EDGES, [4, 3], 0)).toBe(OPEN_SKY);
    expect(sampleSky(OPEN_SKY, 2, 1)).toBe(1);
  });

  it('turns exposure into shade, and treats a tile off the lot as open sky', () => {
    const sky = exposure();
    expect(sampleShade(sky, 2, 1)).toBe(0.5);
    expect(sampleShade(sky, -1, 0)).toBe(0);
    expect(sampleShade(sky, 2.5, 1)).toBe(0);
  });
});

describe('the sky wired into the page', () => {
  const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('shades by day only through the tuned shade, and not at all in flat light', () => {
    expect(MAIN_TS).toContain('lightingMode.isFlat() ? 0 : interiorDaylightShade * sunStrength(ambient),');
  });

  it('rebuilds the sky with the lamp field whenever the lot changes', () => {
    expect(MAIN_TS).toMatch(/lighting = buildLightField\(sim, lotWidth, lotHeight, lot\.walls, true, lot\.edges\);\s*sky = buildSky\(\);/);
  });
});
