import { expect, it, vi } from 'vitest';
import { buildInstanceBatch, buildInstances, instanceCount, simShirtVariant,
  simBodySprite, type RenderSource } from '../src/frame.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import { spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE, OFFSET_SPRITE, OFFSET_SCREEN_X } from '../src/render/instances.js';
import type { PlacementPreview } from '../src/bridge.js';

const none = 0xffffffff;
const box = spriteIndex('cardboardBoxOpen');
const foreground = spriteIndex('loungeChairRelaxForeground');
const ring = spriteIndex('selectionRing');

function fixture(count = 3) {
  const positions = new Float32Array(count * 2).fill(2);
  const ids = Uint32Array.from({ length: count }, (_, i) => 100 + i);
  const kinds = new Uint32Array(count).fill(1);
  const sprites = new Uint32Array(count).fill(box);
  const activities = new Uint32Array(count);
  const actions = new Uint32Array(count);
  const facings = new Uint32Array(count).fill(1);
  const carrying = new Uint32Array(count).fill(none);
  const foregrounds = new Uint32Array(count).fill(none);
  const targets = new Uint32Array(count).fill(none);
  const source: RenderSource = {
    count, positions: () => positions, prevPositions: () => positions,
    ids: () => ids, kinds: () => kinds, sprites: () => sprites,
    activities: () => activities, visualActions: () => actions,
    facings: () => facings, carrying: () => carrying,
    foregroundSprites: () => foregrounds, interactionTargets: () => targets,
    itemKinds: () => ['ingredients', 'dinner'],
  };
  return { source, kinds, sprites, activities, actions, carrying, foregrounds, targets };
}

function rows(data: Float32Array, count: number) {
  return Array.from({ length: count }, (_, i) => data[i * FLOATS_PER_INSTANCE + OFFSET_SPRITE]);
}

