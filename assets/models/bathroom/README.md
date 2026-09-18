# Bathroom model replacements

Continue the approved offline model-to-sprite process after the kitchen.
The first replacement is the existing `sink` / Basin Basic pedestal sink.
Keep its identity, placement, footprint and interactions. Use the accepted
Sim scene's camera and toon lighting, without changing its visible model.

The accepted sink has a warm-white ceramic bowl and pedestal with satin metal
hardware. One mesh forms the rim, recessed floor, outer shell and underside.
The tap mounts on its rear deck and drains into the bowl. The full fixture fits
the existing one-tile space. No water or hand-contact animation is claimed.

1. Run `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'`.
2. Use the installed hidden-background Blender launcher with two threads and
   `--python render_sink.py -- ABSOLUTE_NEW_OUTPUT_DIRECTORY`.
   The script uses the unchanged kitchen `render_static.py` exporter and hashes
   every additional source file. Never overwrite a candidate directory.
3. Read the generated proof until complete, then use kitchen `review_fridge.py`
   with the output directory and `Bathroom sink` label to create its review board.
4. Inspect all four originals and game-size samples. Obtain fresh adversarial
   review. Record acceptance or rejection and precise residual limitations.
5. Only accepted batches may enter the atlas. Append their records, preserve
   all previous decoded sprites, and verify actual GPU and played placement.

Accepted static batches from every room share `../static-props.json`. Append
new entries at the end rather than sorting by room. The saved-scene probe is
`check_sink_scene.py`: pass the saved model and a new JSON result path through
the hidden Blender launcher. It checks the basin, pedestal and hardware, then
moves five fittings/supports in memory to prove the relevant assertions fail.
It must reload a clean passing scene and preserve the model hash afterward.

The owner delegated individual asset approval to primary and adversarial review
on 2026-09-17. The folder name `owner-review-pending` is historical, not a request
to pause for approval. Unreviewed candidates remain unaccepted.

Candidate 01 is integrated at indices 1105 through 1108. Source review scored
89/100; GPU review found no blocking placement or facing defect. The existing
wash-hands action completed in the production build with hygiene reaching 100.
See `../../../docs/assets/review-evidence/bathroom/README.md` for commands,
hashes, screenshots and the limits of those checks. Publication is recorded
separately from local acceptance.

## Toilet

`toilet_model.py` builds Porcelain Standard with the same warm ceramic and
camera setup. The seat is down and the lid upright; `closed-*.png` is the
shared exporter's static filename, not a claim that the toilet lid is closed.
Use `render_toilet.py` with a new absolute candidate directory, then generate
the review board and run `check_toilet_scene.py` with the saved model and a
new result JSON path.

Candidate 03 passed primary and adversarial static review at 88/100. Its lid
clears the cistern and both neck sections. The saved-scene check verifies
supporting surfaces and finds points inside both solids at five hinge contacts;
eight deliberate displacements fail, followed by a clean reload and unchanged
model hash. These finite checks do not certify arbitrary geometry or future
animation poses. Candidates 01 and 02 are rejected and retained with reasons.

The exact accepted batch appends records 1109 through 1112. Only the existing
object's sprite name changes. See
`../../../docs/assets/review-evidence/bathroom/toilet.md` for integration and
played evidence. Sitting, clothing, flushing and lid animation are not added.

## Shower

`shower_model.py` builds Rainfall Cubicle with a recessed ceramic tray, two
opaque blue-grey panels and satin-metal fittings. Use `render_shower.py` with
a new candidate directory, then run `check_shower_scene.py` against its saved
model and a new JSON result path. Candidate 01 passed primary and adversarial
source review at 90/100 and appends indices 1113 through 1116.

The checker verifies tray height, drain and trim support, eight sampled
inside-solid contact witnesses and the arm's connections to flange and head.
Seven deliberate displacements fail; a clean reload passes without changing
the model hash. The vertical probe below the head checks tray coverage, not
water direction or spray containment. Broad panel shading and simplified
small fittings remain documented nonblocking limitations.

The existing Take a shower action still completes and raises hygiene. See
`../../../docs/assets/review-evidence/bathroom/shower.md` for source hashes,
runtime images and checks. This static batch adds no showering pose, water,
door or transparent glass. Publication requires separate live verification.

## Stacked laundry

`render_laundry.py` exports the closed washer/dryer using the same camera.
Candidate 02 separates the washer drawer, dial and indicator; candidate 01
remains rejected with its original files and overlapping-control report.
Run `check_laundry_scene.py` through hidden background Blender with the saved
model and a new result JSON path. It checks four feet, 34 sampled attachment
contacts, open door-rim centers and control clearances. Six displaced parts
must fail before a clean reload passes with the same model hash.

Candidate 02 passed primary and adversarial source, GPU and room-relative
review at 90/100. Its four views append indices 1117 through 1120. The original
1,117 records remain unchanged, including the corrected refrigerator. See
`../../../docs/assets/review-evidence/bathroom/laundry.md` for proof hashes,
room screenshots and verification commands. Cycle, Perpetual remains decorative
with no interactions, moving drums, opening doors or connected utilities.

## Bathtub

`render_bathtub.py` uses the separate `render_wide_static.py` exporter. Its
160x176 logical canvas produces 1280x1408 source images at the same world
scale as earlier props. Orthographic camera size follows `max(width,height)`;
the projected origin is approximately [640,984.0035]. Earlier hashed exporters
remain unchanged. The atlas importer permits only the two registered canvas
pairs and preserves source-hash, padding, density and anchor checks.

The runtime already centers a two-tile object's render row on its footprint.
The model therefore stays centered at local Y=0. Candidate 01 incorrectly
added another half-tile offset and failed played-room review. Its original
files, source snapshot and rejection are retained. Candidate 02 removes that
offset without changing geometry shape, game placement or interactions.

Use `review_wide_static.py` for the review board and `check_bathtub_scene.py`
for saved-scene verification. The checker tests the cavity, floor/deck support,
sampled solid contacts and spout placement, then rejects six moved parts.
Only SE is the current 2x1 gameplay placement; other rotations are source
views. This static asset does not add a bathing pose, water or faucet motion.
