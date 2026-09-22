import { describe, expect, it } from 'vitest';
import { buildInstances, instanceCount, type RenderSource } from '../src/frame.js';
import { FLOATS_PER_INSTANCE, OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP,
  OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X, OFFSET_COLOURWAY_HUE } from '../src/render/instances.js';
import { spriteIndex } from '../src/render/atlas.js';
import { spriteDrawOffsetX } from '../src/render/sprite-anchors.js';

function fixture(width = 2, depth = 1, occupied = false): RenderSource {
  const positions = new Float32Array([9.5, 6, 9, 7]);
  return {
    count: occupied ? 2 : 1, positions: () => positions, prevPositions: () => positions,
    ids: () => new Uint32Array([40, 7]), kinds: () => new Uint32Array([1, 0]),
    sprites: () => new Uint32Array([spriteIndex('offlineBunk'), spriteIndex('sim')]),
    footprintWidths: () => new Uint32Array([width, 1]),
    footprintDepths: () => new Uint32Array([depth, 1]),
    activities: () => new Uint32Array([0, 3]), visualActions: () => new Uint32Array([0, 9]),
    facings: () => new Uint32Array([1, 1]), carrying: () => new Uint32Array([0xffffffff, 0xffffffff]),
    itemKinds: () => [], interactionTargets: () => new Uint32Array([0xffffffff, 40]),
    simIds: () => new Uint32Array([0, 1]),
  };
}

describe('footprint projection at the frame boundary', () => {
  it('uses oriented dimensions and registered anchors, independent of camera zoom', () => {
    for (const [width, depth, span] of [[2, 1, 0.5], [1, 2, -0.5], [3, 1, 1]]) {
      for (const scale of [1, 1.75, 3]) {
        const out = buildInstances(fixture(width, depth), 1, 0, 0, 16, null, scale);
        expect(out[OFFSET_WALL_MASK]).toBe(-1);
        expect(out[OFFSET_WALL_DEPTH_STEP]).toBeCloseTo(0.031219482421875, 8);
        expect(out[OFFSET_FOOTPRINT_SPAN]).toBe(span);
        expect(out[OFFSET_PROJECTION_ANCHOR_X]).toBe(spriteDrawOffsetX(spriteIndex('offlineBunk')));
      }
    }
  });

  it('uses the occupied furniture footprint, not the one-tile Sim, and clears the suppressed owner', () => {
    const source = fixture(2, 1, true);
    const out = buildInstances(source, 1, 0, 0, 16);
    expect(Array.from(out.subarray(8, 12))).toEqual([0, 0, 0, 0]);
    const body = FLOATS_PER_INSTANCE;
    expect(out[body + OFFSET_WALL_MASK]).toBe(-1);
    expect(out[body + OFFSET_FOOTPRINT_SPAN]).toBe(0.5);
    const sprite = out[body + 3];
    expect(sprite).not.toBe(spriteIndex('sim'));
    expect(out[body + OFFSET_PROJECTION_ANCHOR_X]).toBe(spriteDrawOffsetX(sprite));
    for (let row = 2; row < instanceCount(source, null); row++) {
      const base = row * FLOATS_PER_INSTANCE;
      expect(out[base + OFFSET_WALL_MASK]).toBe(-1);
      expect(out[base + OFFSET_FOOTPRINT_SPAN]).toBe(0.5);
      expect(out[base + 2]).toBeLessThan(out[body + 2]);
    }
  });

  it('keeps foreground depth aligned and clears projection when a reused row becomes square', () => {
    const source = fixture();
    source.foregroundSprites = () => new Uint32Array([spriteIndex('offlineBunk')]);
    const out = buildInstances(source, 1, 0, 0, 16);
    expect(Array.from(out.subarray(8, 12))).toEqual(Array.from(out.subarray(FLOATS_PER_INSTANCE + 8, FLOATS_PER_INSTANCE + 12)));
    const square = buildInstances(fixture(2, 2), 1, 0, 0, 16);
    expect(Array.from(square.subarray(8, 12))).toEqual([0, 0, 0, 0]);
  });
});

// [RC-render] in docs/specs/2026-09-22-colourways.md: an object's colourway
// reaches its own picture, its foreground layer, and the picture of a sim
// using it, where the shader turns the furniture layer only; a sim using
// nothing carries no shift.
describe('colourways at the frame boundary', () => {
  const shifts = new Float32Array([0, 1, 0, 120, 1.4, -0.04]);
  const recoloured = [120, expect.closeTo(0.4), expect.closeTo(-0.04), 0];
  const none = [0, 0, 0, 0];
  const shiftAt = (out: Float32Array, slot: number) => Array.from(out.subarray(
    slot * FLOATS_PER_INSTANCE + OFFSET_COLOURWAY_HUE, (slot + 1) * FLOATS_PER_INSTANCE));

  it('draws an object, its foreground and a sim using it in the colourway of the object', () => {
    const alone = fixture();
    alone.colourways = () => new Uint32Array([1]);
    alone.colourwayShifts = () => shifts;
    alone.foregroundSprites = () => new Uint32Array([spriteIndex('offlineBunk')]);
    const out = buildInstances(alone, 1, 0, 0, 16);
    expect(shiftAt(out, 0)).toEqual(recoloured);
    expect(shiftAt(out, 1)).toEqual(recoloured);

    const occupied = fixture(2, 1, true);
    occupied.colourways = () => new Uint32Array([1, 0]);
    occupied.colourwayShifts = () => shifts;
    expect(shiftAt(buildInstances(occupied, 1, 0, 0, 16), 1)).toEqual(recoloured);

    const idle = fixture(2, 1, true);
    idle.interactionTargets = () => new Uint32Array([0xffffffff, 0xffffffff]);
    idle.colourways = () => new Uint32Array([1, 0]);
    idle.colourwayShifts = () => shifts;
    const still = buildInstances(idle, 1, 0, 0, 16);
    expect(shiftAt(still, 0)).toEqual(recoloured);
    expect(shiftAt(still, 1)).toEqual(none);
  });
});
