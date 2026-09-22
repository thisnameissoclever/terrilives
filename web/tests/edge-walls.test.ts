import { describe, expect, it } from 'vitest';
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

// [DR-render]: a door draws its own frame, so its doorway's empty panel goes.
it('leaves out the empty panel of a doorway that holds a door, and only that one', () => {
  const edges = Uint32Array.from([
    0, 2, 0, 0, 0, 2, 1, 1, 0, 2, 2, 0,
    1, 2, 2, 1,
  ]);
  const panels = buildEdgeWallGeometry(4, 4, edges, [2, 1]);
  expect(panels.filter((p) => p.mask === 0).map((p) => [p.x, p.y, p.spriteName]))
    .toEqual([[2, 1.5, 'doorwayJoinedEW']]);
  // The solid halves either side are untouched.
  expect(panels.find((p) => p.x === 1.5 && p.y === 0.5)?.spriteName).toBe('wallHalf1');
  expect(panels.find((p) => p.x === 1.5 && p.y === 1.5)?.spriteName).toBe('wallHalf4');
  // A door listed on a line with no doorway, or on a horizontal doorway's
  // coordinates, changes nothing.
  expect(buildEdgeWallGeometry(4, 4, edges, [2, 0, 2, 2])).toEqual(buildEdgeWallGeometry(4, 4, edges));
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

// [OS-walls] in docs/specs/2026-09-22-the-outside.md: a 5 by 4 lot whose house
// is 3 by 2, so the yard is the two east columns and the south two rows.
describe('a house standing in a yard', () => {
  const inside = [0, 1, 0, 0];
  const outside = [
    0, 3, 0, 0, 0, 3, 1, 1,
    1, 0, 2, 0, 1, 1, 2, 0, 1, 2, 2, 0,
  ];
  const inYard = [0, 4, 2, 0, 1, 3, 3, 0];
  const all = Uint32Array.from([...inside, ...outside, ...inYard]);

  it("leaves out the house's walls and doorway that face the view, and only those", () => {
    const panels = buildEdgeWallGeometry(5, 4, all, [], [3, 2]);
    expect(panels)
      .toEqual(buildEdgeWallGeometry(5, 4, Uint32Array.from([...inside, ...inYard]), [], [3, 2]));
    // The wall inside the house ends at (1, 1), and the two in the yard meet
    // at (4, 3): both are still drawn.
    expect(panels.find((p) => p.x === 0.5 && p.y === 0.5)?.spriteName).toBe('wallHalf1');
    expect(panels.find((p) => p.x === 3.5 && p.y === 2.5)?.spriteName).toBe('wallJoin9');
  });

  it("runs the back walls along the house's north and west sides, not the yard's", () => {
    const panels = buildEdgeWallGeometry(5, 4, new Uint32Array(), [], [3, 2]);
    expect(panels.map((p) => [p.x, p.y])).toEqual([
      [-0.5, -0.5], [0.5, -0.5], [1.5, -0.5], [2.5, -0.5],
      [-0.5, 0.5], [-0.5, 1.5],
    ]);
  });

  it('runs the back walls along a lot smaller than the house, and no further', () => {
    // Framed as a lot that is all house: the runs stop at the lot's corner.
    expect(buildEdgeWallGeometry(3, 2, new Uint32Array(), [], [16, 12]))
      .toEqual(buildEdgeWallGeometry(3, 2, new Uint32Array()));
  });

  // [WB-draw]: while the Walls or Room tool is in use the cut-away lines are
  // drawn as well, exactly as a lot that is all house draws them, and the
  // back walls still run along the house only.
  it('draws the cut-away walls and doorway when asked, and nothing more', () => {
    const shown = buildEdgeWallGeometry(5, 4, all, [], [3, 2], true);
    const withoutBack = (panels: ReturnType<typeof buildEdgeWallGeometry>) =>
      panels.filter((p) => p.x >= 0 && p.y >= 0);
    expect(withoutBack(shown)).toEqual(withoutBack(buildEdgeWallGeometry(5, 4, all)));
    expect(shown.filter((p) => p.mask === 0)).toHaveLength(1);
    // The cut-away wall at x = 3 meets the north back wall at the house's
    // corner: an arm down and an arm west.
    expect(shown.find((p) => p.x === 2.5 && p.y === -0.5)?.mask).toBe(12);
    expect(buildEdgeWallGeometry(5, 4, new Uint32Array(), [], [3, 2], true))
      .toEqual(buildEdgeWallGeometry(5, 4, new Uint32Array(), [], [3, 2]));
  });

  it('draws everything when the whole lot is house', () => {
    expect(buildEdgeWallGeometry(5, 4, all)).toEqual(buildEdgeWallGeometry(5, 4, all, [], [5, 4]));
    expect(buildEdgeWallGeometry(5, 4, all).filter((p) => p.mask === 0)).toHaveLength(1);
  });
});
