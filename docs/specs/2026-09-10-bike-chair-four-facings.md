# Bike and reading chair: four-facing authoring

The owner approved this milestone and autonomous execution on 2026-09-10,
including a fresh worktree from remote main. This is new work, not a revision
of the accepted Sim's appearance. The current branch starts at `a3559cd`.

## Scope

1. Build an editable local Blender exercise bike and upholstered reading chair.
   Use the existing slate-blue bike, cream striped towel and clay upholstery
   as identity references. Use the approved Sim's camera, lighting and toon
   materials as the rendering reference. Smooth geometry and antialiased
   contours must survive inspection at both source and game size.
2. Render SE, NW, SW and NE from rigid rotations of each model. No mirrored
   substitutes, silhouette-based recentering or per-facing scale adjustments.
3. Fit the objects and their contact points to the approved Sim, then verify
   occupied and empty views. Preserve the accepted neutral source, existing
   rig and exported frames; author new interaction variants separately if needed.
4. Continue shipping a 2D atlas. No runtime 3D engine, paid service requests,
   dependency changes, new furniture identities or save-schema changes.

## Authoring contract

Models face local -Y with +X right and +Z up. The existing camera projects
world +X to screen-right/down and +Y to screen-right/up; use its actual matrix
for measurements. Root rotations are SE=90, NW=270, SW=0 and NE=180 degrees.
An asymmetric landmark must rotate through all four views, not merely mirror.

The bike owns one transverse axle and opposite cranks, one pedal on each
physical side, a forward console with its display facing the rider, a saddle,
two stabilizers and a towel supported by one handle. Pedals rotate about the
axle while their platforms remain level. The towel may be a constructed static
drape; do not claim a cloth simulation when none was performed. Its underside
must clear the tube and its upper fold must visibly contact it.

The chair owns four feet, one cushion, a back and two arms. Correct occlusion
may hide a foot. Do not invent an extra visible foot to satisfy a counting rule.
Seat height, back clearance and foot support must be checked with the real
reading pose. The new object must not force a redesign of the approved Sim.

Keep editable objects named by physical part. Record source hashes, camera
registration, contact landmarks, render settings and the actual output hashes.
The first review checkpoint contains all four empty views and occupied views,
not just the most flattering angle. A render is a candidate until visual review.

## Integration and acceptance

The owner also reported softer-looking Sims. The current idle texture is
38 by 88 despite a 608 by 1408 source render. Test 2x texture density while
preserving logical sprite dimensions, anchors and world scale. The renderer
already separates UV rectangles from quad size, but CPU picking, camera bounds,
held-food dimensions and content bounds must use logical units too. Do not
change the shared linear sampler to nearest-neighbor to conceal lost detail.
The 1x/2x/4x offline board is a visual comparison, not GPU acceptance. Exact
shelf-pack estimates for the current Sim set are 2048 by 6667 at 2x versus
4096 by 12074 at 4x; 4x exceeds the current 8192-pixel packing limit. Start with
2x and verify device limits, atlas padding, memory and actual displayed quality.

First establish the visual candidate and physical fit. Then export separate
object and Sim frames with depth-correct foreground pieces, using the existing
foreground contract only if it can represent the necessary overlap. If an
interaction needs a richer depth contract, document the actual failing case
and assess its impact before expanding renderer scope. Do not bake a Sim into
the furniture sprite or hide bad contact with offsets.

Keep existing object IDs, positions, footprints and sprite indices stable.
Any replacement gets new appended sprite records and an explicit reviewed
content mapping. Preserve unrelated atlas pixels and test their complement.
Check the bike against its actual adjacent wall and lot boundary before batch
export. A new footprint or save migration requires a separate decision.

Mechanical checks cover true rotation, crank opposition, floor clearance,
complete output coverage, nonempty images, padding, physical registration and
immutable source bytes. Deliberately break load-bearing guards to prove they
fail. Independently review the actual rendered images before owner review.
Keep rejected candidates and specific reasons, and obtain a fresh-context
better-way review after three similar failures.

The milestone is complete only after four-facing occupied/empty acceptance,
played production-build checks, regression tests, green PR checks, merge and
verification of the exact deployed revision. An offline model checkpoint does
not establish runtime correctness or publication.

## Architecture review findings

Independent read-only review confirmed that object cranks currently have no
shared animation-sample owner with the rider. The rider is phased by Sim entity
ID, and the object animation path only handles the aquarium. New moving bike
layers must use the exact active rider/target association, not a nearest-position
guess or independent object clock. At initial review that association was not
in the render buffer. The implementation adds `interaction_targets`, an exact
entity index only when the validated socket action wins presentation selection.
All other rows use `u32::MAX`. It is cleared and rebuilt on every sync, including
command-only syncs. `SimBridge.interactionTargets()` recreates its memory view
after sync or growth. No simulation component, save field or new clock is added.

The current static foreground draws ahead of the whole Sim and omits the
registered draw offsets used for bodies. Test its capacity against actual
full-scene renders; do not assume one foreground can describe every moving
limb crossing. Paired visibility-resolved exports are the reviewer's preferred
next route if a static split fails. Runtime integration is underway.

The export probe found that owner-filtered Freestyle strokes can overlap even
when the reciprocal surface holdouts are complementary. The selected contract
keeps three textures: visible Sim surfaces, visible furniture surfaces, and
one outline pass rendered with both complete objects present as occluders.
Surfaces contain premultiplied colour contributions; the shader adds those
contributions, composites the outlines once, then applies its existing alpha
test and lighting. Empty furniture remains a separate ordinary RGBA sprite.
This is still one 2D instanced draw, not a live 3D scene or a Sim baked into a
furniture texture. Source comparison and actual GPU acceptance remain required.
