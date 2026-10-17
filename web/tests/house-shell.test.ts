import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { edgesWithShell } from '../src/render/house-shell.js';
import { buildSkyExposure, sampleSky } from '../src/render/sky.js';

describe('edgesWithShell', () => {
  it('adds nothing while the house stands at the grid origin', () => {
    const edges = new Uint32Array([0, 3, 2, 0]);
    expect(edgesWithShell(edges, [16, 12], [0, 0], 20, 16)).toBe(edges);
    expect(edgesWithShell(null, [16, 12], [10, 0], 30, 16)).toBeNull();
    expect(edgesWithShell(edges, null, [10, 0], 30, 16)).toBe(edges);
  });

  it('adds the west shell once land lies behind the house, and the north shell once land lies beside it', () => {
    const west = edgesWithShell(new Uint32Array(0), [16, 12], [10, 0], 30, 16)!;
    expect(west.length).toBe(12 * 4);
    for (let y = 0; y < 12; y++) expect([...west.subarray(y * 4, y * 4 + 4)]).toEqual([0, 10, y, 0]);
    const north = edgesWithShell(new Uint32Array([1, 5, 3, 1]), [16, 12], [0, 10], 20, 26)!;
    expect([...north.subarray(0, 4)]).toEqual([1, 5, 3, 1]);
    expect(north.length).toBe(4 + 16 * 4);
    for (let x = 0; x < 16; x++) expect([...north.subarray(4 + x * 4, 8 + x * 4)]).toEqual([1, x, 10, 0]);
    const both = edgesWithShell(new Uint32Array(0), [16, 12], [10, 10], 30, 26)!;
    expect(both.length).toBe((12 + 16) * 4);
  });
});

describe('the sky with the house away from the origin', () => {
  it('does not flood through the house back wall from the bought land', () => {
    const house: [number, number] = [16, 12];
    const origin: [number, number] = [10, 0];
    const bare = buildSkyExposure(30, 16, new Uint32Array(0), house, 0.2, [], origin);
    // Without the shell, the yard behind the house floods straight in.
    expect(sampleSky(bare, 9, 5)).toBe(1);
    expect(sampleSky(bare, 10, 5)).toBeCloseTo(0.8);
    const shelled = buildSkyExposure(30, 16, edgesWithShell(new Uint32Array(0), house, origin, 30, 16),
      house, 0.2, [], origin);
    expect(sampleSky(shelled, 9, 5)).toBe(1);
    expect(sampleSky(shelled, 10, 5)).toBe(0);
    // The house's own east side still opens onto the yard.
    expect(sampleSky(shelled, 25, 5)).toBeCloseTo(0.8);
  });

  it('is what the shell gives both the light field and the sky', () => {
    const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(MAIN_TS.split('buildLightField(sim, lotWidth, lotHeight, lot.walls, true, lightingEdges(), lot.windows)')).toHaveLength(3);
    expect(MAIN_TS).toContain('buildSkyExposure(lot.width, lot.height, lightingEdges(), lot.house ?? null, daylightReachPerTile, lot.windows, lot.houseOrigin)');
  });
});
