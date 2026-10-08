# Fridge open-and-reach, 2026-10-08

Base revision: `0d5ca2892b735335b1eae8c5e52a00b271798e0b` (main at verification).
This record covers the two chain steps that take food from the fridge: Get
ingredients in Cook dinner and Get snack in Grab a snack.

## Contents

- [Decision](#decision)
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

## Stance and choreography

The accepted refrigerator model (`kitchen/owner-review-pending/refrigerator/candidate-03`,
root scale 1.2) hangs its 0.84-metre refrigerator door from a hinge at
(0.42, -0.475) metres. The door's free corner sweeps a circle of 0.84 metres
across most of the front tile, while the Sim's arm reaches about 0.61 metres
from the shoulder, so no stance squarely in front of the door both clears
the swing and reaches inside without stepping. The accepted stance stands the
Sim on the handle side of the front tile, feet centred at (-0.55, -1.03)
metres and facing the fridge, outside the swing. The body is offset half a
tile to the left of the tile centre the simulation reports.

The eight progress samples are, in order: idle with the door closed; left
hand on the handle with the door at 20 degrees; left hand on the door's inner
face near the free edge at 55 degrees; three reach samples with the door at
80 degrees, the Sim bending 21 to 24 degrees at the hips, turning its
shoulders 21 to 24 degrees and keeping the head upright, the left hand inside
the upper fridge compartment; the hand drawing the door by its edge at 45
degrees; and idle with the door closed. The feet, legs and root are identical
in every sample and the last sample equals the first.

`kitchen/actions/fridge_reach_geometry.py` holds the schedule, stance,
targets and canvas padding; `fridge_reach_pose.py` poses the rig and measures;
`render_fridge_reach.py` runs the measure, prototype and batch jobs. A
candidate stance was chosen with a pure proxy search over the measured body
extents before any Blender job, then confirmed by the full measurement.

Measured on every sample (batch receipt below):

| Sample | Door | Left hand | Smallest body gap |
|---|---|---|---|
| 0, 7 | 0 | rest | 0.25 m or more |
| 1 | 20 | handle | 6.9 mm (palm to handle) |
| 2 | 55 | inner face | 6.2 mm |
| 3, 4, 5 | 80 | inside the cabinet | 53, 35 and 62 mm (hair to freezer door at 4) |
| 6 | 45 | inner face | 9.5 mm |

All 54 body surfaces were tested against all 35 fixture solids (1,890 pairs)
with no collision. Containment is decided by ray parity on all six axes,
because the sleeves, forearms and trouser legs are open tubes. The left palm's
centroid on the reach samples is (-0.182, -0.403, 1.190), (-0.162, -0.373,
1.180) and (-0.182, -0.414, 1.175) metres: behind the case front at y =
-0.474, between the side walls and between the top shelf lip and the
compartment divider. The door swept between consecutive samples in 2.5-degree
steps, against the body of both neighbouring samples except the door-hand
arm, never touches it; the smallest swept gap is 52.8 mm. Every bone keeps its
length within 1.8e-7 m. The smallest canvas margin is 8.6 logical pixels.

## Independent visual review

Prototype 01 (`kitchen/actions/review/fridge/prototype-01`) was rejected
before review: the legs swung with the bent pelvis because they are children
of the hips bone. Prototype 02 places the leg bones explicitly.

A fresh-context reviewer judged prototype 02's contact sheets
(`review/fridge/prototype-02/contact-sheet.png` and
`contact-sheet-game-scale.png`) and full-resolution renders adversarially and
accepted it for the batch with no blocking finding. Non-blocking notes: in SE
the torso hides the hand on the handle at sample 1 and the reaching arm at
sample 4, so SE reads as leaning in to look while SW shows the reach clearly;
the reaching knuckles sit just under the freezer door's outline in SW; and a
dark strip at the base of the fridge compartment, which belongs to the
accepted model, not to the pose. Both prototypes keep their proofs, source
snapshots and renders; neither saved an editable model.

## Batch, export and import

Receipts: batch `kitchen/actions/review/fridge/batch-01/proof.json`
`ae3f099730710c7e12cac39d64476c0a5192727d3603dae0f9a062e94a7e4569`; body ink
`review/fridge/ink-01/proof.json`
`7feb06df0de1cf6ace1b6e86806e10923977f04cf6396319e1b2a77892dbee13`; export
`kitchen/actions/export/fridge-01/manifest.json`, canonical JSON SHA-256
`599d54a3930c27c700dd79bae38e2e1722ac3cbdaf042af94c79b58b31403b7d`, pinned as
a reviewed extension in `assets/models/architecture/architecture.json`.

The batch renders four facings, eight samples, three shirts and four owners
(384 renders), eight body-ink passes per facing, an empty fixture reference
per facing and a door-only reference per facing and sample, on the fridge's
96 by 120 canvas grown by 30, 20, 30 and 26 logical pixels (left, top, right,
bottom) to 156 by 166. The camera keeps the accepted pixels per metre and
shifts by whole pixels, so the fixture's projected origin moves by exactly
the padding.

`fridge_export_contract.py` re-derives each clause from the recorded
measurements: the schedule equals the pinned geometry module; every sample
has no collision, at least six millimetres of recorded gap and a complete
inventory; the reach palms lie in the cabinet by their coordinates; the
planted bones never move; every door sweep is clear; every non-door fixture
part keeps one geometry fingerprint per facing and each door part deviates
from its hinge rotation by at most 2.5e-7 m; equal door angles draw equal
doors; and the padded registration matches the accepted camera.
`test_fridge_export_contract.py` holds the forgery suite. The exporter also
compares every sample's furniture layer with the empty reference wherever
neither the body nor the door covers the case: the alpha differs by at most
two levels, so the case never moves. Colour there differs by up to 42
premultiplied levels in SE and SW, where the Sim's shadow falls on the case,
and by at most 2 levels in NE (6.2 in 22 NW pixels) where the Sim stands
behind the fridge. All 96 scenes pass the source comparison limits against
independent floating-point beauty (maximum six, 95th percentile two); the
observed maxima are 5 and 1.

`offline_bathroom.py` imports the fridge as a third fixture kind with eight
samples per shirt and facing. It refuses a scene whose anchor is not the
empty fridge's anchor moved by the padding, to within a millionth of a
logical pixel. The atlas appends 230 records (134 visible-layer textures and
96 scene aliases) after all 30,599 published records;
`verify-sprite-preservation.py origin/main` passed and `build.py --check`
passed on the same output. The verifier learned to read coverage tables that
the generator now writes as index lists into a shared value table; the
unchanged verifier could not parse `BED_COVERAGE` on main either.

## Empty and occupied registration

Every scene's anchor is [78.0000114440918, 136.0004369020462], the empty
fridge's [48.0000114440918, 116.0004369020462] plus the padding. Measured in
export pixels against the four empty `offlineFridge*` sprites, with alpha
boxes given as an inclusive near corner and an exclusive far corner and the
occupied furniture layer of sample 0 moved back by the padding (60 and 40
export pixels):

| Facing | Empty sprite | Occupied furniture layer | Centres |
|---|---|---|---|
| SE | (36, 18) to (160, 226) | (39, 21) to (157, 223) | (98.0, 122.0) both |
| NW | (32, 16) to (156, 225) | (35, 19) to (153, 222) | (94.0, 120.5) both |
| SW | (32, 18) to (156, 226) | (35, 21) to (153, 223) | (94.0, 122.0) both |
| NE | (36, 16) to (160, 225) | (39, 19) to (157, 222) | (98.0, 120.5) both |

The occupied layer is inset by three export pixels on every side because the
separate ink layer carries the outline, as for the toilet and the bath; the
centres agree exactly.

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
the standing pose. The projection snaps nothing: it requires the body to
stand on the front tile, publishes the fridge as the interaction target, and
writes the step's elapsed share (0 to 1000) into the chore-progress column.

The step's sampled length is a new presentation-only component,
`StepWorkTotal`, inserted with `StepWork` and removed on completion. It is
not saved and not hashed, so saves and the world hash are unchanged. A loaded
step rebuilds it as twice the remaining work, so presentation resumes halfway
through the step, at the middle of the reach. The web selects
`min(7, floor(progress * 8 / 1000))`, holds sample 0 under reduced motion,
and keeps the fixture hidden while the scene draws.

## Verification

1. `cargo test --workspace -j 2`: 2,031 tests passed. `cargo fmt --all --
   --check` and `cargo clippy --workspace --all-targets -j 2 -- -D warnings`:
   passed.
   `render_buffer/fridge_reach_projection_tests.rs` covers both steps in all
   four facings (target, facing, displayed tile, unchanged save and hash),
   progress rising through every sample for lengths 12 to 48, Load resuming
   at 500, cancellation, a body off the front tile, a blocked front, a later
   chain step, and routing to the front with a fallback beside the fridge.
   The compile tests pin the `fetch` ordinal and the station contract; the
   compiled runtime fixture `inherited-runtime.pack` was regenerated for the
   new step visuals.
2. `web/tests/fridge-reach-production.test.ts` checks every facing, shirt
   and sample, the reduced-motion rest sample, progress (not ticks) selecting
   the scene, body versus fridge click ownership on ink-free pixels, the
   padded anchor, and both compiled steps through the WebAssembly bridge from
   start to finish, save and load mid-reach, and cancellation.
3. `wasm-pack build` rebuilt the package; `npm --prefix web test --
   --maxWorkers=1`: 2,203 tests in 178 files passed. Web typecheck and
   production build: passed.
4. Kitchen action suite (`assets/models/kitchen/actions`): 20 tests passed,
   including the geometry tests and the contract forgery suite. Bathroom
   action suite: 128 tests passed. Sprite generator suite: 237 tests passed,
   including a fridge importer test and the content-bounds union over the
   fridge scenes. Changelog tests and build, document identifiers: passed.
5. `docs/assets/review-evidence/kitchen/prepare-fridge-gpu-reference.py` and
   `web/proofs/fridge-reach.js` follow the bath's full-frame GPU proof. They
   were not run in this batch, because the proof needs a browser page and
   the browser check belongs to the delivery review.

## Deviations from the plan

1. The plan assumed the Sim could stand squarely on the front tile. The door
   swing makes that impossible without stepping, so the Sim stands on the
   handle side, half a tile left of the tile centre.
2. The plan put the left hand on the handle throughout. Once the door passes
   the shoulder the handle is on the far side of the door, so samples 2 and 6
   rest the hand on the door's inner face instead.
3. The plan added a saved `total_ticks` field with old saves restarting the
   reach. The length is presentation only, so it is not saved; every loaded
   step, old or new, resumes halfway, and saves keep their bytes.
4. The plan's 96 by 120 canvas cannot hold a Sim on the neighbouring tile.
   The scene canvas is padded by whole logical pixels, following the shared
   sofa's padded registration, and the importer checks the padded anchor.
5. Durations were not raised: eight samples fit the 12-tick floor.
6. The batch saves no editable Blender model; the scene is rebuilt from the
   pinned source model and scripts.

## Limits

- The body is drawn half a tile left of the front tile's centre, so it can
  overlap whatever stands on the diagonal tile in front of the fridge's left
  side, and depth sorting uses the fridge's position.
- In the SE facing the torso hides the reaching hand; SW shows it.
- Colour on the case changes where the Sim's shadow falls; the exporter
  gates the case's silhouette, not its shading.
- A step loaded mid-way resumes at the middle of the reach whatever its
  progress was when saved.
- The contract checks the recorded measurements, not the surfaces
  themselves; the visual review and the case pixel check cover that gap.
- The batch receipt pins every imported model script, including two
  unrelated scene checks pulled in by shared imports, so editing them
  invalidates the receipt until the batch is re-rendered.

Source review and local runtime proof do not establish public deployment.
