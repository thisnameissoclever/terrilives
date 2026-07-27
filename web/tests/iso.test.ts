import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  worldToScreen,
  screenX,
  screenY,
  worldDepth,
  TILE_HALF_WIDTH,
  TILE_HALF_HEIGHT,
} from '../src/render/iso.js';

// Pure arithmetic, so unlike the rest of `render/` this is fully testable
// in Node. That makes it the module where the protocol's standing question
// - "which specific mutation would make this test fail?" - has to be
// answered for every assertion, because there is no browser check standing
// behind these the way [V1]-[V5] in `docs/gpu-verification.md` stand
// behind sprites.ts.
//
// Screen space grows downward; sprites.wgsl flips Y on the way to clip
// space. So "down the screen" below means +y, and it is also the direction
// of increasing nearness to the camera.

describe('worldToScreen', () => {
  it('adds no hidden offset at the world origin', () => {
    // Weak on its own and kept only for that reason: almost any projection
    // maps (0, 0) to (0, 0). What it does pin is the absence of a constant
    // term in either component. The axis tests below are what constrain the
    // shape.
    expect(worldToScreen(0, 0, 0, 0)).toEqual([0, 0]);
  });

  it('sends +x right and down the screen by exactly half a tile', () => {
    // Half a tile, not a whole one: adjacent tiles interlock, so a diamond
    // steps by half its width per tile. Swapping the two constants, or
    // using the same one for both axes, moves both numbers here.
    expect(worldToScreen(1, 0, 0, 0)).toEqual([TILE_HALF_WIDTH, TILE_HALF_HEIGHT]);
    expect(worldToScreen(1, 0, 0, 0)).toEqual([32, 16]);
  });

  it('sends +y left and down the screen by exactly half a tile', () => {
    // The sign on x is the whole difference between the two world axes.
    // Testing only +x would pass for `(wx + wy) * TILE_HALF_WIDTH`, which
    // collapses the diamond into a line along one diagonal.
    expect(worldToScreen(0, 1, 0, 0)).toEqual([-TILE_HALF_WIDTH, TILE_HALF_HEIGHT]);
    expect(worldToScreen(0, 1, 0, 0)).toEqual([-32, 16]);
  });

  it('adds the screen origin to each axis once, unscaled', () => {
    // Two calls, because the (0, 0) case alone cannot tell "origin is
    // added" from "origin is the result". The second call pins that the
    // origin is a translation rather than a factor, and the four distinct
    // arguments mean transposing originX and originY moves it.
    expect(worldToScreen(0, 0, 640, 360)).toEqual([640, 360]);
    expect(worldToScreen(1, 0, 640, 360)).toEqual([672, 376]);
  });

  it('combines both world axes into both screen axes linearly', () => {
    // Superposition: the axis tests fix each basis vector, this fixes that
    // nothing else happens between them. All four arguments differ, so any
    // permutation of them changes at least one component.
    // x: (2 - 3) * 32 + 100 = 68.   y: (2 + 3) * 16 + 50 = 130.
    expect(worldToScreen(2, 3, 100, 50)).toEqual([68, 130]);
    // Doubling the world coordinates doubles the offset from the origin,
    // which excludes a per-tile constant step masquerading as a scale.
    expect(worldToScreen(4, 6, 100, 50)).toEqual([36, 210]);
  });

  it('agrees with the scalar helpers the render loop actually calls', () => {
    // `buildInstances` calls `screenX`/`screenY` and never the tuple,
    // because the tuple is a per-entity JS object and [D11] forbids one
    // ([V11] measured 57.8 MB of them over 2,394 frames before the
    // change). Every other assertion in this file exercises the tuple,
    // so if the two forms ever diverge, the render path is untested and
    // this file is testing something the game does not run.
    //
    // Tautological only while `worldToScreen` delegates. It stops being
    // tautological the moment someone re-inlines the arithmetic into it,
    // which is exactly the edit this is here to catch.
    for (const [wx, wy, ox, oy] of [
      [0, 0, 0, 0],
      [2, 3, 100, 50],
      [-4.5, 6.25, 640, 80],
    ]) {
      expect(worldToScreen(wx, wy, ox, oy)).toEqual([
        screenX(wx, wy, ox),
        screenY(wx, wy, oy),
      ]);
    }
  });

  it('pins the 2 to 1 tile ratio that the fixed camera angle is', () => {
    // A golden assertion rather than a relation between two computed
    // values, per [L5]. The ratio is not a free parameter: it *is* the
    // camera angle that TECH_STACK.md [G2] spends its whole art budget
    // assuming never changes. Art authored for 2:1 does not tile at 1.8:1.
    expect(TILE_HALF_WIDTH).toBe(32);
    expect(TILE_HALF_HEIGHT).toBe(16);
    expect(TILE_HALF_WIDTH).toBe(TILE_HALF_HEIGHT * 2);
  });
});

