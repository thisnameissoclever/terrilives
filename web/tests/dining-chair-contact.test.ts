import { expect, it } from 'vitest';
import { buildInstances, instanceCount, type RenderSource } from '../src/frame.js';
import { pickSprite } from '../src/input.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import { spriteWidth, spriteHeight } from '../src/render/sprite-size.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { INTERACTION_SPRITES, SPRITE_PAIR_COVERAGE, SPRITE_PAIR_MASKS,
  SPRITE_PAIRS, spriteIndex } from '../src/render/atlas.js';

const none = 0xffffffff;
export function diningSource(empty: number): RenderSource {
  const position = new Float32Array([0, 0, 0, 0]);
  return { count: 2, positions: () => position, prevPositions: () => position,
    ids: () => new Uint32Array([101, 102]), kinds: () => new Uint32Array([1, 0]),
    sprites: () => new Uint32Array([empty, spriteIndex('sim')]),
    activities: () => new Uint32Array([0, 3]), visualActions: () => new Uint32Array([0, 13]),
    interactionTargets: () => new Uint32Array([none, 101]),
    simIds: () => new Uint32Array([none, 0]), facings: () => new Uint32Array(2),
    itemKinds: () => [], carrying: () => new Uint32Array(2).fill(none) };
}

it.each(['', 'SW', 'NW', 'NE'])('samples the claimed dining chair and visible owners in facing %s', suffix => {
  const empty = spriteIndex(`offlineDiningChair${suffix}`);
  const source = diningSource(empty);
  for (const variant of ['green', 'blue', 'red'] as const) {
    const selection = new InteractionSelection(INTERACTION_SPRITES, () => variant);
    const profile = INTERACTION_SPRITES[empty];
    expect(profile.action).toBe(13);
    expect(profile.frames[variant]).toHaveLength(8);
    for (let phase = 0; phase < 8; phase++) {
      const tick = phase * 4 - 102 % 16 + 32;
      const data = buildInstances(source, 1, 0, 0, 16, null, 2, false, tick, null, selection);
      const sprite = data[FLOATS_PER_INSTANCE + 3];
      expect(sprite).toBe(profile.frames[variant][phase]);
      expect(data[0]).toBe(-1e6);
      expect(instanceCount(source, null, selection)).toBe(3);
      expect(SPRITE_PAIRS[sprite]).toBeDefined();
      const [bodyMask, chairMask] = SPRITE_PAIR_COVERAGE[sprite];
      const body = SPRITE_PAIR_MASKS[bodyMask], wood = SPRITE_PAIR_MASKS[chairMask];
      const probes: Record<string, [number, number] | undefined> = {};
      for (let y = 0; y < 224; y++) for (let x = 0; x < 160; x++) {
        const b = sampleBedCoverage(body, x, y), w = sampleBedCoverage(wood, x, y);
        if (b > .95 && w === 0) probes[y >= body.box[3] - 14 ? 'shoe' : 'body'] ??= [x, y];
        if (w > .95 && b === 0) probes[y < 150 ? 'rail' : 'seat'] ??= [x, y];
      }
      for (const [part, pixel] of Object.entries(probes)) {
        expect(pixel).toBeDefined();
        const [x, y] = pixel!;
        const px = spriteDrawOffsetX(sprite) * 2 - spriteWidth(sprite) + x + .5;
        const py = (21 + spriteDrawOffsetY(sprite) - spriteHeight(sprite)) * 2 + y + .5;
        const picked = pickSprite({ ...source, clockTick: () => tick }, px, py, 0, 0, 2, false, selection);
        expect(picked, `${suffix}/${variant}/${phase}/${part}`).toEqual(
          { entity: part === 'body' || part === 'shoe' ? 102 : 101,
            isAgent: part === 'body' || part === 'shoe' });
      }
      expect(probes.body).toBeDefined(); expect(probes.shoe).toBeDefined();
      expect(probes.rail).toBeDefined(); expect(probes.seat).toBeDefined();
    }
    const reduced = buildInstances(source, 1, 0, 0, 16, null, 1, true, 73, null, selection);
    expect(reduced[FLOATS_PER_INSTANCE + 3]).toBe(profile.frames[variant][0]);
  }
});

it('picks outlined chair edges, isolated body ink and the occupied scene above an equal-depth person', () => {
  const empty = spriteIndex('offlineDiningChair');
  const base = diningSource(empty);
  const source: RenderSource & { clockTick(): number } = { ...base, count: 3,
    positions: () => new Float32Array(6), prevPositions: () => new Float32Array(6),
    ids: () => new Uint32Array([101, 102, 103]), kinds: () => new Uint32Array([1, 0, 0]),
    sprites: () => new Uint32Array([empty, spriteIndex('sim'), spriteIndex('sim')]),
    activities: () => new Uint32Array([0, 3, 0]), visualActions: () => new Uint32Array([0, 13, 0]),
    interactionTargets: () => new Uint32Array([none, 101, none]),
    simIds: () => new Uint32Array([none, 0, 0]), facings: () => new Uint32Array(3),
    carrying: () => new Uint32Array(3).fill(none), clockTick: () => 26 };
  const selection = new InteractionSelection(INTERACTION_SPRITES, () => 'green');
  function pick(source: RenderSource, sprite: number, x: number, y: number) {
    return pickSprite(source, spriteDrawOffsetX(sprite) * 2 - spriteWidth(sprite) + x + .5,
      (21 + spriteDrawOffsetY(sprite) - spriteHeight(sprite)) * 2 + y + .5,
      0, 0, 2, false, selection);
  }
  const sprite = INTERACTION_SPRITES[empty].frames.green[0];
  const masks = SPRITE_PAIR_COVERAGE[sprite];
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[masks[0]], 84, 91)).toBe(0);
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[masks[1]], 84, 91)).toBeLessThan(.5);
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[masks[2]], 84, 91)).toBeGreaterThan(.5);
  expect(pick(source, sprite, 84, 91)).toEqual({ entity: 101, isAgent: false });
  const rearEmpty = spriteIndex('offlineDiningChairNE');
  const isolated: RenderSource & { clockTick(): number } = { ...diningSource(rearEmpty), clockTick: () => 46 };
  const rearSprite = INTERACTION_SPRITES[rearEmpty].frames.green[5];
  const rearMasks = SPRITE_PAIR_COVERAGE[rearSprite];
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[rearMasks[0]], 117, 114)).toBe(0);
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[rearMasks[1]], 117, 114)).toBe(0);
  expect(sampleBedCoverage(SPRITE_PAIR_MASKS[rearMasks[2]], 117, 114)).toBeGreaterThan(.5);
  expect(pick(isolated, rearSprite, 117, 114)).toEqual({ entity: 102, isAgent: true });
});
