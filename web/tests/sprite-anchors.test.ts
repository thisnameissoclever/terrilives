import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/atlas.js', () => ({
  SPRITES: [{ w: 38, h: 88 }, { w: 52, h: 104 }, { w: 52, h: 104 }],
  SPRITE_ANCHORS: { 1: [26, 96], 2: [25.5, 108.25] },
  SPRITE_CONTENT_TOPS: { 0: 5, 1: 13 },
}));

import { spriteAnchorY, spriteContentLift, spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';

describe('registered sprite anchors', () => {
  it('preserves bottom-centred legacy drawing', () => {
    expect(spriteDrawOffsetX(0)).toBe(0);
    expect(spriteDrawOffsetY(0)).toBe(0);
    expect(spriteAnchorY(0)).toBe(88);
  });

  it('preserves the same landmark after transparent padding at every zoom', () => {
    for (const zoom of [0.5, 1, 2, 3]) {
      const oldX = (-38 / 2 + 12) * zoom;
      const oldY = (-88 + 44) * zoom;
      expect((spriteDrawOffsetX(1) - 52 / 2 + 12 + 7) * zoom).toBe(oldX);
      expect((spriteDrawOffsetY(1) - 104 + 44 + 8) * zoom).toBe(oldY);
    }
    expect(spriteAnchorY(1)).toBe(96);
    expect(spriteContentLift(1)).toBe(spriteContentLift(0));
  });

  it('supports fractional ground registration beyond the image crop', () => {
    expect(spriteDrawOffsetX(2)).toBe(0.5);
    expect(spriteDrawOffsetY(2)).toBe(-4.25);
    expect(spriteAnchorY(2)).toBe(108.25);
  });
});
