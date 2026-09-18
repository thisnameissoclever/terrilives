# Kitchen asset review

Continue the accepted offline Blender-to-sprite workflow, kitchen first. The
current objects are the existing refrigerator, stove, counter and kitchen sink,
not new gameplay objects.
Their sprite mappings and the refrigerator's room-facing placement change;
footprints, interactions, save format and accepted Sims remain unchanged.

The refrigerator keeps the current cool-grey enamel, muted brass handles and
upper freezer. One physical model supplies all four facings. It has a hollow
cabinet, shelves, independent right-side hinge parents and a rear service panel.
The hidden accepted Sim scene supplies camera, toon materials and lighting.
It is a style reference, not part of the furniture's visible geometry.

## Repeatable review

1. Run `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'`.
2. Launch installed Blender in hidden background mode with `--threads 2
   --python-exit-code 1 --python ABSOLUTE_PATH/render_fridge_room_fit.py --
   ABSOLUTE_NEW_OUTPUT_DIRECTORY`. Never render into an existing candidate.
3. Read `proof.json` until it reports complete. Launcher exit alone does not
   prove that the background render finished. The proof hashes the source rig,
   scripts, registration file, saved model and each output. Inputs must remain
   unchanged throughout the batch.
4. Run `python -B assets/models/kitchen/review_fridge.py OUTPUT_DIRECTORY`.
   This verifies all four distinct facings, source hashes, padding and 768x960
   resolution before laying out the review board. It does not repair geometry.
5. Inspect the four original images and the 2x texture-size samples. Review
   structure, actual front/back rotation, attachment consistency, line quality
   and style. Use fresh independent visual review before accepting a candidate.
6. Record defects and scores with each candidate. Retain rejected originals.
   On 2026-09-17 the owner delegated per-object visual acceptance to the primary
   and adversarial reviewers. Do not wait for individual owner approvals.
   Runtime integration still requires registration and played verification.

The accepted refrigerator group is `owner-review-pending/refrigerator/candidate-03/`.
It contains four original transparent PNGs, the editable Blender scene, the
hash journal and the labelled review board. Door pivots are prepared and
scene transforms checked at 0,45,90 degrees. Closed renders alone are not a
completed door animation, Sim contact check, collision proof or runtime test.
Subsequent static integration evidence is recorded separately in
`../../../docs/assets/review-evidence/kitchen/README.md`.

Candidates 01 and 02 are superseded. Candidate 02 passed the earlier review,
but the owner correctly identified wrong lot-facing and undersized room fit.
Candidate 03 is uniformly 20% larger and uses the SW lot placement. Generate it
with `render_fridge_room_fit.py`, then run `check_fridge_room_fit.py` against
the saved model and a new result path. This preserves the original authoring
source while checking scaled hinges and physical room dimensions. See
`../../../docs/assets/review-evidence/kitchen/fridge-room-fit.md` for room proof.
The historical `owner-review-pending` folder name is retained
to avoid breaking source paths and review links; it is not a blocking gate.

## Static runtime integration

`../atlas-batches.json` defines the append order across static and animated
batches. `../static-props.json` is the frozen first static batch, followed by
the bunk export, then `../static-props-02.json`. Append new static objects only
to the last static batch; after another animated batch, start a new static
catalog. Never regroup entries by room or insert into a frozen batch: adding a
kitchen object later must not renumber an accepted bathroom or bunk sprite. The atlas builder
loads them through `assets/sprites/gen/offline_props.py`, validates image hashes,
true rotation labels, complete coverage, registration and padding, then
downsamples small sources to 192x240 and wide sources to 320x352. No per-facing crop, recentering or mirroring
is allowed. New sprites follow every existing record; previous art and its
registration tables are protected by prefix tests. Map only the relevant
object's sprite name after a successful build. The catalog pins the SHA256 of
the proof serialized as sorted-key, compact JSON. This preserves the exact
reviewed camera and dependencies without making Git line endings significant.
Changed proofs require another review; changed PNG bytes fail independently.
The owner-requested refrigerator correction deliberately replaces its four
existing records. Its complement digest preserves every other decoded image
through record 1104; the older 1089-record baseline still passes unchanged.
Run `python -B assets/sprites/gen/check_prop_mutations.py` to prove the loader
tests detect mirroring, wrong facing order, missing tile compensation, unbound
review metadata and unchecked source pixels.

The runtime anchor is source world-origin pixels divided by eight, plus the
21-pixel tile south-corner offset on Y. It is not the bare source origin. The
frame offset and shader projection cancel that offset to keep the object on
its tile. Preserve this measurement when exporting more kitchen models.

## Stove

`render_stove.py` follows the same hidden-background launch and new-directory
rules. Review its output with `review_fridge.py OUTPUT_DIRECTORY Stove`; the
optional label changes headings only. Candidate 01 remains with rejection
notes. Candidate 02 passed primary and adversarial review at 90/100 and is
listed in the static catalog. It keeps the existing hob role and counter-run
height. The hollow oven and bottom hinge are preparation for future animation,
not an exported opening clip.

Run `check_stove_scene.py` through the installed Blender launcher, passing the
saved `.blend` path and a new JSON result path after `--`. This checks the saved
geometry, not source constants: coil support, knob-indicator contact and door
parenting. The retained results show candidate 01 failing and candidate 02
passing. Use the result file to establish completion; the Windows Store
launcher does not reliably forward redirected console output. Direct access
to the packaged executable was denied; no permissions were changed.

The accepted stove's four runtime records follow the refrigerator. Both the
source review and played cooking evidence are retained in the kitchen evidence
directory. Tiny burner-rim contour ticks remain visible at full source size;
the independent reviewer judged them non-blocking in the downsampled sprites.

## Counter and kitchen sink

The current additions are `owner-review-pending/counter/candidate-01/` and
`owner-review-pending/kitchen-sink/candidate-01/`. Primary and adversarial
review accepted them at subjective scores of 92/100 and 90/100 respectively.
Each directory retains its own four original images, model, hashes, review
board and notes. Their worktops share the stove's Z=0.86 height. The sink's
worktop has a real opening over a recessed Z=0.63 basin floor.

Use the installed hidden-background Blender launcher with
`--python ABSOLUTE_PATH/render_counter.py -- counter ABSOLUTE_NEW_OUTPUT_DIRECTORY`
or replace `counter` with `sink`. `render_static.py` provides the shared camera,
source hashing and four-rotation export. The earlier refrigerator and stove
exporters remain unchanged so their recorded source hashes retain meaning.

Run `check_counter_scene.py` through Blender with saved-model/result-path pairs
after `--`. It inspects evaluated geometry, including the bevel and basin
thickness. Run `probe_counter_scene.py` with the saved sink path and a new result
JSON path. It must reject seven corruptions, reload a clean scene and verify
the original model hash is unchanged. These probes never save the corruptions.
Use the JSON state, not the Windows launcher exit, to establish completion.

The source review notes retain the drain's near-rim projection and broad bowl
shading as non-blocking limitations. Closed cabinet doors are static. These
assets do not introduce dishwashing motion, carried dishes or surface slots.
Played integration evidence is recorded separately in the kitchen evidence
directory; model acceptance alone does not prove runtime behavior.
