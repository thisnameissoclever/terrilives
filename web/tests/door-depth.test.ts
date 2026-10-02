import { describe, it, expect } from 'vitest';
import { writePortals, type PortalSource } from '../src/render/portals.js';
import { spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE as STRIDE, OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP, OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X, OFFSET_SPRITE } from '../src/render/instances.js';

describe('solid door rendering', () => {
  function source(far: number[], amount = .5): PortalSource {
    return {
      portalCount: 1, portalPositions: () => new Float32Array([3, 2]),
      portalFrames: () => new Uint32Array([spriteIndex('frontDoorFrameSELeft')]),
      portalDepthOffsets: () => new Float32Array([.5]),
      portalLeaves: reduced => new Uint32Array([spriteIndex(reduced ? 'frontDoorOpenSELeft' : 'frontDoorAjarSELeft')]),
      portalFarSides: () => new Float32Array(far),
      portalOpenness: () => new Float32Array([amount]),
      portalPreviousOpenness: () => new Float32Array([0]),
    };
  }

  it('uses matching colour and surface depth in all four orientations and nine poses', () => {
    for (const [facing, far] of [[4, 2], [3, 3], [2, 2], [3, 1]].entries()) {
      for (let phase = 0; phase < 9; phase++) {
        const rows = new Float32Array(2 * STRIDE).fill(-999);
        writePortals(rows, 0, source(far, phase / 8), 0, 0, 16, 1, false, null);
        expect(rows[OFFSET_SPRITE]).toBe(spriteIndex(`doorFrame${facing}`));
        expect(rows[OFFSET_FOOTPRINT_SPAN]).toBe(spriteIndex(`doorFrame${facing}Depth`));
        expect(rows[STRIDE + OFFSET_SPRITE]).toBe(spriteIndex(`doorLeaf${facing}_${phase}`));
        expect(rows[STRIDE + OFFSET_FOOTPRINT_SPAN]).toBe(spriteIndex(`doorLeaf${facing}_${phase}Depth`));
        for (const base of [0, STRIDE]) {
          expect(rows[base + OFFSET_WALL_MASK]).toBe(-2);
          expect(rows[base + OFFSET_WALL_DEPTH_STEP]).toBeGreaterThan(0);
          expect(rows[base + OFFSET_PROJECTION_ANCHOR_X]).toBe(.5);
        }
      }
    }
  });

  it('interpolates the swing between simulation ticks and opens immediately for reduced motion', () => {
    const rows = new Float32Array(2 * STRIDE);
    for (const alpha of [0, .25, .5, .75, 1]) {
      writePortals(rows, 0, source([4, 2], 1), 0, 0, 16, 1, false, null, undefined, alpha);
      expect(rows[STRIDE + OFFSET_SPRITE]).toBe(spriteIndex(`doorLeaf0_${alpha * 8}`));
    }
    writePortals(rows, 0, source([4, 2]), 0, 0, 16, 1, true, null, undefined, 0);
    expect(rows[STRIDE + OFFSET_SPRITE]).toBe(spriteIndex('doorLeaf0_8'));
  });
});
