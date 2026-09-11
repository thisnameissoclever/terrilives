import { describe, expect, it } from 'vitest';
import { InteractionSelection, type InteractionCatalog } from '../src/render/interaction-sprites.js';

const catalog: InteractionCatalog = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [100 + i, {
  action: i < 4 ? 6 : 3,
  halfCycleTicks: i < 4 ? 8 : 24,
  frames: { green: [200 + i, 210 + i, 220 + i, 230 + i],
    blue: [300 + i, 310 + i, 320 + i, 330 + i], red: [400 + i, 410 + i, 420 + i, 430 + i] },
}]));
const variant = (id = 0xffffffff) => id === 0 ? 'blue' as const : id === 2 ? 'red' as const : 'green' as const;
function columns() {
  return { count: 4, ids: new Uint32Array([91, 400, 13, 800]),
    kinds: new Uint32Array([0, 1, 0, 1]), sprites: new Uint32Array([0, 100, 0, 104]),
    actions: new Uint32Array([6, 0, 3, 0]), activities: new Uint32Array(4),
    simIds: new Uint32Array([0, 0xffffffff, 2, 0xffffffff]),
    targets: new Uint32Array([400, 0xffffffff, 800, 0xffffffff]) };
}

describe('exact registered interaction selection', () => {
  it('uses entity IDs, target profiles and household palette, not row or proximity', () => {
    const selected = new InteractionSelection(catalog, variant);
    selected.update(columns(), 0, false);
    expect(Array.from(selected.bodies.slice(0, 4))).toEqual([300, -1, 414, -1]);
    expect(Array.from(selected.targetRows.slice(0, 4))).toEqual([1, -1, 3, -1]);
    expect(Array.from(selected.suppressed.slice(0, 4))).toEqual([0, 1, 0, 1]);
  });
  it('rejects absent, wrong-action and non-object targets without hiding anything', () => {
    for (const target of [0xffffffff, 1, 13, 800]) {
      const cols = columns();
      cols.targets[0] = target;
      cols.targets[2] = 0xffffffff;
      const selected = new InteractionSelection(catalog, variant);
      selected.update(cols, 0, false);
      expect(Array.from(selected.bodies.slice(0, 4))).toEqual([-1, -1, -1, -1]);
      expect(Array.from(selected.suppressed.slice(0, 4))).toEqual([0, 0, 0, 0]);
    }
  });
  it('selects every facing and all palettes through explicit frame indices', () => {
    for (let facing = 0; facing < 4; facing++) {
      for (const [simId, want] of [[0, 300], [1, 200], [2, 400]]) {
        const cols = columns();
        cols.ids[0] = 80;
        cols.sprites[1] = 100 + facing;
        cols.simIds[0] = simId;
        const selected = new InteractionSelection(catalog, variant);
        selected.update(cols, 0, false);
        expect(selected.bodies[0]).toBe(want + facing);
        selected.update(cols, 4, false);
        expect(selected.bodies[0]).toBe(want + facing + 10);
        selected.update(cols, 12, false);
        expect(selected.bodies[0]).toBe(want + facing + 30);
        selected.update(cols, 12, true);
        expect(selected.bodies[0]).toBe(want + facing);
        selected.update(cols, 4, false);
        expect(selected.bodies[0]).toBe(want + facing + 10);
      }
    }
  });
  it('gives the lowest entity ID a duplicate target without erasing the losing Sim', () => {
    const cols = columns();
    cols.targets[2] = 400;
    cols.actions[2] = 6;
    const selected = new InteractionSelection(catalog, variant);
    selected.update(cols, 0, false);
    expect(Array.from(selected.bodies.slice(0, 4))).toEqual([-1, -1, 410, -1]);
    expect(Array.from(selected.suppressed.slice(0, 4))).toEqual([0, 1, 0, 0]);
    cols.activities[2] = 6;
    selected.update(cols, 0, false);
    expect(selected.bodies[0]).toBe(300);
    expect(selected.bodies[2]).toBe(-1);
  });
  it('clears all previous selections when an action ends or target column is absent', () => {
    const cols = columns();
    const selected = new InteractionSelection(catalog, variant);
    selected.update(cols, 0, false);
    selected.update({ ...cols, targets: undefined }, 0, false);
    expect(Array.from(selected.suppressed.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(selected.targetRows.slice(0, 4))).toEqual([-1, -1, -1, -1]);
  });

  it('reuses scratch capacity and resolves colliding sparse IDs after row changes', () => {
    const cols = columns();
    cols.ids[1] = 0xffffff00;
    cols.ids[3] = 0xffffff08;
    cols.targets[0] = cols.ids[1];
    cols.targets[2] = cols.ids[3];
    const selected = new InteractionSelection(catalog, variant);
    selected.update(cols, 0, false);
    const bodies = selected.bodies;
    const suppressed = selected.suppressed;
    expect(Array.from(bodies.slice(0, 4))).toEqual([300, -1, 414, -1]);
    cols.ids[1] = 800;
    cols.ids[3] = 400;
    cols.targets[0] = 400;
    cols.targets[2] = 800;
    cols.sprites[1] = 104;
    cols.sprites[3] = 100;
    selected.update(cols, 0, false);
    expect(selected.bodies).toBe(bodies);
    expect(selected.suppressed).toBe(suppressed);
    expect(Array.from(selected.targetRows.slice(0, 4))).toEqual([3, -1, 1, -1]);
  });
});
