import { expect, it } from 'vitest';
import { buildShortEdgeWallGeometry } from '../src/render/edge-walls.js';

it('keeps rear walls tall but splits off every interior and front arm at short height', () => {
  const edges = Uint32Array.from([0, 2, 0, 0, 0, 3, 0, 0, 1, 0, 2, 0]);
  const panels = buildShortEdgeWallGeometry(5, 4, edges, [], [3, 2]);
  const low = panels.filter(p => p.low);
  expect(low.reduce((sum, p) => sum + p.mask.toString(2).replaceAll('0', '').length, 0)).toBe(6);
  expect(low.every(p => p.spriteName === `wallLow${p.mask}`)).toBe(true);
  expect(panels.filter(p => !p.low).every(p => p.x === -0.5 || p.y === -0.5)).toBe(true);
  // A tall rear branch must not make the interior branch tall too.
  expect(panels.filter(p => p.x === 1.5 && p.y === -0.5).map(p => p.mask)).toEqual([10, 4]);
  expect(low.find(p => p.x === 1.5 && p.y === 0.5)?.farTiles).toEqual([[1, 0]]);
  expect(low.find(p => p.x === 0.5 && p.y === 1.5)?.farTiles).toEqual([[0, 1]]);
});

it('keeps passages open, omits duplicate hinged frames and lowers window sills', () => {
  const panels = buildShortEdgeWallGeometry(4, 4,
    Uint32Array.from([0, 2, 1, 1, 1, 1, 2, 1]), [2, 1], [3, 3], [0, 3, 0]);
  expect(panels.filter(p => p.low && p.mask === 0 && !p.window).map(p => p.spriteName)).toEqual(['doorwayLowEW']);
  const window = panels.find(p => p.window)!;
  expect(window.low).toBe(true);
  expect(window.spriteName).toBe('wallLow5');
  expect(window.farTiles).toEqual([[2, 0]]);
});
