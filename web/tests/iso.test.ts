import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPRITES } from '../src/render/atlas.js';
import {
  worldToScreen,
  screenToWorld,
  screenX,
  screenY,
  worldDepth,
  layeredDepth,
  DEPTH_LAYER_STEP,
  DEPTH_MARGIN,
  LAYER_FLOOR,
  LAYER_PROP,
  LAYER_SIM,
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
    expect(worldToScreen(1, 0, 0, 0)).toEqual([TILE_HALF_WIDTH, TILE_HALF_HEIGHT]);
  });

  it('sends +y left and down the screen by exactly half a tile', () => {
    // The sign on x is the whole difference between the two world axes.
    // Testing only +x would pass for `(wx + wy) * TILE_HALF_WIDTH`, which
    // collapses the diamond into a line along one diagonal.
    expect(worldToScreen(0, 1, 0, 0)).toEqual([-TILE_HALF_WIDTH, TILE_HALF_HEIGHT]);
    expect(worldToScreen(0, 1, 0, 0)).toEqual([-TILE_HALF_WIDTH, TILE_HALF_HEIGHT]);
  });

  it('adds the screen origin to each axis once, unscaled', () => {
    // Two calls, because the (0, 0) case alone cannot tell "origin is
    // added" from "origin is the result". The second call pins that the
    // origin is a translation rather than a factor, and the four distinct
    // arguments mean transposing originX and originY moves it.
    expect(worldToScreen(0, 0, 640, 360)).toEqual([640, 360]);
    expect(worldToScreen(1, 0, 640, 360)).toEqual([
      640 + TILE_HALF_WIDTH,
      360 + TILE_HALF_HEIGHT,
    ]);
  });

  it('combines both world axes into both screen axes linearly', () => {
    // Superposition: the axis tests fix each basis vector, this fixes that
    // nothing else happens between them. All four arguments differ, so any
    // permutation of them changes at least one component.
    // x: (2 - 3) * 32 + 100 = 68.   y: (2 + 3) * 21 + 50 = 155.
    expect(worldToScreen(2, 3, 100, 50)).toEqual([68, 5 * TILE_HALF_HEIGHT + 50]);
    // Doubling the world coordinates doubles the offset from the origin,
    // which excludes a per-tile constant step masquerading as a scale.
    expect(worldToScreen(4, 6, 100, 50)).toEqual([36, 10 * TILE_HALF_HEIGHT + 50]);
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

  it('pins the tile ratio that the fixed camera angle is', () => {
    // A golden assertion rather than a relation between two computed
    // values, per [L5]. The ratio is not a free parameter: it *is* the
    // camera angle that TECH_STACK.md [G2] spends its whole art budget
    // assuming never changes, and art authored for one pitch does not tile
    // at another.
    //
    // **It was 2:1 and that was wrong for the shipped art.** A round 2:1 is
    // the SimCity and Sims pitch, and the Kenney kit is not drawn at it: a
    // wall panel's top edge - which is parallel to the ground edge it stands
    // on, and therefore a direct probe of the art's ground plane - climbs
    // 69 px over 104 px, a slope of 0.663. A 2:1 grid climbs at 0.5, so the
    // grid and every sprite on it disagreed by about 5 px per tile, which
    // accumulated along a wall run into the sawtooth this fixed.
    //
    // 21 = round(32 * 0.663). The relation asserted below is the measured
    // slope, not a round number, which is why it is stated as a tolerance on
    // the ratio rather than as an exact multiple.
    expect(TILE_HALF_WIDTH).toBe(32);
    expect(TILE_HALF_HEIGHT).toBe(21);

    // The art's measured slope, and a tolerance of one pixel over a tile
    // edge - which is the precision the source PNG's antialiased edge
    // supports in the first place.
    const ART_SLOPE = 69 / 104;
    expect(Math.abs(TILE_HALF_HEIGHT - TILE_HALF_WIDTH * ART_SLOPE)).toBeLessThan(1);
  });

  it('draws the floor sprite at exactly one tile', () => {
    // The generated floor diamond comes out of the atlas build script at
    // `2 * TILE_HALF_WIDTH` by `2 * TILE_HALF_HEIGHT`, so it is the one
    // sprite whose dimensions ARE the projection. If the constant above moves
    // and the atlas is not rebuilt, 140 floor tiles tile with visible seams or
    // overlaps - which is a whole-screen artifact with no error anywhere.
    const floor = SPRITES.find((sprite) => sprite.name === 'floor');
    expect(floor, 'the atlas must carry a generated floor sprite').toBeDefined();
    expect(floor?.w).toBe(TILE_HALF_WIDTH * 2);
    expect(floor?.h).toBe(TILE_HALF_HEIGHT * 2);
  });

  it('draws a wall panel exactly one tile edge wide, and taller than a sim', () => {
    // Both halves are the wall fix, stated as the two things that were wrong.
    //
    // WIDTH: a panel wider than one tile edge overlaps its neighbour, which is
    // what `wall_*` did at 59 px against a 32 px edge and what read as
    // overlapping boards. `wallHalf_*` scaled to exactly the edge is the fix.
    //
    // HEIGHT: the reason the obvious alternative - scaling `wall_*` down until
    // it fitted - was rejected. It would have come out 62 px tall against a
    // 78 px sim, so the walls would have been shorter than the people.
    const sim = SPRITES.find((sprite) => sprite.name === 'sim');
    expect(sim).toBeDefined();
    for (const name of ['wallNS', 'wallEW']) {
      const wall = SPRITES.find((sprite) => sprite.name === name);
      expect(wall, `the atlas must carry ${name}`).toBeDefined();
      expect(wall?.w, `${name} must be exactly one tile edge wide`).toBe(TILE_HALF_WIDTH);
      expect(
        wall?.h ?? 0,
        `${name} must stand taller than a sim or it reads as a skirting board`,
      ).toBeGreaterThan(sim?.h ?? 0);
    }
  });
});

