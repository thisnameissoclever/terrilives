import { expect, it } from 'vitest';
import { buildInstances, instanceCount, simShirtVariant, type RenderSource } from '../src/frame.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import { spriteIndex } from '../src/render/atlas.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { screenX, screenY } from '../src/render/iso.js';
import { pickSprite } from '../src/input.js';
import { spriteWidth, spriteHeight } from '../src/render/sprite-size.js';

const empty = spriteIndex('cardboardBoxOpen');
const body = spriteIndex('rigSimExerciseSE0');
const foreground = spriteIndex('loungeChairRelaxForeground');
const none = 0xffffffff;
function setup() {
  const targets = new Uint32Array([400, none, none]);
  const source: RenderSource = {
    count: 3,
    positions: () => new Float32Array([1, 1, 4, 3, 2, 1]),
    prevPositions: () => new Float32Array([1, 1, 4, 3, 2, 1]),
    ids: () => new Uint32Array([90, 400, 99]),
    simIds: () => new Uint32Array([0, none, none]),
    kinds: () => new Uint32Array([0, 1, 1]),
    sprites: () => new Uint32Array([0, empty, empty]),
    activities: () => new Uint32Array([0, 0, 0]),
    visualActions: () => new Uint32Array([6, 0, 0]),
    facings: () => new Uint32Array([1, 0, 0]),
    carrying: () => new Uint32Array([none, none, none]),
    foregroundSprites: () => new Uint32Array([none, foreground, foreground]),
    interactionTargets: () => targets,
    itemKinds: () => [],
  };
  const selection = new InteractionSelection({ [empty]: { action: 6, halfCycleTicks: 8,
    frames: { blue: [body], green: [body], red: [body] } } }, simShirtVariant);
  return { source, targets, selection };
}

it('draws the pair at target registration, parks only its target and counts actual foreground writes', () => {
  const { source, targets, selection } = setup();
  const data = buildInstances(source, 1, 100, 50, 16, null, 2, false, 0, null, selection);
  expect(data[3]).toBe(body);
  expect(data[0]).toBeCloseTo(screenX(4, 3, 100, 2) + spriteDrawOffsetX(body) * 2, 3);
  expect(data[1]).toBeCloseTo(screenY(4, 3, 50, 2) + spriteDrawOffsetY(body) * 2, 3);
  expect(data[FLOATS_PER_INSTANCE]).toBe(-1e6);
  expect(data[2 * FLOATS_PER_INSTANCE + 3]).toBe(empty);
  expect(data[3 * FLOATS_PER_INSTANCE + 3]).toBe(foreground);
  expect(instanceCount(source, null, selection)).toBe(4);
  targets[0] = none;
  buildInstances(source, 1, 100, 50, 16, null, 2, false, 0, null, selection);
  expect(data[FLOATS_PER_INSTANCE + 3]).toBe(empty);
  expect(instanceCount(source, null, selection)).toBe(5);
});

it('picks only the visible Sim bounds at the paired target, leaving furniture clickable', () => {
  const { source, selection } = setup();
  const left = screenX(4, 3, 100) + spriteDrawOffsetX(body) - spriteWidth(body) / 2;
  const top = screenY(4, 3, 50) + 21 + spriteDrawOffsetY(body) - spriteHeight(body);
  const bounds = { [body]: [10, 10, 20, 30] as const };
  expect(pickSprite(source, left + 15, top + 20, 100, 50, 1, false, selection, bounds))
    .toEqual({ entity: 90, isAgent: true });
  expect(pickSprite(source, left + 25, top + 20, 100, 50, 1, false, selection, bounds)?.isAgent)
    .not.toBe(true);
});
