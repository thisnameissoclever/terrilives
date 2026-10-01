import { expect, it } from 'vitest';
import { WallFade } from '../src/render/wall-fade.js';
import type { EdgeWallPanel } from '../src/render/edge-walls.js';

const panel: EdgeWallPanel = { x: 1.5, y: 1.5, mask: 5, spriteName: 'wallLow5',
  low: true, lightSamples: [[1, 1], [2, 1]], farTiles: [[1, 1]] };
function fixture() {
  const fade = new WallFade();
  const rows = new Float32Array(16); rows[10] = 1;
  fade.configure(rows, [panel], 5, 5);
  const positions = Float32Array.from([1, 1, 2, 1]);
  const previous = positions.slice();
  const kinds = Uint32Array.from([0, 0]), activities = new Uint32Array(2);
  const source = { count: 2, positions: () => positions, prevPositions: () => previous,
    kinds: () => kinds, activities: () => activities };
  return { fade, rows, source, positions, previous, kinds, activities };
}

it('fades for any far-side actor/socket and stays faded until every actor leaves', () => {
  const f = fixture();
  f.fade.update(f.source, 1, 100, false);
  expect(f.rows[10]).toBeCloseTo(.625);
  f.positions.set([2, 1, 1, 1]);
  f.fade.update(f.source, 1, 100, false);
  expect(f.rows[10]).toBe(.25);
  f.positions.set([2, 1, 2, 1]);
  f.fade.update(f.source, 1, 200, false);
  expect(f.rows[10]).toBe(1);
});

it('rejects near-side, diagonal, distant, furniture and off-lot rows', () => {
  for (const xy of [[2, 1], [2, 2], [1, 3], [-1, 1]]) {
    const f = fixture(); f.positions.set([...xy, 4, 4]);
    f.fade.update(f.source, 1, 200, true);
    expect(f.rows[10]).toBe(1);
  }
  for (const kind of ['furniture', 'off-lot']) {
    const f = fixture();
    if (kind === 'furniture') f.kinds[0] = 1; else f.activities[0] = 6;
    f.fade.update(f.source, 1, 200, true);
    expect(f.rows[10]).toBe(1);
  }
});

it('uses interpolated centered tiles, with exit hysteresis but no enlarged entry zone', () => {
  const f = fixture(); f.previous.set([2, 1, 4, 4]); f.positions.set([1, 1, 4, 4]);
  f.fade.update(f.source, .4, 200, true); expect(f.rows[10]).toBe(1);
  f.fade.update(f.source, .6, 200, true); expect(f.rows[10]).toBe(.25);
  f.positions[0] = 1.54;
  f.fade.update(f.source, 1, 200, true); expect(f.rows[10]).toBe(.25);
  f.positions[0] = 1.6;
  f.fade.update(f.source, 1, 200, true); expect(f.rows[10]).toBe(1);
});

it('preserves transitions through camera rebuilds, snaps for reduced motion and clears removed walls', () => {
  const f = fixture(); f.fade.update(f.source, 1, 100, false);
  const moved = new Float32Array(16);
  f.fade.configure(moved, [panel], 5, 5);
  expect(moved[10]).toBeCloseTo(.625);
  f.fade.update(f.source, 1, 0, true); expect(moved[10]).toBe(.25);
  f.fade.configure(new Float32Array(), [], 5, 5);
  f.fade.configure(moved, [panel], 5, 5);
  expect(moved[10]).toBe(1);
});

it('resets both opacity and inherited exit tolerance on successful world replacement', () => {
  const f = fixture(); f.fade.update(f.source, 1, 200, true);
  expect(f.rows[10]).toBe(.25);
  f.fade.reset();
  expect(f.rows[10]).toBe(1);
  f.positions.set([1.54, 1, 4, 4]);
  f.fade.update(f.source, 1, 200, true);
  expect(f.rows[10]).toBe(1);
});

it('fades only matching sections after their row order changes', () => {
  const f = fixture(), other = { ...panel, x: 3.5, farTiles: [[3, 1] as const] };
  const rows = new Float32Array(32);
  f.fade.configure(rows, [other, panel], 5, 5);
  f.fade.update(f.source, 1, 200, true);
  expect([rows[10], rows[26]]).toEqual([1, .25]);
  f.fade.configure(rows, [panel, other], 5, 5);
  expect([rows[10], rows[26]]).toEqual([.25, 1]);
  f.positions.set([3, 1, 4, 4]);
  f.fade.update(f.source, 1, 200, true);
  expect([rows[10], rows[26]]).toEqual([1, .25]);
});
