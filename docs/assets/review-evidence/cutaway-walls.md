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

## Local checks

Before integrating the newer autonomy revision, the full web suite passed
1,238 tests. The two subsequently added fade lifecycle/locality regressions
passed in the 80-test focused renderer run. Type checking, WASM, Vite build,
workspace Rust tests, all 88 sprite tests, documentation IDs and diff checks
passed. Final combined-revision checks are recorded below before publication.

Review caught and fixed inherited Load fading and skipped wall-only draws.
The reviewer also required a runtime depth-write mutation and a multi-panel
locality regression; both are included. Camera rebuilds preserve fades, while
successful Load resets them. A failed load does not reset presentation state.
