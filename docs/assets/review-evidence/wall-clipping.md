# Wall clipping correction

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
