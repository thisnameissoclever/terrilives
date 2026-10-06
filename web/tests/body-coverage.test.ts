import { expect, it } from 'vitest';
import { SPRITES, spriteIndex } from '../src/render/atlas.js';
import { sampleBodyCoverage, setBodyCoverage } from '../src/render/body-coverage.js';

it('distinguishes transparent body pixels, solid body pixels and antialiased edges at atlas density', () => {
  const sprite = spriteIndex('rigSimBlueIdleSE0');
  const rect = SPRITES[sprite], density = rect.pixel_density ?? 1;
  const alpha = new Uint8Array(rect.w * rect.h);
  alpha[10 * rect.w + 20] = 255;
  alpha[10 * rect.w + 21] = 128;
  setBodyCoverage(sprite, alpha);
  expect(sampleBodyCoverage(sprite, 20.5 / density, 10.5 / density)).toBe(1);
  expect(sampleBodyCoverage(sprite, 21.5 / density, 10.5 / density)).toBeCloseTo(128 / 255);
  expect(sampleBodyCoverage(sprite, 22.5 / density, 10.5 / density)).toBe(0);
  expect(sampleBodyCoverage(sprite, 21 / density, 10.5 / density)).toBeCloseTo((255 + 128) / 510);
  expect(sampleBodyCoverage(sprite, -10, -10)).toBe(0);
});

it('rejects alpha arrays that cannot represent the published sprite', () => {
  expect(() => setBodyCoverage(spriteIndex('rigSimBlueIdleSE0'), new Uint8Array(2))).toThrow();
});
