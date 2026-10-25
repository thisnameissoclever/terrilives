import { expect, it } from 'vitest';
import { SPRITES, spriteIndex } from '../src/render/atlas.js';
import { sampleBodyCoverage, setBodyCoverage, installPackedBodyCoverage } from '../src/render/body-coverage.js';

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

it('rejects opaque padding without replacing existing body coverage', () => {
  const sprite=SPRITES.findIndex(rect=>(rect.w*rect.h)%8!==0),rect=SPRITES[sprite];
  expect(sprite).toBeGreaterThanOrEqual(0);
  setBodyCoverage(sprite,new Uint8Array(rect.w*rect.h).fill(42));
  const opaque=new Uint8Array(Math.ceil(rect.w*rect.h/8));opaque[opaque.length-1]=128;
  expect(()=>installPackedBodyCoverage(sprite,{opaque,partialPixels:new Uint32Array(),partialAlpha:new Uint8Array()})).toThrow(/padding/);
  expect(sampleBodyCoverage(sprite,0,0)).toBeCloseTo(42/255);
});
