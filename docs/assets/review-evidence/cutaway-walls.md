# Cutaway walls

## Scope

Current edge-layout lots use one-third-height front, interior and authored yard
walls. Rear exterior walls stay tall. Walls and Room tools restore the full
opaque shell. Furniture and Buy retain the short view. Nearby far-side Sims
fade local sections to 25% in 200 ms; reduced motion snaps to the target.

No simulation, content placement, save schema, dependency or furniture-art
changes. Frozen legacy cell-layout presentation is preserved. Hinged doors
remain full-height objects; empty passages use short jambs without lintels.

## Render and state evidence

1. `cutawayWallProof()` passed 127 real WebGPU checks: 15 arm masks, both visible
   faces, three zooms (1, 1.75, 3), 25% blend, opaque occlusion, equal-depth
   overlapping transparent surfaces, a wall-only draw, and six straight-run
   seam comparisons. Distinct crossing wall surfaces may legitimately overlap
   in projection and blend twice; the seam identity applies to one straight face.
2. Isolated browser-response mutations failed as intended: using full wall height
   for short joins failed 24 probes; applying opacity before coverage discard
   failed 127; enabling short-wall depth writes failed the equal-depth probe.
   Overrides were confined to disposable browser contexts. Source files were
   never mutated by these probes.
3. Existing full-wall join proof passed 120 checks; the rectangular-footprint
   depth proof passed 180. Full-height geometry is requested explicitly in the
   legacy wall-occlusion harness so its original contract remains meaningful.
4. All 1,229 preceding sprite names, indices, dimensions, density and decoded
   pixels match the pre-change atlas. Their pinned digest is
   `7a53e9b9a1dcdb1a9830ced83a1b8e2a46296460a9c33af17e9b62a392893613`.
   The atlas appends 17 short-wall records; it is 4096 x 7979 pixels.
5. Played Walls -> Room -> Furniture switching left the world hash unchanged:
   `5912772670859666743`. Tim walked toward the shower through the ordinary
   command path, reaching (13, 4.75) at tick 27. No page errors occurred.
6. A separate disposable fixture spawned Sims at (10, 5) and (7, 4) to inspect
   fading on both axes. These are test actors, not additions to the household.
   Every browser context was closed in `finally`; no existing player save was used.

## Retained images

1. [Neutral lighting](cutaway-day.png).
2. [Full-height Walls tool](cutaway-build.png).
3. [Normal walking interaction](cutaway-walking.png).
4. [Local fade on both axes, two extra test actors](cutaway-fade-two-axes.png).
5. [Integrated autonomy build](cutaway-integrated.png).
6. [Production bundle, neutral lighting](cutaway-production.png).

## Local checks

Before integrating the newer autonomy revision, the full web suite passed
1,238 tests. The two subsequently added fade lifecycle/locality regressions
passed in the 80-test focused renderer run. Type checking, WASM, Vite build,
workspace Rust tests, all 88 sprite tests, documentation IDs and diff checks
passed.

Review caught and fixed inherited Load fading and skipped wall-only draws.
The reviewer also required a runtime depth-write mutation and a multi-panel
locality regression; both are included. Camera rebuilds preserve fades, while
successful Load resets them. A failed load does not reset presentation state.

## Integrated revision

Normal merge `a6985e09` incorporates autonomy revision `41341281`. The new
startup seed and constructor remain intact beside the wall fade hooks.

1. `cargo test --workspace --quiet`: PASS, exit 0; 1,197 tests.
2. `cargo fmt --all -- --check`: PASS, exit 0.
3. `cargo clippy --workspace --all-targets -- -D warnings`: PASS, exit 0.
4. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`:
   PASS, exit 0. The first web run started before this completed and failed six
   tests against stale WASM. That run is not acceptance evidence.
5. From `web`, `npx vitest run --maxWorkers=1`: PASS after the rebuild, exit 0;
   1,247 tests across 88 files. `npx tsc --noEmit` and `npm run build`: PASS,
   exit 0 each.
6. `python assets/sprites/gen/build.py --check`: PASS, exit 0; 1,246 records,
   4096 x 7979. `python check-doc-ids.py` and `git diff --check`: PASS, exit 0.
7. Real GPU `wallOcclusionProof({wide:true})` and `doorTraversalProof()`:
   PASS, no validation errors. Both full-wall axes retain correct near/far
   occlusion for laundry, toilet, chair, desk and occupied bunk sprites.
8. Played build-tool switching on the integrated binary left world hash
   `10782525511481673203` unchanged. Production preview loaded
   `index-_ARVb03E.js`, `terri_wasm_bg-J5e7457f.wasm`, and atlas
   `927727501d5976e291a82ad50ffac9b32f656c7d3cbd293f8691e0ae6b93707a`.
   The page was visible, with no page errors. Both task servers were stopped
   and disposable browser contexts closed.

Independent read-only review accepted the integrated source and screenshot.
This is local production-build evidence, not a claim that Pages has deployed.
The full remote mutation sweep is separate evidence and was not run locally;
the three renderer mutations above are targeted checks, not that sweep.
