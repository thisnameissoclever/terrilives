# Fridge open-and-reach, 2026-10-08

Base revision: `0d5ca2892b735335b1eae8c5e52a00b271798e0b` (main at verification).
This record covers the two chain steps that take food from the fridge: Get
ingredients in Cook dinner and Get snack in Grab a snack.

## Contents

- [Decision](#decision)
- [Played failures and their causes](#played-failures-and-their-causes)
- [Stance and choreography](#stance-and-choreography)
- [Independent visual review](#independent-visual-review)
- [Batch, export and import](#batch-export-and-import)
- [Empty and occupied registration](#empty-and-occupied-registration)
- [Runtime](#runtime)
- [Verification](#verification)
- [Deviations from the plan](#deviations-from-the-plan)
- [Limits](#limits)

## Decision

The missing-animation audit found both fridge steps drawing the standing
idle. On 2026-10-07 UTC the owner chose a full animation of the Sim opening
the fridge door, reaching inside and closing it, ruled out substituting an
existing clip, and approved longer step durations if the animation needed
them. The steps keep their authored durations (30 and 20 ticks): every
sampled length, from the 12-tick floor upward, shows all eight samples in
order (see [Runtime](#runtime)).

## Played failures and their causes

In the shipped house the fridge stands at (0, 0) facing SW in the kitchen
corner, with a wall behind it and a wall along the handle side of the tile
in front of it. Walls are 0.14 m thick and centred on the tile edge, so
their faces stand 0.43 m from the tile centre.

The first delivery stood the Sim half a tile to the left of the door-front
tile, inside that wall. The second kept the body inside the front tile but
still reached into the wall's thickness, and its scene depth varied only by
screen column: wall pixels nearer than a column's single depth cut the Sim,
the fridge's left side and the activity bubble along a straight vertical
line. In both, the selection ring and the bubble followed the scene row's
position, which is the fridge, not the drawn Sim. The simulation was never
stuck: Rust and WebAssembly tests on the shipped house run the step to
completion on every tick, including after loads taken before and during it.

The fix has three parts.

1. **Stance.** Every stance stands at x = -0.03 m, so the body's handle-side
   edge is at -0.405 m in every sample, 2.5 cm clear of the wall face. The
   door opens to 90 degrees while the Sim is close, so the body clears it,
   and the right hand pulls the handle from the front.
2. **Per-pixel depth.** Every scene carries a depth sprite in the door depth
   sprites' encoding: each pixel's game-space X+Y relative to the fridge's
   tile, from a ray cast through the exact export pixel against the posed
   body and fixture. The renderer draws the scene with
   `SURFACE_DEPTH_PROJECTION`, so a pixel is hidden only by something
   physically nearer. A pixel the fixture owns never reads farther than the
   fridge's anchor, the depth the empty fridge draws at, so occupying the
   fridge cannot newly hide any of its pixels.
3. **Ring and bubble.** Each fridge profile lists every sample's feet
   relative to the fridge; the ring is drawn under those feet, and the
   bubble over the body at their column and depth.

## Stance and choreography

The accepted refrigerator model (`kitchen/owner-review-pending/refrigerator/candidate-03`,
root scale 1.2) hangs its 0.84-metre door from a hinge at (0.42, -0.475)
metres. The door's free corner sweeps a circle covering most of the front
tile, so the Sim steps between three stances: FRONT at y = -1.05 (pulling
the handle), BACK at y = -1.50 (outside the swing) and REACH at y = -0.97
(reaching in while the door stands open). The feet slide between stances;
the legs keep their standing pose.

| Sample | Door | Stance | Hands | Smallest body gap |
|---|---|---|---|---|
| 0 | 0 | FRONT | rest | 0.25 m or more |
| 1 | 20 | FRONT | right hand pulls the handle | 7.8 mm |
| 2 | 55 | BACK | left hand on the handle | 8.4 mm |
| 3 | 90 | BACK | rest | 160 mm |
| 4 | 90 | REACH | left hand inside the cabinet | 98 mm |
| 5 | 90 | REACH | left hand inside the cabinet | 98 mm |
| 6 | 90 | BACK | left hand on the door's free edge | 8.4 mm |
| 7 | 0 | BACK | rest | 0.25 m or more |

All 54 body surfaces were tested against all 35 fixture solids (1,890 pairs)
with no collision; containment is decided by ray parity on all six axes,
because the sleeves, forearms and trouser legs are open tubes. The body's
world x stays within -0.405 and 0.491 m in every sample; the hinge-side
maximum is the hand on the 90-degree door, whose outer face stands at about
0.497 m. The left palm's centroid on the reach samples is (0.060, -0.403,
1.190) and (0.050, -0.373, 1.180) metres: behind the case front, between the
side walls, and between the top shelf lip and the compartment divider.
Between every pair of consecutive samples the door turns and the feet move
together, in steps of at most 2.5 degrees or 2.5 cm, against the body
except an arm whose hand touches the door in either sample (both arms
during the hand change from sample 1 to 2); nothing touches, and the
smallest gap is 62 mm. The door never moves while the Sim stands at REACH.
Every bone keeps its length within 1.8e-7 m. At the BACK stance the body
reaches about 0.24 m onto the second tile in front of the fridge, which is
open floor in the shipped kitchen: no stance inside the front tile clears
the swing of this door.

`kitchen/actions/fridge_reach_geometry.py` holds the schedule, stances,
targets, wall clearance and canvas padding, and refuses a stance that
reaches a wall face; `fridge_reach_pose.py` poses the rig and measures;
`render_fridge_reach.py` runs the measure, prototype and batch jobs and
casts the depth rays.

## Independent visual review

All prototypes keep their proofs, source snapshots and renders in
`kitchen/actions/review/fridge/`; none saved an editable model.

1. Prototype 01 was rejected before review: the legs swung with the bent
   pelvis because they are children of the hips bone.
2. Prototype 02 (the side stance) was accepted by a fresh-context reviewer
   and failed the first played check.
3. Prototype 03 (the first stepping stances) was rejected by the reviewer:
   at sample 6 in SE the forearm folded behind the upper arm.
4. Prototype 04 was accepted and failed the second played check.
5. Prototypes 05 and 06 were engineering runs for the wall-clear stance and
   the 90-degree door; prototype 05's proof records the sweep collision and
   the arm past the wall face that led to the 90-degree door and the
   right-hand pull.
6. Prototype 07 was accepted by the reviewer with no blocking finding
   (`review/fridge/prototype-07/contact-sheet.png`).

Non-blocking notes from the review: in SE the reaching hand at samples 4
and 5 is hidden behind the head; the stance changes are slides of about half
a metre and read closer to a hop than a step; the BACK stance reaches onto
the second tile; the sweep from sample 1 to 2 checks neither arm; and a wall
or tall unit on the hinge side would touch the 90-degree door.

`docs/assets/review-evidence/kitchen/fridge-reach-corner-composite.png`
composites every facing and sample into the shipped corner at game scale
(`kitchen/actions/fridge_corner_composite.py`): the exported scenes with
their depth sprites, analytic wall planes at the wall faces, the counter's
sprite, the ring under the feet and the bubble anchor over the head. In the
shipped SW placement the walls hide no body pixel in any sample; they hide
141 fixture pixels along the case's back and left edges, which the accepted
model sets 2.6 cm into the wall's thickness and which the empty fridge,
drawn at the same anchor depth, loses equally under the same comparison. In
the other facings the same corner is turned with the fridge, so walls stand
in front of the camera; the game cuts such walls away.

## Batch, export and import

Receipts: batch `kitchen/actions/review/fridge/batch-04/proof.json`
`7fac20658dac742c3da3e12e951f59dd1c93447edaa3c7aa425556fc7d9b5017`; body ink
`review/fridge/ink-04/proof.json`
`34aabc9654ccd22996560824dd4e046ba92b25c6e262c4cc0c8696b8d674f3e9`; export
`kitchen/actions/export/fridge-03/manifest.json`, pinned with its canonical
JSON SHA-256 as a reviewed extension in
`assets/models/architecture/architecture.json`. The superseded batches 01 to
03 and exports fridge-01 and fridge-02 were removed from the tree.

The batch renders four facings, eight samples, three shirts and four owners
(384 renders), eight body-ink passes per facing, an empty fixture reference
per facing, a door-only reference per facing and sample, and a per-pixel
depth array per facing and sample, on the fridge's 96 by 120 canvas grown by
26, 21, 26 and 22 logical pixels (left, top, right, bottom) to 148 by 163.
The camera keeps the accepted pixels per metre and shifts by whole pixels,
so the fixture's projected origin moves by exactly the padding. The fixture
references hide the whole body collection, because hiding only its objects
let the rig's drivers show the eyes again.

`fridge_export_contract.py` re-derives each clause from the recorded
measurements: the schedule and stances equal the pinned geometry module;
every sample has no collision, at least six millimetres of recorded gap, a
complete inventory and a handle-side edge clear of the wall face; every
depth array is present, registered to its export pixels and in range; the
reach palms lie in the cabinet by their coordinates; the legs and root keep
their standing pose; every sweep between consecutive samples is clear; every
non-door fixture part keeps one geometry fingerprint per facing and each
door part deviates from its hinge rotation by at most 2.5e-7 m; and the
padded registration matches the accepted camera.
`test_fridge_export_contract.py` holds the forgery suite and a pixel test
that, in the shipped SW placement, puts every visible body pixel in front of
both wall faces and every fixture-owned pixel at or nearer than the fridge's
anchor. The exporter compares every sample's furniture layer with the empty
reference wherever neither the body nor the door covers the case: the alpha
differs by at most two levels, so the case never moves; colour differs by
up to 36 premultiplied levels in SE and SW, where the Sim's shadow falls on
the case. All 96 scenes pass the source comparison limits against
independent floating-point beauty (maximum six, 95th percentile two); the
observed maxima are 4 and 1.

`offline_bathroom.py` imports the fridge as a third fixture kind with eight
samples per shirt and facing, its depth sprites, and each sample's feet. It
refuses a scene whose anchor is not the empty fridge's anchor moved by the
padding, to within a millionth of a logical pixel. The fixture-scene click
masks moved from `web/src/render/atlas.ts` into the generated module
`web/src/render/fixture-scene-masks.ts`, re-exported unchanged, because
`atlas.ts` had reached the hosting service's 100 MiB file limit.
`verify-sprite-preservation.py` learned to read coverage tables written as
index lists into a shared value table; the unchanged verifier could not
parse `BED_COVERAGE` on main either.

## Empty and occupied registration

Every scene's anchor is [74.0000114440918, 137.0004369020462], the empty
fridge's [48.0000114440918, 116.0004369020462] plus the padding. The occupied
furniture layer of sample 0, moved back by the padding, has the same alpha
centre as the empty `offlineFridge*` sprite in every facing and is inset by
three export pixels on every side, because the separate ink layer carries
the outline, as for the toilet and the bath.

## Runtime

`CompiledVisualAction::Fetch` appends after `Bathe` (postcard ordinal 12);
the compiler accepts `fetch` only on a chain step with the `station` anchor
and `toward_anchor` facing. Both cold-storage steps in `content/chains.toml`
declare it. Render action code 22 (`visual_action::FETCH`) carries the
`GETTING_INGREDIENTS` activity; codes 20 and 21 stay the shower and hand
washing.

The planner routes a fetch step to the tile in front of a one-tile station's
door, (1, 0) in the base facing turned with the object, and the privacy
detour keeps that tile. Unlike the hob, a fridge whose front is blocked or
unreachable stays usable: the body stands at another adjacent tile and keeps
the standing pose. The projection requires the body to stand on the front
tile, publishes the fridge as the interaction target, and writes the step's
elapsed share (0 to 1000) into the chore-progress column.

The step's sampled length is a presentation-only component,
`StepWorkTotal`, inserted with `StepWork` and removed on completion. It is
not saved and not hashed, so saves and the world hash are unchanged. A
loaded step rebuilds it as twice the remaining work, so presentation resumes
at the middle sample. The web selects `min(7, floor(progress * 8 / 1000))`,
holds sample 0 under reduced motion, keeps the fixture hidden while the
scene draws, draws the scene with its depth sprite, and places the ring and
bubble at the sample's feet.

## Verification

1. `render_buffer/fridge_reach_projection_tests.rs` covers both steps in all
   four facings, progress through every sample for lengths 12 to 48, Load,
   cancellation, a body off the front tile, a blocked front, a later chain
   step, routing with a fallback, and on `Sim::new_from_shipped_lot` the
   corner fridge's step counting down every tick from the door front and
   finishing, with saves taken before and during the step.
2. `web/tests/fridge-reach-production.test.ts` checks every facing, shirt
   and sample, the reduced-motion rest sample, click ownership, the padded
   anchor and the depth sprite's registration, both steps through the
   WebAssembly bridge with save, load and cancellation, and on
   `SimHandle.from_lot()` that every tick of the step draws a fridge scene
   in place of the fixture with its per-pixel depth, puts the ring under the
   drawn feet and the bubble over the drawn body, ends within its sampled
   length, and resumes at samples 0 and 4 after loads before and during it.
3. The gate counts for the delivered head are in the delivery report.
4. `prepare-fridge-gpu-reference.py` writes the decoded-layer shader
   reference from export `fridge-03` for `web/proofs/fridge-reach.js`, which
   draws all 96 scenes through the real sprite renderer and compares a
   copied readback with it. Run in the browser pane on export `fridge-03`:
   all 96 scenes passed with a maximum error of one colour level and a 95th
   percentile of zero, with empty validation and uncaptured-error lists.
5. The played checks of the two earlier deliveries failed as described
   above. Export `fridge-03` was played in the shipped house at the
   `127.0.0.1:5174` origin: Bill and then Casey fetched from the corner
   fridge. Enlarged five times against the owner's four failure points,
   the reach frame shows the Sim drawn whole with no straight cut on its
   left, the fridge's left side drawn whole, the selection marker under the
   Sim's feet on the front tile, and the activity bubble whole above the
   Sim's head; the open door covers the legs only where it stands in front
   of them. `fridge-reach-played.png` is that frame enlarged;
   `fridge-reach-arrival-played.png` shows Bill at the door front with his
   marker under his feet after the fetch. The browser tab and dev server
   were closed afterwards.

## Deviations from the plan

1. The Sim cannot stand squarely in front of the door without the door
   passing through it, and cannot stand beside the tile in a corner, so it
   steps between three stances inside the front tile's column.
2. The right hand pulls the handle from the front; the left takes the
   handle as the Sim steps back, reaches in, and takes the free edge to
   close the door. The door opens to 90 degrees rather than 80.
3. The plan added a saved `total_ticks` field. The length is presentation
   only, so it is not saved; every loaded step resumes at its middle
   sample, and saves keep their bytes.
4. The scene canvas is padded by whole logical pixels, following the shared
   sofa's padded registration, and the importer checks the padded anchor.
5. The scene draws with a per-pixel depth sprite, as the doors do.
6. Durations were not raised: eight samples fit the 12-tick floor.
7. The batch saves no editable Blender model.

## Limits

- The stance changes are slides; at game scale they read as small hops.
- In SE the torso hides the reaching hand.
- At the BACK stance the body reaches about 0.24 m onto the second tile in
  front of the fridge, where a passing Sim can overlap it.
- A wall or tall unit on the hinge side of the front tile would touch the
  open door.
- Colour on the case changes where the Sim's shadow falls; the exporter
  gates the case's silhouette, not its shading.
- A step loaded part-way resumes at the middle sample whatever its progress
  was when saved.
- The contract checks recorded measurements, not the surfaces themselves;
  the visual review, the depth pixel test and the case pixel check cover
  that gap.
- The batch receipt pins every imported model script, including two
  unrelated scene checks pulled in by shared imports.

Source review and local runtime proof do not establish public deployment.
