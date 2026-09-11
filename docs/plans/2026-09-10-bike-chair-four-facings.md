# Bike and reading chair implementation plan

> Execute task by task with independent adversarial visual review. The owner
> has approved autonomous execution; retain the visual and publication gates.

**Goal:** Correct four-facing furniture and matching Sim interactions.

**Architecture:** Editable Blender objects share the accepted Sim's projection
and style. Physical part geometry produces four views and contact landmarks.
Verified exports enter the existing 2D sprite system only after visual review.

**Tech stack:** Installed Blender 4.5, Python and Pillow, existing Rust and
TypeScript renderer. No dependency additions or provider spending.

**Spec:** `docs/specs/2026-09-10-bike-chair-four-facings.md`.

## Task 1: Model and visual checkpoint

1. Add `assets/models/furniture/test_geometry.py` before `geometry.py`.
   Test a literal asymmetric point through all four facings, opposite crank
   offsets and fixed side ownership, and floor clearance through a full cycle.
   Example: rotating `(1, 2, 3)` to SE must yield `(-2, 1, 3)`.
2. Run `python -B -m unittest discover -s assets/models/furniture -p test_*.py`;
   observe the missing-contract failure, then implement the pure geometry.
3. Add named-part Blender builders and a background preview script under
   `assets/models/furniture/`. Load the immutable rig without saving over it;
   reuse the camera/light setup and clone the existing toon shader for props.
4. Save distinct model files and high-resolution four-facing previews. Write
   running/complete/failed status and per-output hashes. Check actual geometry
   and rendered image padding rather than trusting launcher exit status.
5. Inspect all views and occupied composites, request independent visual review,
   retain defects and revise within the rule of three. Show only clearly labeled
   candidates that have passed review.

## Task 2: Interaction export

1. Write tests for output coverage, physical anchors and immutable Sim sources.
   A missing facing or altered source must fail, not silently fall back.
2. Use named model landmarks to solve rider and chair contact. Export Sim and
   prop images separately; test the reconstructed layered image against the
   full 3D contact view before choosing the foreground mapping.
3. Inspect both pedal phases and all reading samples in every facing, then
   native-size composites against actual walls and floor. Do not batch colors
   until the green reference passes.

## Task 3: Runtime and delivery

1. Impact-scan content mappings, object frame timing, foreground drawing,
   picking and sprite anchoring before edits. Add failing behavioral tests
   for the actual mapping and overlap contract established in Task 2.
2. Append approved exports, preserve the old index ordering and unrelated
   pixels, and update content without changing object identities or footprints.
3. Run Python model/sprite tests, atlas freshness, doc IDs, Rust tests, web
   typecheck and single-worker web tests. Mutate the rotation, output-coverage
   and preservation guards and record failures before restoring them.
4. Build and play the exact candidate in an authorized dedicated browser;
   inspect all four occupied and empty rotations, wall clearance, selection,
   pause/reduced motion, save/load and unchanged household shirt colors.
5. Update provenance, review evidence and feature status. Commit and push the
   coherent batch, require green CI before merge to main, and verify deployment.

## Progress

Baseline: 21 Sim tests and 23 sprite tests pass; atlas check confirms 836
records at 1024 by 4596. Runtime has not changed in this phase.

Initial candidate 02 contains 16 hashed empty/occupied renders and two editable
authoring scenes. Main and independent visual review passed it for owner
direction feedback, retaining chair-seam and towel-stiffness polish notes.
At that checkpoint eight furniture tests and four guard-mutation checks passed;
Tasks 2 and 3 had not started. An offline 1x/2x/4x density board accompanies the candidate; the
recommended next texture-density trial is 2x, with unchanged logical sizing.

The owner subsequently approved candidate02, the2x trial and animation completion.
Remote main's wall fixes were merged at6d1eb7e; baseline is now847 records. A
second fetch confirmed dca6a9a remains included. Implementation is underway in
this worktree, preserving the dirty original checkout and immutable Sim sources.

The cycle probe exposed shoe/housing intersections. Pedal spacing now fits the
evaluated shoes and includes actual extended spindles; sixteen sampled poses
have zero shoe/flywheel intersections. Animation-layer experiments are separate
from approved candidate files. Reciprocal holdouts need independent full-scene
outline coverage because Freestyle strokes overlap when exported per owner.

Integration now contains 1,087 sprites with all 847 preceding logical records
and decoded pixels preserved. All 584 production passes completed, yielding
144 three-layer pose/palette groups and eight empty views. Actual Chrome GPU
captures cover every phase, facing and palette. Primary and fresh independent
visual review found no blocking regressions. The played household shows the
bike and reading chair correctly against adjacent walls. Release evidence and
remaining acceptance gates are recorded with the review images.
