# Fridge open-and-reach, 2026-10-08

Base revision: `0d5ca2892b735335b1eae8c5e52a00b271798e0b` (main at verification).
This record covers the two chain steps that take food from the fridge: Get
ingredients in Cook dinner and Get snack in Grab a snack.

## Contents

- [Decision](#decision)
- [Played failure and its cause](#played-failure-and-its-cause)
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

## Played failure and its cause

The first delivery stood the Sim half a tile to the left of the door-front
tile, outside the door's swing. In the shipped house the fridge stands at
(0, 0) facing SW in the kitchen corner, with walls on both sides, so that
body was drawn inside the left wall. The whole scene was also drawn at the
fridge's depth, so the wall beside the front tile, which is nearer the camera
than the fridge tile, covered the Sim. The orchestrating session's played
check showed the fridge closed, no body, and only the selection marker and
bubble. The simulation was not stuck: Rust and WebAssembly tests on the
shipped house (below) run the step to completion on every tick, including
after loads taken before and during the step, and the step counts down by
one each tick.

Two changes fix it. The body now stays inside the column of the front tile
(|x| within 0.5 m), stepping between stances instead of standing beside the
door. The scene's depth now follows a two-tile footprint made of the fridge
tile and the front tile, so the fridge's columns keep the fridge's depth and
the body's columns take the front tile's depth, as a Sim standing there
would.

## Stance and choreography

The accepted refrigerator model (`kitchen/owner-review-pending/refrigerator/candidate-03`,
root scale 1.2) hangs its 0.84-metre door from a hinge at (0.42, -0.475)
metres. The door's free corner sweeps a circle covering most of the front
tile, so no body inside that tile can both stay clear of the swing and reach
inside. The Sim therefore steps between three stances, all at x = -0.12 m:
FRONT at y = -1.05 (pulling the handle), BACK at y = -1.50 (outside the swing)
and REACH at y = -0.97 (reaching in while the door stands open). The feet
slide between stances; the legs keep their standing pose.

| Sample | Door | Stance | Left hand | Smallest body gap |
|---|---|---|---|---|
| 0 | 0 | FRONT | rest | 0.25 m or more |
| 1 | 20 | FRONT | pulls the handle | 6.9 mm |
| 2 | 55 | BACK | on the handle | 8.4 mm |
| 3 | 80 | BACK | rest | 139 mm |
| 4 | 80 | REACH | inside the cabinet | 104 mm |
| 5 | 80 | REACH | inside the cabinet | 98 mm |
| 6 | 80 | BACK | on the door's free edge | 9.5 mm |
| 7 | 0 | BACK | rest | 0.25 m or more |

All 54 body surfaces were tested against all 35 fixture solids (1,890 pairs)
with no collision; containment is decided by ray parity on all six axes,
because the sleeves, forearms and trouser legs are open tubes. The body's
world x stays within -0.495 and 0.352 m in every sample. The left palm's
centroid on the reach samples is (0.060, -0.403, 1.190) and (0.050, -0.373,
1.180) metres: behind the case front at y = -0.474, between the side walls,
and between the top shelf lip and the compartment divider. Between every pair
of consecutive samples the door turns and the feet move together, in steps
of at most 2.5 degrees or 2.5 cm, against the body except the door-hand arm;
nothing touches, and the smallest gap is 75 mm. The door never moves while
the Sim is at the REACH stance. Every bone keeps its length within 2.2e-7 m.

`kitchen/actions/fridge_reach_geometry.py` holds the schedule, stances,
targets and canvas padding and refuses a stance that leaves the front tile's
column; `fridge_reach_pose.py` poses the rig and measures;
`render_fridge_reach.py` runs the measure, prototype and batch jobs.

## Independent visual review

All prototypes keep their proofs, source snapshots and renders in
`kitchen/actions/review/fridge/`; none saved an editable model.

1. Prototype 01 was rejected before review: the legs swung with the bent
   pelvis because they are children of the hips bone.
2. Prototype 02 (the side stance) was accepted by a fresh-context reviewer
   and failed the played check, as described above.
3. Prototype 03 (the stepping stances) was rejected by a fresh-context
   reviewer: at sample 6 in SE the forearm folded behind the upper arm, so
   the door-edge grip read as a stump.
4. Prototype 04 grips the edge lower with a low, forward elbow and moves the
   stances 1 cm right so the body stays inside the tile column. The reviewer
   accepted it with no blocking finding
   (`review/fridge/prototype-04/contact-sheet.png`).

Non-blocking notes from the review: in SE the reaching hand at samples 4
and 5 is hidden behind the head, so SE reads as looking in while SW shows
the reach; the pulling hand at sample 1 is hidden in SE and SW; the stance
changes are slides of about half a metre and read closer to a hop than a
step; and the BACK stance reaches about 0.24 m onto the second tile in front
of the fridge.

## Batch, export and import

Receipts: batch `kitchen/actions/review/fridge/batch-03/proof.json`
`661d4bf7337c0545657046a3e478a8d330b7b5823da953b7cb3124993cc07cb3`; body ink
`review/fridge/ink-03/proof.json`
`5b40286938588b1437d710ace9a9c73e50d51bc2a6633ab8e9cfc12b238b7214`; export
`kitchen/actions/export/fridge-02/manifest.json`, pinned with its canonical
JSON SHA-256 as a reviewed extension in
`assets/models/architecture/architecture.json`. The superseded batch-01,
ink-01 and fridge-01 receipts were removed from the tree.

The batch renders four facings, eight samples, three shirts and four owners
(384 renders), eight body-ink passes per facing, an empty fixture reference
per facing and a door-only reference per facing and sample, on the fridge's
96 by 120 canvas grown by 26, 21, 26 and 22 logical pixels (left, top,
right, bottom) to 148 by 163. The camera keeps the accepted pixels per metre
and shifts by whole pixels, so the fixture's projected origin moves by
exactly the padding. The smallest canvas margin is 8.7 logical pixels. The
fixture references hide the whole body collection: hiding only its objects
let the rig's drivers show the eyes again, which punched two holes in the
first empty reference.

`fridge_export_contract.py` re-derives each clause from the recorded
measurements: the schedule and stances equal the pinned geometry module;
every sample has no collision, at least six millimetres of recorded gap, a
complete inventory and a body inside the tile column; the reach palms lie in
the cabinet by their coordinates; the legs and root keep their standing pose;
every sweep between consecutive samples is clear; every non-door fixture
part keeps one geometry fingerprint per facing and each door part deviates
from its hinge rotation by at most 2.5e-7 m; and the padded registration
matches the accepted camera. `test_fridge_export_contract.py` holds the
forgery suite. The exporter compares every sample's furniture layer with the
empty reference wherever neither the body nor the door covers the case: the
alpha differs by at most one level, so the case never moves. Colour there
differs by up to 38 premultiplied levels in SE and SW, where the Sim's
shadow falls on the case, and by at most 6.2 levels in NE and NW, where the
Sim stands behind the fridge. All 96 scenes pass the source comparison
limits against independent floating-point beauty (maximum six, 95th
percentile two); the observed maxima are 4 and 1.

`offline_bathroom.py` imports the fridge as a third fixture kind with eight
samples per shirt and facing. It refuses a scene whose anchor is not the
empty fridge's anchor moved by the padding, to within a millionth of a
logical pixel. `verify-sprite-preservation.py origin/main` and
`build.py --check` pass on the rebuilt atlas (counts in the delivery
report). The verifier learned to read coverage tables that the generator now
writes as index lists into a shared value table; the unchanged verifier
could not parse `BED_COVERAGE` on main either.

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
scene draws, and gives the scene the two-tile footprint depth described in
[Played failure and its cause](#played-failure-and-its-cause).

## Verification

1. `render_buffer/fridge_reach_projection_tests.rs` covers both steps in all
   four facings, progress through every sample for lengths 12 to 48, Load,
   cancellation, a body off the front tile, a blocked front, a later chain
   step, routing with a fallback, and on `Sim::new_from_shipped_lot` the
   corner fridge's step counting down every tick from the door front and
   finishing, with saves taken before and during the step.
2. `web/tests/fridge-reach-production.test.ts` checks every facing, shirt
   and sample, the reduced-motion rest sample, click ownership, the padded
   anchor, both steps through the WebAssembly bridge with save, load and
   cancellation, and on `SimHandle.from_lot()` that every tick of the step
   draws a fridge scene in place of the fixture with the two-tile depth, that
   the step ends within its sampled length, and that loads before and during
   the step resume at samples 0 and 4.
3. The gate counts for the delivered head are in the delivery report.
4. `prepare-fridge-gpu-reference.py` and `web/proofs/fridge-reach.js` follow
   the bath's full-frame GPU proof.

## Deviations from the plan

1. The Sim cannot stand squarely in front of the door without the door
   passing through it, and cannot stand beside the tile in a corner, so it
   steps between three stances inside the front tile's column.
2. The left hand rests on the handle while the door is near the Sim and
   takes the free edge to close it; it leaves the door while the Sim reaches.
3. The plan added a saved `total_ticks` field. The length is presentation
   only, so it is not saved; every loaded step resumes at its middle sample,
   and saves keep their bytes.
4. The scene canvas is padded by whole logical pixels, following the shared
   sofa's padded registration, and the importer checks the padded anchor.
5. The scene's depth follows the fridge tile and the front tile together.
6. Durations were not raised: eight samples fit the 12-tick floor.
7. The batch saves no editable Blender model.

## Limits

- The stance changes are slides; at game scale they read as small hops.
- In SE the torso hides the reaching hand and the pulling hand.
- At the BACK stance the body reaches about 0.24 m onto the second tile in
  front of the fridge, where a passing Sim can overlap it.
- Colour on the case changes where the Sim's shadow falls; the exporter
  gates the case's silhouette, not its shading.
- A step loaded part-way resumes at the middle sample whatever its progress
  was when saved.
- The contract checks recorded measurements, not the surfaces themselves;
  the visual review and the case pixel check cover that gap.
- The batch receipt pins every imported model script, including two
  unrelated scene checks pulled in by shared imports.

Source review and local runtime proof do not establish public deployment.
