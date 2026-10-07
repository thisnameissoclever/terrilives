# Fridge Reach Animation Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` task by task. Root owns source acceptance and
> publication under the owner's standing autonomous authorization.

**Goal:** Animate the two chain steps that take items from the fridge (Get
ingredients in `cook_dinner`, Get snack in `prepare_snack`): the Sim stands in
front of the fridge, the door swings open, the Sim reaches inside, and the
door closes, drawn as a fixture-composited scene registered to the fridge's
empty sprite, with unchanged gameplay and save contracts.

**Owner decision (2026-10-07 UTC):** build the full open-and-reach animation;
do not substitute an existing clip; extend the step time if that is what it
takes to look good.

**Architecture:** Reuse the bathroom action pipeline (immutable accepted
source model, loop renderer with body, furniture and ink owners per facing
and frame, export contract, additive scene encoder, importer, atlas tables,
web scene compositing with coverage masks). The furniture layer differs per
frame because the door moves; that is the intentional-motion exception in
[L-fixtures-stay-put-under-occupants], so the fridge case must be proven
identical in every frame and only the hinged door assemblies may move.
Playback is progress-driven, like the cleaning clips, because a reach is not
a loop.

**Tech stack:** Blender 4.5 (hidden background jobs, two threads), Python and
Pillow, Rust, TypeScript.

## Global constraints

1. Work only in the assigned worktree; no paid providers; no new dependencies.
2. Preserve the accepted fridge model, its closed sprites, all published
   sprites and tables, and the seventeen anatomical bone lengths.
3. The fridge case, plinth, handles' mounts and shelves must not move between
   frames; only the refrigerator door assembly (and the freezer door, if the
   pose needs it) rotates about its hinge.
4. Every scene's anchor equals the empty fridge's anchor; the importer refuses
   otherwise.
5. Hidden Blender jobs with proof journals as the only completion signal; log
   tracebacks through a wrapper script.
6. Publish after local gates without waiting for duplicate remote checks.

## Review focus

1. The door must open into the front tile without passing through the Sim.
2. The reaching arm must end inside the cabinet, not in the door or the shelf.
3. The case must be pixel-identical to the empty sprite outside the door
   region in every frame (compare furniture layers against the closed sprite).
4. Progress playback must open, reach and close within any sampled step
   duration, pause with the game, hold the rest frame under reduced motion,
   and come back after Load.
5. Picking must separate body and fridge in every frame, including the open
   door.

## Source facts

- Model: `assets/models/kitchen/owner-review-pending/refrigerator/candidate-03/refrigerator-authoring.blend`,
  pinned by `assets/models/static-props.json` as `offlineFridge`. Doors hang
  under `Refrigerator right hinge` and `Freezer right hinge`; rotating a hinge
  about Z by a positive angle swings the door forward into the front tile.
  `kitchen/fridge_geometry.py` holds `HINGE = (.35, -.396)`.
- Registration: 768 by 960 source canvas (logical 96 by 120), density 8,
  origin pixels [384.0001, 760.0035], anchor [48.0000, 116.0004], the same
  as the toilet. Shipped sprites `offlineFridge{,NW,SW,NE}` at 192 by 240,
  density 2.
- Sim rig: `assets/models/sims/sim-01/sim-01-rigged.blend` (`SIM_01_SHARED_RIG`),
  loaded the way `render_toilet_use.py` does.
- Steps: `content/chains.toml` `cook_dinner` step 0 (30 ticks) and
  `prepare_snack` step 0 (20 ticks), role `cold_storage`, no visual today.
  Sampled durations run 0.6 to 1.4 times content, floor 12 ticks.
- The chain planner routes every non-cook step by `find_path_adjacent`, so
  the Sim is not guaranteed to stand in front of the fridge; cooking has a
  `stove_front` rule to copy.

## Task 1: content and runtime contract

1. Add `fetch` to `CompiledVisualAction` (after `Bathe`) and to the compile
   matrix for chain-step owners with `station` anchor and `toward_anchor`
   facing. Pin the postcard ordinal and the string in the compile tests.
2. Give both cold-storage steps `visual = { action = "fetch", anchor = "station", facing = "toward_anchor" }`.
   Raise both durations to 30 ticks if the reach needs it (owner-approved).
3. Add render action `FETCH = 22` (`WASH_HANDS` is 21, 20 stays the shower).
   The station projection for a fetch step publishes the fridge as the
   interaction target and snaps the Sim to the fridge front tile, as
   `cooking_projection` does with `stove_front`; add a `fridge_front` route
   rule in `systems/chain.rs` so the Sim walks to that tile.
4. Publish step progress for fetch steps on the Sim's row in the existing
   chore-progress column (0 to 1000). `StepWork` gains `total_ticks` with a
   save field defaulting to the remaining count on old saves (progress
   restarts after loading an old mid-step save; record this limit).
5. Tests: compile matrix, shipped chain table, projection facing and target,
   progress monotonic from 0 to 1000 over a sampled duration, Load rebuild.

## Task 2: pose and door authoring

1. `assets/models/kitchen/actions/fridge_reach_pose.py`: stand the Sim on the
   front tile facing the fridge, solve the right arm with `two_link` into a
   point inside the cabinet at shelf height, left hand on the door handle.
   Validate complete clearance of all 54 body objects against the case and
   shelves with the door at 80 degrees; validate the arm end point inside the
   cabinet volume. Write a proof journal with joint targets and clearance.
2. Door schedule over eight samples: closed, 20, 55, 80, 80, 80, 45, 0 degrees
   (mirrors the bin lid's schedule shape). The reach sits on the three 80
   degree samples; the hand follows the handle while the door moves.
3. Independent visual review of the four-facing prototype before the loop.

## Task 3: render, export, import

1. `render_fridge_reach.py`: for each facing, palette and sample, render
   beauty, sim, furniture and lines owners, plus body ink; the furniture
   owner includes the moved door. Record per-frame digests of every fixture
   part; the contract requires all non-door parts identical across frames and
   each door part to differ only by its hinge rotation.
2. `fridge_export_contract.py` and `export_fridge_reach.py`: fork the bathroom
   contract (keep the exact hash chain, raster checks, additive encoder, tile
   drop anchor); replace the loop clauses with the sample schedule and the
   door clauses above; recompute clearance claims from witnesses.
3. Importer kind `fridge` in `offline_bathroom.py` or a new
   `offline_kitchen_actions.py`: eight frames, three palettes, scenes keyed by
   the empty fridge sprite and action 22; architecture extension pinned by
   canonical hash; `build.py` block; preservation check against `origin/main`.

## Task 4: web playback and proof

1. `interaction-sprites.ts`: for action 22 select the frame from the row's
   progress (like `cleaningFrame`), hold frame 0 under reduced motion, keep
   the fixture hidden while the scene draws, coverage masks per frame.
2. GPU full-frame proof over all 96 scenes against the decoded-layer
   reference; production test through the WebAssembly bridge (both steps,
   save and load mid-reach, cancellation); played check at `127.0.0.1:5174`
   with screenshots at door opening, reach and closing.
3. Changelog bullet, FEATURES and GAME-SYSTEMS updates, evidence record,
   independent adversarial review, merge, Pages verification.
