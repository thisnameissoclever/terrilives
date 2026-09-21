# Wall clipping correction

## Wide furniture follow-up, 2026-09-21

The checkpoint below was incomplete: it covered one-tile props but missed the
right-hand cuts on the two-tile desk and bunk. This follow-up starts from main
`097a849`, including the front door and furniture builder. It does not alter
artwork, footprints, object positions, saves or simulation code.

Furniture now uses the midpoint of the viewing column's intersection with its
oriented rectangular footprint. The shader applies that depth to the existing
sprite rather than changing its pixels. Occupied composites use their target's
footprint; foregrounds, sleep indicators and placement previews follow the same
rule. All sprite registration is relative to the physical center. Square
footprints retain flat depth, and portal frames/leaves retain their authored
depth offsets. Instance rows are now 48 bytes, still one buffer and draw.

This is a 2.5D ordering proxy for disjoint footprints, not exact surface depth
for overlapping objects or art extending outside its physical footprint.

Run in a dedicated Vite browser as below:

```js
const walls = await import('/proofs/wall-occlusion.js');
await walls.wallOcclusionProof({ wide: true });
await walls.wallOcclusionProof({ wide: true, indicators: true });
await walls.wallJoinDepthProof();
await walls.doorTraversalProof();
await (await import('/proofs/footprint-depth.js')).footprintDepthProof();
```

1. The actual frame builder is used, with the shipped centers `(6.5,6)` and
   `(9.5,6)`. Disabling footprint projection reproduces both clipped silhouettes
   and fails 42 of 171 object cases. Reversing the shader slope also fails 42.
2. Restored projection passes 171 object cases across four desk/bunk facings,
   both wall axes, foreground/background controls and zooms 1, 1.75 and 3.
   Occupied masks reconstruct the selected body, furniture contribution and ink;
   they include sleeper pixels rather than reusing the empty bed's mask.
3. All 24 foreground occupied-indicator cases pass. Removing their projection
   fails all 24 GPU cases and the frame-boundary assertion. Background indicators
   are excluded from this particular assertion because they may sit above a wall.
4. All 180 independent ray/rectangle depth brackets pass, including deliberately
   off-center canvas anchors. Removing anchor correction from the shader fails
   108. Existing 120 wall-junction and 10 doorway traversal cases still pass.
5. Focused unit mutations catch swapped dimensions, dropped anchor offsets,
   using the Sim's footprint instead of its occupied target, sharing body anchors
   with separately registered foregrounds, and stale projection fields on reused
   rows. The last mutation also fails portal sentinel checks. No thresholds or
   test timeouts were widened.