it('publishes exact combined writer rows including hidden fixed rows and the final highlight', () => {
  const f = fixture();
  f.kinds[0] = 0;
  f.activities[0] = 3;
  f.actions[0] = 2;
  f.foregrounds[1] = foreground;
  f.activities[2] = 6;
  f.carrying[2] = 1;
  f.foregrounds[2] = foreground;
  f.source.portals = () => ({ portalCount: 1,
    portalPositions: () => new Float32Array([3, 2]),
    portalFrames: () => new Uint32Array([box]),
    portalDepthOffsets: () => new Float32Array([0]),
    portalLeaves: reduced => new Uint32Array([reduced ? ring : foreground]),
    portalFarSides: () => new Float32Array([4, 2]) });
  const preview: PlacementPreview = { valid: true, reason: null, x: 9, y: 8,
    width: 1, depth: 1, facing: 1, sprite: box, foreground };
  const selection = new InteractionSelection({}, simShirtVariant);
  const update = vi.spyOn(selection, 'updateSource');
  const batch = buildInstanceBatch(f.source, 1, 100, 50, 16, 100, 2, true, 37,
    null, selection, preview, { tiles: [[7, 8], [8, 8]], valid: false });
  // 3 fixed + 2 portal + foreground + eating indicator + snack + selection
  // + 3 purchase preview + 2 highlight. The absent worker adds no extras.
  expect(batch.count).toBe(14);
  expect(rows(batch.instances, batch.count)).toEqual([
    simBodySprite(100, 2, 1, 37, true, 2, 2), box, 0,
    box, ring, foreground, spriteIndex('activityEat'), spriteIndex('heldSnack'),
    ring, ring, box, foreground, ring, ring,
  ]);
  expect(batch.instances[2 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBe(-1e6);
  expect(update).toHaveBeenCalledExactlyOnceWith(f.source, 37, true);
});

it('refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result', () => {
  const small = fixture(1), empty = fixture(0);
  const first = buildInstanceBatch(small.source, 1, 0, 0, 16);
  const oldArray = first.instances;
  const large = fixture(oldArray.length / FLOATS_PER_INSTANCE + 1);
  const grown = buildInstanceBatch(large.source, 1, 0, 0, 16);
  expect(grown).toBe(first);
  expect(grown.instances).not.toBe(oldArray);
  expect(grown.count).toBe(large.source.count);
  expect(grown.instances.length).toBeGreaterThanOrEqual(grown.count * FLOATS_PER_INSTANCE);
  expect(grown.instances[(grown.count - 1) * FLOATS_PER_INSTANCE + OFFSET_SPRITE]).toBe(box);
  const warm = grown.instances;
  expect(buildInstanceBatch(small.source, 1, 0, 0, 16, 100)).toBe(first);
  expect(first.count).toBe(2);
  expect(first.instances).toBe(warm);
  expect(rows(first.instances, 2)).toEqual([box, ring]);
  expect(buildInstances(empty.source, 1, 0, 0, 16)).toBe(warm);
  expect(first.count).toBe(0);
  expect(buildInstanceBatch(empty.source, 1, 0, 0, 16)).toBe(first);
  expect(first.instances).toBe(warm);
});

it.each([true, false])('replaces nonoverlapping moved furniture including refused=%s, then restores selection on empty preview', valid => {
  const f = fixture(1);
  f.foregrounds[0] = foreground;
  const preview: PlacementPreview = { valid, reason: valid ? null : 'blocked',
    x: 9, y: 8, width: 1, depth: 1, facing: 1, sprite: box, foreground };
  const batch = buildInstanceBatch(f.source, 1, 0, 0, 16, 100, 1, false, 0,
    null, undefined, preview);
  expect(batch.count).toBe(4);
  expect(batch.instances[OFFSET_SCREEN_X]).toBe(-1e6);
  expect(rows(batch.instances, 4)).toEqual([0, ring, box, foreground]);
  buildInstanceBatch(f.source, 1, 0, 0, 16, 100, 1, false, 0,
    null, undefined, { ...preview, width: 0 });
  expect(batch.count).toBe(3);
  expect(batch.instances[OFFSET_SCREEN_X]).toBe(0);
  expect(rows(batch.instances, 3)).toEqual([box, foreground, ring]);
});

it('packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter', () => {
  const f = fixture(2);
  f.kinds[0] = 0;
  f.actions[0] = 6;
  f.targets[0] = 101;
  f.foregrounds[1] = foreground;
  const bodyA = spriteIndex('rigSimExerciseSE0');
  const bodyB = spriteIndex('rigSimExerciseSE1');
  const selection = new InteractionSelection({ [box]: { action: 6, halfCycleTicks: 8,
    frames: { blue: [bodyA, bodyB], green: [bodyA, bodyB], red: [bodyA, bodyB] } } }, simShirtVariant);
  const update = vi.spyOn(selection, 'updateSource');
  const batch = buildInstanceBatch(f.source, 1, 100, 50, 16, null, 2, false, 8, null, selection);
  expect(batch.count).toBe(2);
  expect(rows(batch.instances, 2)).toEqual([bodyB, 0]);
  expect(batch.instances[FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBe(-1e6);
  expect(update).toHaveBeenCalledExactlyOnceWith(f.source, 8, false);
  update.mockClear();
  const highlight = { tiles: [[3, 4]], valid: true } as const;
  const legacy = buildInstances(f.source, 1, 100, 50, 16, 100, 2, true, 8, null,
    selection, null, highlight, 0, { width: 0, height: 0, values: new Float32Array(0) });
  expect(legacy).toBe(batch.instances);
  expect(batch.count).toBe(4);
  expect(rows(legacy, 4)).toEqual([bodyA, 0, ring, ring]);
  expect(update).toHaveBeenCalledExactlyOnceWith(f.source, 8, true);
  expect(instanceCount(f.source, 100, selection, null, highlight)).toBe(4);
});

it('publishes highlight-only, null and empty-highlight frames and exactly one held dinner', () => {
  const empty = fixture(0);
  const highlight = { tiles: [[2, 3], [3, 3]], valid: true } as const;
  const batch = buildInstanceBatch(empty.source, 1, 100, 50, 16, null, 2, false, 0,
    null, undefined, null, highlight);
  expect(batch.count).toBe(2);
  expect(rows(batch.instances, 2)).toEqual([ring, ring]);
  expect(Array.from(batch.instances.subarray(0, 4))).toEqual([
    36, 260, expect.any(Number), ring,
  ]);
  buildInstanceBatch(empty.source, 1, 100, 50, 16, null, 2, false, 0,
    null, undefined, null, { tiles: [], valid: false });
  expect(batch.count).toBe(0);
  buildInstanceBatch(empty.source, 1, 100, 50, 16);
  expect(batch.count).toBe(0);
  const f = fixture(1);
  f.kinds[0] = 0; f.activities[0] = 3; f.actions[0] = 2; f.carrying[0] = 1;
  buildInstanceBatch(f.source, 1, 0, 0, 16);
  expect(batch.count).toBe(3);
  expect(rows(batch.instances, 3)).toEqual([
    simBodySprite(100, 2, 1, 0, false, 2, 2), spriteIndex('activityEat'), spriteIndex('carried_dinner'),
  ]);
});
