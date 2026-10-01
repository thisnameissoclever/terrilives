# Low-backed armchair visual replacement

## Scope and fit

The living-room armchair now uses four registered empty views and four seated
samples for each of the three existing shirt colours. Its ID, position, 1x1
footprint, SW seat socket, Sit action, price, duration, effects and saved state
are unchanged. The reading chair remains a separate object with its own art.
The old armchair foreground overlay is removed; occupied frames own the body,
furniture and outlines through the existing renderer. No renderer, shader,
Sim rig, dependency or save-schema changes ship in this batch.

Candidate 01 had arm, trouser and hip intersections. Candidate 02 cleared the
arms and base but retained slight hip penetration. Candidate 03 fits the
unchanged pose, with a cushion top of 0.404 model units. Retained originals,
editable source, source hashes and rejected-candidate notes are under
`assets/models/living/owner-review-pending/armchair/`.

Four evaluated poses test all 54 visible body meshes against ten chair solids,
including triangle crossings and containment in both directions. Each passes
with zero detected intersections, minimum hip gap 0.00029913, 49 near-support
vertices and projected hull area 0.01785954. Twelve structural contacts connect
the frame to four grounded chair feet. Eight damaged scenes fail for their
specific physical reason; four synthetic cases exercise the collision queries.
Re-signed receipt tests also reject evidence that failed for the wrong reason.

This is rigid visual support, not cloth or cushion simulation. Hands rest near
the thighs, not on the arm tops. The approved rig retains roughly 0.01915 shoe
clearance above the floor. Primary and independent source review accepted the
candidate at 95/100, a subjective rating. Minor upholstery outline endings
were accepted; no clipped hands, cuffs, knees or shoes were observed.

## Rendering and runtime evidence

The production export verifies 196 original RGBA PNGs at 768x960, covering four
empty renders plus 48 occupied beauty/body/furniture/outline groups. All 48
reconstructions meet the unchanged p95 <=12 and maximum <=64 error limits.
Shirt variants have identical alpha, chair and outline contributions. The
runtime textures are 192x240 on a 96x120 logical canvas at density two, anchored
at approximately (48.000011,116.000437). No cropping is used.

Independent preview and production renders are not byte-identical. Small
rerender differences appear around outlines; the production receipt binds its
own exact originals. Those differences are not a claim of changed model fit.

1. `armchair-gpu.png` and `armchair-gpu.json` retain 65 real WASM/GPU scenes:
   four empty views, all 48 occupied combinations, five colourways, midnight
   and selected Build preview, plus five occupied colourways and occupied
   midnight. Chair recolouring does not recolour Tim's blue shirt, skin or
   hair. Validation and page-error lists are empty.
   Explicit draw ticks select all four authored samples from a real active
   target-bound Sit state; they do not extend the 41-tick action.
2. `armchair-room.png` and `armchair-played.png` show the production build.
   An ordinary right-click menu and Sit down command put Tim in the chair at
   tick 21, activity 11, visual action 8, target entity 12, with Sit at the
   front of his queue. The game DOM was not replaced or patched.
3. All four Build rotations were confirmed through the production UI. Each
   reported Furniture placed, and the actual simulation facing was checked.
   Returning to SE left the complete save bytes identical at tick zero.
   `armchair-night.png` shows that final state under automatic midnight light.
4. Production resources were `index-Bv2rhHxo.js`,
   `terri_wasm_bg-BsvRmHoU.wasm` and the atlas digest below. Owned browser
   contexts closed in finally blocks. No existing browser saves were used.
5. Primary and independent review inspected the GPU board and played captures.
   Contact and occlusion read consistently in all four directions, with no
   visible clipping or extra limbs. Existing room layout was preserved.

## Preservation and checks

Atlas: 1,346 records, 8192x4707. SHA256:
`d8ba23808b8253ec030a28cfbbc41a521d99348955e07186ebdfb855a5bb61c4`.
The 76 new records follow all 1,270 previous sprites. All earlier decoded
pixels and non-packing records are unchanged, with prefix digest
`99d9ccb1b3ae74c3a3e8a2a41618c4ca26a0e7fdf69e7f3ed9ccb4d8a3dabbe2`.
Independent comparison also found all nine earlier runtime metadata tables
unchanged, including anchors, interaction profiles and hand/rig tables.
Parsed content differs only in the armchair sprite and foreground removal.

1. All 196 original files and the accepted generation receipt pass the full
   local verifier. The 106-test sprite suite and 22 living-model tests pass;
   the added metadata-prefix test also passes, making 107 sprite tests.
2. Web regression run: 1,340 passed and one obsolete fixture failed because
   no shipped object retains a foreground overlay. An explicit overlay
   fixture restores that coverage; all 23 builder tests pass. The ten
   interaction production tests cover every armchair facing, shirt and sample,
   plus active ownership, pause, reduced motion, save/load, cancellation and
   picking. Together these runs cover all 1,341 tests in 95 files.
3. Rust regression run passed 106 core, 267 data, one integration and 692 sim
   tests. Its remaining sim test correctly rejected obsolete armchair sprite
   IDs. Updating only that expectation passed the focused test. All 147 WASM
   tests passed. Subsequent distinct-ID fixture corrections passed all eleven
   foreground tests. Total workspace coverage: 1,214 passing tests across
   the complete run and scoped correction/completion runs.
4. Rust formatting, clippy, release WASM, TypeScript, Vite and documentation
   ID checks pass. The full remote mutation sweep is separate evidence; it
   is not implied by these local checks.
5. Deleting preview foreground suppression makes the builder regression fail
   (1272 rather than expected overlay 360). Disabling occupied suppression
   fails eight interaction tests, including all four new facing tests. Both
   mutations exited 1; restoring the sources passes all 33 focused tests.
   Before/after SHA256 for frame.ts:
   `bb19f52aa852f5e8c71b414fb5ed62742bd32d6d164c3fbe1eaafc9c3385ecc8`;
   interaction-sprites.ts:
   `7bdb6d2eedb1030ca15010e420e9169ab39034a1a55721b0925d4326b2f917fb`.
6. The prefix test now pins the nine historical metadata tables, preserving
   nested frame order. Ten in-memory mutations, one scalar in each table plus
   altered historical pixels, each produced exactly one failed assertion.
   Restoring the readers passes both prefix tests; no source or image files
   were changed by those mutations.
7. Clean export of staged tree `8682e39ac402bedfb4eaa656f46073961cb29e98`
   passes atlas freshness, all 107 sprite tests, all 22 living-model tests and
   document-ID validation without ignored originals. Exact-byte JSON
   attributes preserve the signed receipts across Git checkout. The subsequent
   addition to this record changes documentation only.

Final independent review also accepted the six added occupied-colourway/night
panels. The first extra browser capture stalled before module loading; its
owned context was closed and the pending call stopped. A clean run completed
the 65-scene proof with empty validation and page-error lists. Both task-owned
preview servers were stopped after verification.

Source merge and public deployment are reported separately. These local
checks do not claim that GitHub Pages already serves the new revision.
