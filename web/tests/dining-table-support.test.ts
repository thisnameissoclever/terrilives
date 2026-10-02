import { expect, it } from 'vitest';
import { buildInstances, instanceCount, type RenderSource } from '../src/frame.js';
import { pickSprite } from '../src/input.js';
import { packDiningSupport, sampleDiningSupport, DINING_BACKGROUND, DINING_FOREGROUND } from '../src/render/dining-support.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import { INTERACTION_SPRITES, SPRITE_DINING_SUPPORT, SPRITE_PAIR_MASKS, spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { SURFACE_DEPTH_PROJECTION } from '../src/render/instances.js';
import shader from '../src/render/sprites.wgsl?raw';
import { layeredDepth, LAYER_FOREGROUND } from '../src/render/iso.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';
import { SPRITE_PAIR_COVERAGE } from '../src/render/atlas.js';

const none = 0xffffffff;

it('keeps dining masks distinct from modelled door depth in both renderer protocols', () => {
  const modes = { SURFACE_DEPTH_PROJECTION, DINING_BACKGROUND, DINING_FOREGROUND };
  expect(new Set(Object.values(modes)).size).toBe(3);
  for (const [name, value] of Object.entries(modes)) {
    const declaration = shader.match(new RegExp(`const ${name}: f32 = (-?[\\d.]+);`));
    expect(Number(declaration?.[1])).toBe(value);
  }
});
const cases = [
  ['SE', 'SW', 0, 1.5, 1, 2], ['SW', 'NW', -1.5, 0, 2, 1],
  ['NW', 'NE', 0, -1.5, 1, 2], ['NE', 'SE', 1.5, 0, 2, 1],
] as const;

type Facing = typeof cases[number][0];
export function tableSource(facing: readonly [Facing, Facing, number, number, number, number]): RenderSource & { clockTick(): number } {
  const [chair, table, tx, ty, width, depth] = facing;
  const positions = new Float32Array([0, 0, 0, 0, tx, ty]);
  return { count: 3, positions: () => positions, prevPositions: () => positions,
    ids: () => new Uint32Array([101, 102, 103]), kinds: () => new Uint32Array([1, 0, 1]),
    sprites: () => new Uint32Array([spriteIndex('offlineDiningChair' + (chair === 'SE' ? '' : chair)),
      spriteIndex('sim'), spriteIndex('offlineDiningTable' + (table === 'SE' ? '' : table))]),
    activities: () => new Uint32Array([0, 3, 0]), visualActions: () => new Uint32Array([0, 13, 0]),
    interactionTargets: () => new Uint32Array([none, 101, none]), mealTables: () => new Uint32Array([none, 103, none]),
    footprintWidths: () => new Uint32Array([1, 0, width]), footprintDepths: () => new Uint32Array([1, 0, depth]),
    simIds: () => new Uint32Array([none, 0, none]), facings: () => new Uint32Array(3),
    itemKinds: () => [], carrying: () => new Uint32Array(3).fill(none), clockTick: () => 26 };
}

it.each(cases)('keeps tabletop geometry and picking at the supporting table for %s', (...facing) => {
  const source = tableSource(facing);
  const selection = new InteractionSelection(INTERACTION_SPRITES, () => 'green');
  for (const scale of [1, 2]) for (let phase = 0; phase < 8; phase++) {
    const tick = phase * 4 + 26;
    const data = buildInstances(source, 1, 0, 0, 16, null, scale, false, tick, null, selection);
    const body = data[FLOATS_PER_INSTANCE + 3];
    expect(data[FLOATS_PER_INSTANCE + 8]).toBe(DINING_BACKGROUND);
    expect(data[3 * FLOATS_PER_INSTANCE + 8]).toBe(DINING_FOREGROUND);
    expect(data[3 * FLOATS_PER_INSTANCE + 3]).toBe(body);
    expect(data[3 * FLOATS_PER_INSTANCE + 2]).toBeCloseTo(layeredDepth(facing[2], facing[3], 16, LAYER_FOREGROUND));
    expect(instanceCount(source, null, selection)).toBe(5);
    const support = SPRITE_DINING_SUPPORT[body];
    const mask = SPRITE_PAIR_MASKS[support.coverage];
    let found = false;
    for (let y = 0; y < mask.size[1] && !found; y++) for (let x = 0; x < mask.size[0]; x++) {
      const bx = support.offset[0] + (x + .5) / 2, by = support.offset[1] + (y + .5) / 2;
      if (sampleDiningSupport(support, SPRITE_PAIR_MASKS, bx, by, 2) < .95) continue;
      expect(pickSprite({ ...source, clockTick: () => tick },
        (spriteDrawOffsetX(body) - 40 + bx) * scale,
        (21 + spriteDrawOffsetY(body) - 112 + by) * scale, 0, 0, scale, false, selection))
        .toEqual({ entity: 102, isAgent: true });
      found = true; break;
    }
    expect(found).toBe(true);
    expect(sampleDiningSupport(support, SPRITE_PAIR_MASKS, support.offset[0], -1000, 2)).toBe(0);
    expect(sampleDiningSupport(support, SPRITE_PAIR_MASKS, 1000, support.offset[1], 2)).toBe(0);
  }
  const missing = { ...source, mealTables: () => new Uint32Array(3).fill(none) };
  const cancelled = buildInstances(missing, 1, 0, 0, 16, null, 1, true, 0, null, selection);
  expect(cancelled[FLOATS_PER_INSTANCE + 8]).toBe(0);
  expect(instanceCount(missing, null, selection)).toBe(4);
  expect(selection.mealRows[1]).toBe(-1);
});