describe('worldDepth', () => {
  it('orders the far corner behind the near corner for a less-than test', () => {
    // The load-bearing one. sprites.ts sets depthCompare 'less' with a
    // clear of 1.0, so the *smaller* depth wins the pixel ([V3] in the
    // Task 10 report measured this causally). Tiles with a larger x + y
    // draw lower on the screen and are therefore nearer the camera, so
    // they must carry the smaller value.
    //
    // The degenerate alternative this excludes is the inverted mapping,
    // which satisfies "depth is a function of x + y" and "depth is in
    // [0, 1]" and still hides every sim behind the wall it is standing in
    // front of. Three samples rather than two so a single-step function
    // cannot fit them either.
    const far = worldDepth(0, 0, 64);
    const middle = worldDepth(10, 10, 64);
    const near = worldDepth(63, 63, 64);

    expect(far).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(near);
  });

  it('spans the full unit depth range across the grid diagonal', () => {
    // Pins the normalisation exactly. Dividing by gridSize * 2 instead of
    // (gridSize - 1) * 2 still yields something ordered and in range; it
    // just wastes precision at the near end, which nothing else here would
    // notice.
    expect(worldDepth(0, 0, 64)).toBe(1);
    expect(worldDepth(63, 63, 64)).toBe(0);
    // Anti-symmetric about the middle of the diagonal, so the mapping is
    // the linear one and not merely something that hits both endpoints.
    expect(worldDepth(31, 32, 64)).toBeCloseTo(0.5, 12);
  });

  it('clamps out-of-grid coordinates into the clip range', () => {
    // A depth outside [0, 1] is not merely mis-sorted: it fails the clip
    // test and the entity disappears. Reachable without any bug in the sim
    // if frame.ts is ever handed a gridSize smaller than the lot it is
    // drawing.
    //
    // Unclamped these would be 1 + 8/126 = 1.0635 and 1 - 160/126 =
    // -0.2698, so the inputs really do exercise both ends.
    expect(worldDepth(-4, -4, 64)).toBe(1);
    expect(worldDepth(80, 80, 64)).toBe(0);
  });

  it('keeps depth finite on a degenerate grid size', () => {
    // (gridSize - 1) * 2 is zero at gridSize 1 and negative below it.
    // 0 / 0 is NaN, and NaN survives the clamp: Math.max(0, NaN) is NaN.
    // A NaN depth reaches the vertex shader and drops the whole quad
    // without an error anywhere, which is [L12]'s lesson in a new place.
    expect(worldDepth(0, 0, 1)).toBe(1);
    expect(worldDepth(0, 0, 0)).toBe(1);
    expect(Number.isFinite(worldDepth(5, 5, 1))).toBe(true);
  });
});

describe('depth sense contract with the render pipeline', () => {
  // `worldDepth` returns `1 - nearness`, and every assertion in the block
  // above derives from that. **Nothing in `iso.ts` makes that the right
  // sense.** It is right only because `sprites.ts` configures the pipeline
  // to compare with 'less' against a clear value of 1.0, so the smaller
  // depth wins the pixel. Change those two settings to 'greater' and 0.0
  // and every other test in this repository stays green while occlusion
  // inverts for every entity in the game: a sim standing in front of the
  // fridge would be drawn inside it. That inversion already shipped once,
  // in the Task 11 brief, together with a test that pinned it - [L16].
  //
  // So this reads `sprites.ts` as text, the same mechanism
  // `instances.test.ts` uses to tie the WGSL declarations to the
  // TypeScript constants, and for the same reason: CI has no GPU, and the
  // contract spans two files that the type system does not connect.
  // `number` in [0, 1] is `number` in [0, 1].
  //
  // The hardware evidence that 'less' plus a 1.0 clear really does mean
  // "smaller wins" is [V3] in `docs/gpu-verification.md`: two quads on one
  // pixel, draw order held constant, only the depths swapped, and the
  // winner flipped.
  //
  // If you deliberately move the pipeline to a reversed-Z convention, this
  // test is the checklist: flip `worldDepth` to return `nearness`, flip the
  // three expectations in `worldDepth`'s own tests, and update this one.
  // Changing any one of those alone is the bug.
  const sprites = readFileSync('src/render/sprites.ts', 'utf8');

  it('declares exactly one depth compare, and it is the less-than that worldDepth assumes', () => {
    const compares = [...sprites.matchAll(/depthCompare:\s*'([a-z-]+)'/g)];
    // Rule 5, and it is not hypothetical here: a rename or a reformat
    // could stop the regex matching, and a zero-match assertion on the
    // captured value would then pass while comparing nothing. Requiring
    // exactly one also means a second pipeline with a different sense
    // fails rather than hiding behind the first match.
    expect(compares).toHaveLength(1);
    expect(compares[0][1]).toBe('less');
  });

  it('clears the depth buffer to the far plane, so an undrawn pixel loses to everything', () => {
    // 1.0 is the far end under 'less'. Clearing to 0.0 would make the
    // cleared buffer beat every quad and nothing would draw at all; a
    // clear anywhere in between silently culls the far half of the lot.
    const clears = [...sprites.matchAll(/depthClearValue:\s*([\d.]+)/g)];
    expect(clears).toHaveLength(1);
    expect(Number(clears[0][1])).toBe(1.0);
  });

  it('writes depth as well as testing it, so the first quad can occlude the second', () => {
    // With `depthWriteEnabled: false` the compare op above still runs but
    // every fragment tests against the cleared value, so the depth buffer
    // is inert and painter's order decides. That is the failure [V3] was
    // designed to detect on hardware; this is its CI-side counterpart.
    const writes = [...sprites.matchAll(/depthWriteEnabled:\s*(true|false)/g)];
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toBe('true');
  });
});
