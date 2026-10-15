# Character Appearance Proof Implementation Plan

Owner-approved execution scope: implement directly and obtain independent technical review. On 2026-10-12 the owner accepted seating positioning, requested improved feminine hair, and directed continuous completion using adversarial feedback rather than another routine approval stop. Preserve that positioning while diagnosing any materially penetrating surfaces. Finish remaining proof checks and prepare the full creator implementation plan. Publication and release remain outside this scope.

The owner subsequently accepted the demonstrated thigh/seat, shirt/arm and shirt/back-cushion intersections as expected game behavior, with an explicit requirement that the result look good in all four facings. Preserve the measured geometry and record visual acceptance separately from the zero-intersection diagnostic. Continue remaining proof fixes and adversarial review; accepted overlaps no longer require corrective deformation.

## Goal

Prove real saved appearance parameters in enlarged and game-size views: masculine/feminine presentation, height, build, colors, walking, and seated reading. Retain the complete creator as the next stage described by [the proposal](../../specs/2026-10-11-character-creator-proposal.md).

## Constraints

1. Reuse this worktree on `twcx/character-appearance-proof`; preserve existing proposal work.
2. Preserve accepted model and production sprite bytes. New authoring belongs in `assets/models/sims/appearance-proof/`; reusable rendering in `web/src/render/character/`; separate proof page in `web/proofs/character-appearance.html`.
3. Use installed background Blender and WebGPU. No new dependencies, paid services, or host changes.
4. Share a versioned appearance record between preview and world. Do not select pre-rendered bodies in place of continuous deformation.
5. Keep production startup, saves, and simulation randomness untouched. Use proof-specific storage and draft randomness.
6. New drafts randomize supported values, including presentation. Randomize respects field locks; provide field/section controls and undo. Editing/reload preserves exact values. No behavioral commentary under the preview.

## Stages

1. Record source hashes and baseline renders. Establish isolated proof entry point.
2. Export original and lighter runtime geometry, rest transforms, weights, actions and material regions. Reproduce the unchanged character with toon shading, outlines and facial/seam marks. Render dynamic color/depth/identity textures and compose them with the game's projection. Establish all four facings before expanding appearance.
3. Author both rest-shape presets, accepted curl and a simple bob. Height spans 85%-115% of neutral standing height while preserving head size. Build spans torso width 85%-140%, torso depth 80%-150%, hips 90%-130%, limbs 90%-125%. Interpolate around the neutral midpoint. Deform garment parts and attachments, adjust skeleton rest transforms, and add needed correctives. Separate skin/hair/shirt/trouser/shoe colors.
4. Adapt movement-driven walking and limb solving to configured lengths. Use an existing reading chair's source geometry and book. Define hip/back/foot/hand support, retain fixture dimensions, compose with floors/walls using per-pixel depth, and preserve person identity separately from furniture.
5. Add versioned record validation, randomization, locks, undo, proof storage/reload, action choice and frame stepping. Fail clearly on malformed records rather than substituting another character.

## Verification

1. Test 18 endpoint/midpoint configurations, all four facings, intermediate values, causal one-field changes, and unchanged unrelated fields.
2. Test full walking/reading cycles, pause/resume, frame-rate independence, transition contacts, clothing clearance, occlusion, picking and resource cleanup.
3. Test exact persistence, invalid values, locks, undo, seeded randomness and unchanged simulation state.
4. Capture real browser evidence at creator/game size. Measure six visible people and enlarged preview on this desktop; record hardware, frame times, memory and texture allocation against 16.6 ms. Phone performance remains unverified without an authorized device measurement.
5. Run focused Python/web tests, type checking and build with one local worker. Check source hashes and production sprites. Delete parameter application, lock protection, depth output and reload preservation separately; observe failing tests and restore exact bytes.
6. Obtain independent technical review. Present actual model/render results and limitations to the owner. Technical checks do not approve artwork.

## Failure and completion

Do not hide unsupported endpoints through silent clamping, body substitution, changed furniture dimensions, or narrower undocumented ranges. Preserve evidence and report a specific failed mechanism if the proof cannot meet its contract. After three similar failures use the mandated fresh-context better-way review.

Finish the proof and its remaining verification without asking for routine direction already supplied by the owner. Present actual renders and prepare the full creator implementation plan from demonstrated capabilities, preserving personality controls, field locks, random defaults, the 100-name pool and selected layout. This plan does not authorize production publication or release.
