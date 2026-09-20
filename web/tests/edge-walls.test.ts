import { expect, it } from 'vitest';
import { buildEdgeWallGeometry } from '../src/render/edge-walls.js';

it('owns each half-panel at its endpoint and joins both rooms at their shared T', () => {
  const panels = buildEdgeWallGeometry(4, 3, Uint32Array.from([
    1, 0, 2, 0, 1, 1, 2, 0, 1, 2, 2, 0, 1, 3, 2, 0,
    0, 2, 2, 0,
  ]));
  const junction = panels.filter((p) => p.x === 1.5 && p.y === 1.5);
  expect(junction).toHaveLength(1);
  expect(junction[0].spriteName).toBe('wallJoin14');
  expect(panels.filter((p) => p.x === -0.5 && p.y === 1.5)[0].spriteName)
    .toBe('wallJoin7');
  expect(panels.filter((p) => p.x === 3.5 && p.y === 1.5)[0].spriteName)
    .toBe('wallHalf8');
  expect(panels.filter((p) => p.x === 1.5 && p.y === 2.5)[0].spriteName)
    .toBe('wallHalf1');
  // Seven exterior and five interior segments contribute exactly 24 arms.
  const arms = panels.reduce((sum, p) => sum + p.mask.toString(2).replaceAll('0', '').length, 0);
  expect(arms).toBe(24);
  expect(new Set(panels.map((p) => `${p.x},${p.y}`)).size).toBe(panels.length);
});

it('leaves explicit door apertures out of both endpoint masks', () => {
  const panels = buildEdgeWallGeometry(4, 4, Uint32Array.from([
    0, 2, 0, 0, 0, 2, 1, 1, 0, 2, 2, 0,
    1, 2, 2, 1,
  ]));
  expect(panels.find((p) => p.x === 1.5 && p.y === 0.5)?.spriteName).toBe('wallHalf1');
  expect(panels.find((p) => p.x === 1.5 && p.y === 1.5)?.spriteName).toBe('wallHalf4');
  const doors = panels.filter((p) => p.mask === 0);
  expect(doors.map((p) => [p.x, p.y, p.spriteName])).toEqual([
    [1.5, 1, 'doorwayJoinedNS'], [2, 1.5, 'doorwayJoinedEW'],
  ]);
  expect(doors.map((p) => p.lightSamples)).toEqual([
    [[1, 1], [2, 1]], [[2, 1], [2, 2]],
  ]);
});

it('retains the exterior on the half-tile planes even for an empty edge layout', () => {
  const panels = buildEdgeWallGeometry(3, 2, new Uint32Array());
  expect(panels.map((p) => [p.x, p.y, p.spriteName])).toEqual([
    [-0.5, -0.5, 'wallJoin6'], [0.5, -0.5, 'wallEW'],
    [1.5, -0.5, 'wallEW'], [2.5, -0.5, 'wallHalf8'],
    [-0.5, 0.5, 'wallNS'], [-0.5, 1.5, 'wallHalf1'],
  ]);
});

it('is independent of authored edge ordering and samples integer cells on both sides', () => {
  const a = [0, 2, 0, 0];
  const b = [1, 2, 1, 0];
  const forward = buildEdgeWallGeometry(4, 3, Uint32Array.from([...a, ...b]));
  expect(buildEdgeWallGeometry(4, 3, Uint32Array.from([...b, ...a]))).toEqual(forward);
  const corner = forward.find((p) => p.x === 1.5 && p.y === 0.5)!;
  expect(corner.spriteName).toBe('wallJoin3');
  expect(corner.lightSamples).toEqual([[1, 0], [2, 0], [2, 1]]);
});