it('packs support masks by body identity and rejects invalid references', () => {
  const records = packDiningSupport(3, { 1: { sprite: 2, coverage: 0, offset: [5, 7] } });
  expect([...records]).toEqual([0, 0, 0, 0, 3, 5, 7, 0, 0, 0, 0, 0]);
  expect(() => packDiningSupport(3, { 3: { sprite: 2, coverage: 0, offset: [5, 7] } })).toThrow();
  expect(() => packDiningSupport(3, { 1: { sprite: 3, coverage: 0, offset: [5, 7] } })).toThrow();
});

it('picks chair-owned antialias pixels at the same table depth as their rendered pair', () => {
  const source = tableSource(cases[3]);
  const selection = new InteractionSelection(INTERACTION_SPRITES, () => 'green');
  let contacts = 0;
  for (let phase = 0; phase < 8; phase++) {
    const tick = phase * 4 + 26;
    const data = buildInstances(source, 1, 0, 0, 16, null, 1, false, tick, null, selection);
    const body = data[FLOATS_PER_INSTANCE + 3], support = SPRITE_DINING_SUPPORT[body];
    const pair = SPRITE_PAIR_COVERAGE[body];
    for (let y = 0; y < 224; y++) for (let x = 0; x < 160; x++) {
      const bx = (x + .5) / 2, by = (y + .5) / 2;
      if (sampleDiningSupport(support, SPRITE_PAIR_MASKS, bx, by, 2) < .5) continue;
      const [b, w, ink, bodyInk] = pair.map(index => sampleBedCoverage(SPRITE_PAIR_MASKS[index], x, y));
      if (ink + (b + w) * (1 - ink) < .5 || b + bodyInk >= w + ink - bodyInk) continue;
      expect(pickSprite({ ...source, clockTick: () => tick },
        spriteDrawOffsetX(body) - 40 + bx, 21 + spriteDrawOffsetY(body) - 112 + by,
        0, 0, 1, false, selection)).toEqual({ entity: 101, isAgent: false });
      contacts++;
    }
  }
  expect(contacts).toBeGreaterThan(0);
});

it('keeps a supported chair edge selectable in front of an overlapping idle Sim', () => {
  const base = tableSource(cases[0]);
  const positions = new Float32Array([0, 0, 0, 0, 0, 1.5, .5, .5]);
  const source = { ...base, count: 4, positions: () => positions, prevPositions: () => positions,
    ids: () => new Uint32Array([101, 102, 103, 104]), kinds: () => new Uint32Array([1, 0, 1, 0]),
    sprites: () => new Uint32Array([...base.sprites(), spriteIndex('sim')]),
    activities: () => new Uint32Array([0, 3, 0, 0]), visualActions: () => new Uint32Array([0, 13, 0, 0]),
    interactionTargets: () => new Uint32Array([none, 101, none, none]),
    mealTables: () => new Uint32Array([none, 103, none, none]),
    footprintWidths: () => new Uint32Array([1, 0, 1, 0]), footprintDepths: () => new Uint32Array([1, 0, 2, 0]),
    facings: () => new Uint32Array(4), simIds: () => new Uint32Array([none, 0, none, 1]),
    carrying: () => new Uint32Array(4).fill(none) };
  const selection = new InteractionSelection(INTERACTION_SPRITES, () => 'green');
  expect(pickSprite(source, 3.75, -17.75, 0, 0, 1, false, selection))
    .toEqual({ entity: 101, isAgent: false });
});
