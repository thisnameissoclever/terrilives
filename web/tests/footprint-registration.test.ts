import { expect, it, vi } from 'vitest';

// Distinct transparent padding is a valid authoring input. Current centered
// canvases alone cannot detect accidentally sharing body/foreground anchors.
vi.mock('../src/render/atlas.js', async importOriginal => {
  const atlas = await importOriginal<typeof import('../src/render/atlas.js')>();
  return { ...atlas, SPRITE_ANCHORS: { ...atlas.SPRITE_ANCHORS,
    [atlas.spriteIndex('offlineDeskSW')]: [64, 144],
    [atlas.spriteIndex('offlineBunk')]: [60, 124],
  } };
});

import { buildInstances, type RenderSource } from '../src/frame.js';
import { writePlacementPreview } from '../src/render/placement-preview.js';
import { spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, OFFSET_PROJECTION_ANCHOR_X } from '../src/render/instances.js';

it('registers foreground independently in actual frames and placement previews', () => {
  const sprite = spriteIndex('offlineDeskSW'), foreground = spriteIndex('offlineBunk');
  const floats = new Float32Array([6.5, 6]), zero = new Uint32Array([0]);
  const source: RenderSource = { count: 1, positions: () => floats, prevPositions: () => floats,
    ids: () => zero, kinds: () => new Uint32Array([1]), sprites: () => new Uint32Array([sprite]),
    foregroundSprites: () => new Uint32Array([foreground]),
    footprintWidths: () => new Uint32Array([2]), footprintDepths: () => new Uint32Array([1]),
    activities: () => zero, visualActions: () => zero, facings: () => zero,
    carrying: () => new Uint32Array([0xffffffff]), itemKinds: () => [] };
  const frame = buildInstances(source, 1, 0, 0, 16);
  expect(frame[OFFSET_PROJECTION_ANCHOR_X]).toBe(16);
  expect(frame[FLOATS_PER_INSTANCE + OFFSET_PROJECTION_ANCHOR_X]).toBe(-10);
  const preview = new Float32Array(4 * FLOATS_PER_INSTANCE);
  writePlacementPreview(preview, 0, { valid: true, reason: null, x: 6, y: 6, width: 2,
    depth: 1, sprite, foreground, facing: 1 }, 0, 0, 16, 1, null);
  expect(preview[2 * FLOATS_PER_INSTANCE + OFFSET_PROJECTION_ANCHOR_X]).toBe(16);
  expect(preview[3 * FLOATS_PER_INSTANCE + OFFSET_PROJECTION_ANCHOR_X]).toBe(-10);
});
