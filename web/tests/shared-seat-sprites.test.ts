import { expect, it } from 'vitest';
import { InteractionSelection, type InteractionColumns } from '../src/render/interaction-sprites.js';
import { sharedSeatKey, sharedSeatPhase, reclineKey, type SharedSeatCatalog } from '../src/render/shared-seat-sprites.js';

const ABSENT = 0xffffffff;
it('keeps independent actions and palettes, stable seat IDs, one draw and three owner markers', () => {
  const scene = { sprite: 100, alpha: 0, owners: [
    { coverage: 1, marker: [-20, 0] as const },
    { coverage: 2, marker: [0, 0] as const },
    { coverage: 3, marker: [20, 0] as const },
  ] };
  const key = sharedSeatKey(2 + 3 + 18, 2, 2, 0, 1);
  const catalog: SharedSeatCatalog = { 10: { model: 'long_sofa', seatIds: ['seat_1', 'seat_2', 'seat_3'], cycleTicks: 16,
    scenes: { [key]: scene } } };
  const source: InteractionColumns = {
    count: 4, ids: new Uint32Array([9, 4, 2, 8]), kinds: new Uint32Array([0, 1, 0, 0]),
    sprites: new Uint32Array([1, 10, 1, 1]), actions: new Uint32Array([3, 0, 8, 3]),
    activities: new Uint32Array([8, 0, 7, 8]), targets: new Uint32Array([4, ABSENT, 4, 4]),
    simIds: new Uint32Array([2, ABSENT, 0, 1]), seatedFurniture: new Uint32Array([4, ABSENT, 4, 4]),
    seatedPlaces: new Uint32Array([1, ABSENT, 2, 0]), seatedWhole: new Uint32Array(4),
    seatIdsByModel: { long_sofa: ['seat_3', 'seat_1', 'seat_2'] },
  };
  const selected = new InteractionSelection({}, id => id === 2 ? 'red' : id === 1 ? 'blue' : 'green', {}, {}, catalog);
  selected.update(source, 8, false);
  expect(Array.from(selected.bedPlaces)).toEqual([0, -1, 1, 2]);
  expect(Array.from(selected.suppressed)).toEqual([0, 1, 0, 0]);
  expect(Array.from(selected.drawSuppressed)).toEqual([0, 0, 1, 1]);
  expect(selected.bedScenes.every(value => value === scene)).toBe(true);
  expect(Array.from(selected.targetRows)).toEqual([1, 1, 1, 1]);
  source.seatedFurniture!.fill(ABSENT);
  selected.update(source, 8, false);
  expect(selected.bedScenes.every(value => value === undefined)).toBe(true);
  expect(Array.from(selected.drawSuppressed)).toEqual([0, 0, 0, 0]);
});

it('uses the same four-phase schedule as export and rejects missing scene bodies', () => {
  expect([0, 3, 4, 7, 8, 11, 12, 15, 16].map(tick => sharedSeatPhase(tick, false))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
  expect(sharedSeatPhase(12, true)).toBe(0);
  const source: InteractionColumns = { count: 2, ids: new Uint32Array([1, 2]), kinds: new Uint32Array([1, 0]),
    sprites: new Uint32Array([10, 1]), actions: new Uint32Array([0, 8]), activities: new Uint32Array(2),
    seatedFurniture: new Uint32Array([ABSENT, 1]), seatedPlaces: new Uint32Array([ABSENT, 0]),
    seatIdsByModel: { long_sofa: ['seat_1', 'seat_2', 'seat_3'] } };
  const selection = new InteractionSelection({}, () => 'green', {}, {}, {
    10: { model: 'long_sofa', seatIds: ['seat_1', 'seat_2', 'seat_3'], cycleTicks: 16, scenes: {} },
  });
  expect(() => selection.update(source, 0, false)).toThrow(/missing/);
});

it('selects a completed single-seat reading export while preserving neutral sitting', () => {
  const scene = { sprite: 100, alpha: 0, owners: [{ coverage: 1, marker: [2, 3] as const }] };
  const columns: InteractionColumns = { count: 2, ids: new Uint32Array([1, 2]), kinds: new Uint32Array([1, 0]),
    sprites: new Uint32Array([10, 1]), actions: new Uint32Array([0, 3]), activities: new Uint32Array(2),
    seatedFurniture: new Uint32Array([ABSENT, 1]), seatedPlaces: new Uint32Array([ABSENT, 0]),
    seatIdsByModel: { armchair: ['seat_1'] } };
  const selected = new InteractionSelection({}, () => 'green', {}, {}, {
    10: { model: 'armchair', seatIds: ['seat_1'], actions: [3], cycleTicks: 16,
      scenes: { [sharedSeatKey(2, 0, 0, 0, 0)]: scene } },
  });
  selected.update(columns, 0, false);
  expect(selected.bedPlaces[1]).toBe(0);
  expect(selected.bedScenes[1]).toBe(scene);
  expect(selected.suppressed[0]).toBe(1);
  columns.actions![1] = 8;
  selected.update(columns, 0, false);
  expect(selected.bedScenes[1]).toBeUndefined();
  expect(selected.suppressed[0]).toBe(0);
});

it('uses only the active exclusive whole-sofa owner, with one body and its own marker', () => {
  const scene = { sprite: 100, alpha: 0, owners: [{ coverage: 1, marker: [12, -3] as const }] };
  const columns: InteractionColumns = { count: 3, ids: new Uint32Array([11, 22, 33]), kinds: new Uint32Array([1, 0, 0]),
    sprites: new Uint32Array([10, 1, 1]), actions: new Uint32Array([0, 0, 8]), activities: new Uint32Array([0, 15, 11]),
    seatedFurniture: new Uint32Array([ABSENT, 11, ABSENT]), seatedPlaces: new Uint32Array([ABSENT, ABSENT, ABSENT]),
    seatedWhole: new Uint32Array([0, 1, 0]), simIds: new Uint32Array([ABSENT, 2, 0]) };
  const selection = new InteractionSelection({}, id => id === 2 ? 'red' : 'green', {}, {}, {}, {}, {
    10: { model: 'long_sofa', wholeSeatId: 'whole_sofa', cycleTicks: 16, scenes: { [reclineKey(2, 2)]: scene } },
  });
  selection.update(columns, 8, false);
  expect(selection.bodies[1]).toBe(100);
  expect(selection.targetRows[1]).toBe(0);
  expect(selection.bedPlaces[1]).toBe(0);
  expect(selection.bedScenes[1]?.owners[0]?.marker).toEqual([12, -3]);
  expect(Array.from(selection.suppressed)).toEqual([1, 0, 0]);
  columns.seatedFurniture![2] = 11;
  expect(() => selection.update(columns, 8, false)).toThrow(/exclusive/i);
  columns.seatedFurniture![2] = ABSENT;
  columns.seatedWhole![1] = 0;
  selection.update(columns, 8, false);
  expect(selection.bedScenes[1]).toBeUndefined();
  expect(selection.suppressed[0]).toBe(0);
});