6. Final local checks: `npm test -- --maxWorkers=1` passed 823 tests across
   69 files. `npm run typecheck`, `npm run build`, `python check-doc-ids.py`
   and `git diff --check` exited 0. The current-main WASM was regenerated with
   `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
   No Rust, content, dependency or atlas files changed in this correction.
7. Restored shader SHA256 is
   `ce05721488e31619d5ba1a73b41611d53afe641c6f85db7eff96e79c55104565`;
   helper SHA256 is
   `f9328efda128f912c7a3dd5b2d59a17f925f62efde0911a58217c126e2dcf5af`.
   Both match their pre-mutation versions. Shared row-writer SHA256 is
   `a2b016fd95e00e91161df9fdd45c5c53c0c45aba43cd202bd00eb240aec733f5`.

The frozen production build `index-CtbB62fg.js` /
`terri_wasm_bg-CfFbLFMP.wasm` was played at disposable origin4188. Ordinary
UI orders put Bill in the lower bunk at tick6044 (Day5 04:44). The complete
sleep indicator, desk edge, mattresses, posts and ladder were inspected in
flat and automatic nighttime lighting. A valid NW desk preview at `(6,8)`
remained intact against the other wall axis; Cancel restored the original
desk center `(6.5,6)` and SW facing without advancing the clock. Casey then
walked to `(8,6)` and used the desk after its Work menu order at tick6788.
Work still uses the existing standing pose; this change adds no animation.

Retained production screenshots: `wide-props-occupied.png`,
`wide-props-night.png`, `wide-props-builder.png`, `wide-props-work.png`.
Browser errors were empty. The first Work observation incorrectly waited for
an exact pose target, which generic Work does not export; the retry observed
activity and position instead. Public household saves were not used for testing.

Independent review accepted the production screenshots: the desk and bunk edges,
occupied sleep indicator and rotated preview had no remaining visual blocker.
The review also checked the projection math and propagation through the renderer.

Publication is a separate gate. The earlier checkpoint and its limits follow.

## Original one-tile checkpoint, 2026-09-20

Local acceptance on 2026-09-20, based on main `c0eca3018f4b0e8ef41e2f023389d736fe99cd0c`.
This checkpoint does not claim publication; verify the eventual main commit
and Pages deployment separately.

The reported laundry stack, toilet tank and NW desk chair lost visible pixels
to adjacent walls. Their source art was intact. Edge-wall panels now carry an
arm mask and world-space depth slope. The fragment shader orders each wall
column on its physical plane, including exposed far-arm tops at junctions.
Furniture, Sims and legacy cell walls retain their original depth values.
Positions, saves, walking paths, rig and atlas pixels are unchanged.

Instance rows grow from 32 to 40 bytes. The renderer still uses one instanced
draw call. Writing fragment depth can affect GPU cost, so the bounded timing
below is evidence for this machine only, not a cross-device performance claim.

## Reproduction and checks

Start Vite from `web`: `npm exec vite -- --host 127.0.0.1 --port 4188 --strictPort`.
In a dedicated browser tab at that origin, run:

```js
const proof = await import('/proofs/wall-occlusion.js');
await proof.wallOcclusionProof({ show: true });
await proof.wallJoinDepthProof();
await proof.doorTraversalProof();
```

1. Before correction, the 3x opaque-mask probe lost 2,641 laundry pixels,
   327 toilet pixels and 970 chair pixels. Source alpha was eroded two pixels
   to exclude filtering and background blending. The corrected foreground
   cases lose zero tested opaque pixels at 1x, 1.75x and 3x.
2. All 21 object cases pass, including mirrored behind-wall controls on both
   axes. All 120 corner depth brackets pass across nine masks and three zooms.
   Ten interpolated walking samples pass through both doorway orientations;
   replacing the opening with a solid wall hides the approaching Sim.
3. Removing the actual shader depth calculation makes 15 object cases and all
   120 corner brackets fail. Restoring it returns SHA256
   `64dbd3c47b8047a402dc8d07a58b88ba7083bb1e8cdd675698678039c2335c1e`.
   The earlier continuous corner threshold separately failed eight native
   top-outline probes; matching the authored raster corrected those failures.
4. `npm test -- --maxWorkers=1`: 777 tests passed, exit 0.
   `npm run typecheck`, `npm run build`, `python check-doc-ids.py`,
   `python assets/sprites/gen/build.py --check`, and `git diff --check`: exit 0.
   `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`:
   70 tests passed, exit 0.
   One earlier full test run hit the existing 5-second atlas-file hashing
   timeout; the unchanged test passed on the subsequent isolated run.
5. A real GPU probe drew 1,000 rigged Sim instances on a 1280x900 canvas at
   scale 0.5. After ten warmup frames, 60 draw-and-queue-completion samples
   measured median 3.315 ms, p95 7.225 ms, maximum 7.730 ms. No validation
   error. This includes queue scheduling, is not a GPU timestamp query, and
   does not establish unchanged cost versus the previous shader.
6. Independent code and visual review accepted the correction after identifying
   and checking the raster corner threshold. The played household remained
   loaded. No reset or save migration was performed.

Retained views: `wall-clipping-fixed-probes.png` and
`wall-clipping-played-fixed.png`. Atlas SHA256 remains
`404bdb982035c34bdf395a86b33e2b605515f4c47c2c4682be2b17bc02d81b23`.

The GPU fixtures use real production modules and source assets. They are
manual browser acceptance, not part of the headless Vitest count. They test
specific intersections, not arbitrary 3D depth inside every furniture sprite.