describe('screenToWorld', () => {
  it('round-trips every world coordinate back through worldToScreen exactly', () => {
    // A sign error here produces picking that is subtly off rather than
    // obviously broken, which is the kind that survives manual testing:
    // clicks land one tile away in some directions and correctly in
    // others, and the blame goes somewhere else weeks later.
    //
    // Several coordinates rather than one, because the degenerate
    // alternatives all agree with the real inverse at the origin.
    // Swapping the `+` and the `-` between the two returned expressions,
    // or duplicating one expression into the other, both map (0, 0) back
    // to (0, 0); they disagree the moment either world axis is non-zero.
    // (0, 0) is kept anyway to pin that no constant term crept in.
    let checked = 0;
    for (const [wx, wy] of [[0, 0], [1, 0], [0, 1], [5, 3], [12, 10], [15, 15]]) {
      const [sx, sy] = worldToScreen(wx, wy, 640, 60);
      const [bx, by] = screenToWorld(sx, sy, 640, 60);
      expect(bx).toBeCloseTo(wx, 6);
      expect(by).toBeCloseTo(wy, 6);
      checked += 1;
    }
    // Protocol rule 5: an empty table would make every assertion above
    // vacuous while the test still reported green.
    expect(checked).toBe(6);
  });

  it('maps the two screen axes onto different world axes', () => {
    // Both output formulas read both inputs, so a copy-paste slip that
    // made them identical is not visible in their shape - and it would
    // still round-trip the origin. One screen-space displacement along a
    // single axis separates them: +x screen is +1 on world x and -1 on
    // world y, so identical formulas would return the same number twice.
    const [ax, ay] = screenToWorld(64, 0, 0, 0);
    expect(ax).not.toBeCloseTo(ay, 3);
  });

  it('subtracts the same screen origin that worldToScreen added', () => {
    // Fails on adding the origin instead of subtracting it, on using
    // originX for both axes, and on dropping either subtraction. Honest
    // caveat: the round trip above already catches all three, because it
    // also passes a non-zero origin whose two components differ. This is
    // a second origin pair rather than a new invariant, and it is worth
    // its four lines only because origin handling is the half of picking
    // that a camera pan will eventually start exercising.
    const [sx, sy] = worldToScreen(4, 7, 300, 200);
    const [wx, wy] = screenToWorld(sx, sy, 300, 200);
    expect(wx).toBeCloseTo(4, 6);
    expect(wy).toBeCloseTo(7, 6);
  });

  it('returns a fractional tile coordinate rather than a rounded one', () => {
    // Not in the task brief, and added because the brief's three tests
    // all pass with `Math.round` wrapped around both results: every world
    // coordinate they round-trip is an integer, so rounding is invisible
    // to them. Verified by running that mutation, not by reading them.
    //
    // It is a real invariant rather than a mutation-score trophy. The
    // caller decides what a fraction means, and the answers differ:
    // hit-testing a tile wants the floor, a sub-tile gesture wants the
    // remainder. Rounding inside here would throw that away before anyone
    // could choose. Half a tile down the screen from the origin is
    // (0.5, 0.5) in world space, and both components must survive.
    const [wx, wy] = screenToWorld(0, TILE_HALF_HEIGHT, 0, 0);
    expect(wx).toBeCloseTo(0.5, 6);
    expect(wy).toBeCloseTo(0.5, 6);
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

describe('layeredDepth', () => {
  // What this exists for, in one sentence: two things on the same tile
  // used to take the same depth, and under `depthCompare: 'less'` the
  // second one drawn simply did not appear. [V12] recorded it - a sim
  // reaching the fridge stopped being in the frame at all - and during a
  // play session that reads as the sim having disappeared.

  it('orders sim in front of prop in front of floor on every tile', () => {
    // Every tile, not one, because the two ends of the range are where a
    // naive "subtract a bias" implementation breaks: `worldDepth`
    // returns exactly 1 at the far corner and 0 at the near one, and a
    // clamp there collapses all three layers onto the same number.
    let checked = 0;
    for (let x = -1; x <= 8; x++) {
      for (let y = -1; y <= 8; y++) {
        const floor = layeredDepth(x, y, 8, LAYER_FLOOR);
        const prop = layeredDepth(x, y, 8, LAYER_PROP);
        const sim = layeredDepth(x, y, 8, LAYER_SIM);
        expect(sim).toBeLessThan(prop);
        expect(prop).toBeLessThan(floor);
        checked += 1;
      }
    }
    // Rule 5: an empty loop would satisfy every assertion above.
    expect(checked).toBe(100);
  });

  it('keeps every layer inside the clip range, including outside the lot', () => {
    // A depth outside [0, 1] does not sort wrong, it fails the clip test
    // and the quad vanishes - trading the bug this function fixes for a
    // different one with the same symptom. The boundary walls are drawn
    // at -1, so the range has to hold there too.
    let checked = 0;
    for (const [x, y] of [
      [-1, -1],
      [0, 0],
      [3, 4],
      [7, 7],
      [40, 40],
      [-9, -9],
    ]) {
      for (const layer of [LAYER_FLOOR, LAYER_PROP, LAYER_SIM]) {
        const depth = layeredDepth(x, y, 8, layer);
        expect(depth).toBeGreaterThan(0);
        expect(depth).toBeLessThanOrEqual(1);
        checked += 1;
      }
    }
    expect(checked).toBe(18);
  });

  it('lets one tile of distance outrank any layer bias', () => {
    // The bias has to be big enough to break a tie and small enough not
    // to create one. A sim one tile further from the camera than a prop
    // must still draw behind it, however favoured its layer is - so this
    // is the assertion that stops a residual tie being "fixed" by
    // enlarging DEPTH_LAYER_STEP until it reorders the room.
    //
    // Both single-axis steps, because x and y contribute to nearness
    // equally and a bias that only cleared one of them would be half a
    // fix.
    expect(layeredDepth(4, 5, 8, LAYER_SIM)).toBeGreaterThan(
      layeredDepth(5, 5, 8, LAYER_FLOOR),
    );
    expect(layeredDepth(5, 4, 8, LAYER_SIM)).toBeGreaterThan(
      layeredDepth(5, 5, 8, LAYER_FLOOR),
    );
    // Stated as the arithmetic as well, so the margin is visible rather
    // than merely sufficient on these two samples: one tile is worth
    // 1 / ((gridSize - 1 + margin) * 2) of depth, and three layers must
    // fit inside that with room to spare.
    const oneTile = 1 / ((8 - 1 + DEPTH_MARGIN) * 2);
    expect(DEPTH_LAYER_STEP * 3).toBeLessThan(oneTile / 8);
  });

  it('preserves worldDepth ordering between different tiles', () => {
    // The layer offsets and the margin are both translations; neither
    // may change which of two tiles is in front. Held at one layer so
    // only the position varies.
    const far = layeredDepth(0, 0, 8, LAYER_PROP);
    const middle = layeredDepth(3, 3, 8, LAYER_PROP);
    const near = layeredDepth(7, 7, 8, LAYER_PROP);
    expect(far).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(near);
    // And it really is `worldDepth` underneath, rather than a second
    // projection that happens to be monotonic too.
    expect(far).toBeGreaterThan(layeredDepth(1, 0, 8, LAYER_PROP));
    expect(worldDepth(0, 0, 8)).toBeGreaterThan(worldDepth(1, 0, 8));
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
