# Kitchen asset review

Continue the accepted offline Blender-to-sprite workflow, kitchen first. The
first objects are the existing refrigerator and stove, not new gameplay objects.
Only their sprite mappings change; footprints, interactions, save format and accepted Sims
remain unchanged.

The refrigerator keeps the current cool-grey enamel, muted brass handles and
upper freezer. One physical model supplies all four facings. It has a hollow
cabinet, shelves, independent right-side hinge parents and a rear service panel.
The hidden accepted Sim scene supplies camera, toon materials and lighting.
It is a style reference, not part of the furniture's visible geometry.

## Repeatable review

1. Run `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'`.
2. Launch installed Blender in hidden background mode with `--threads 2
   --python-exit-code 1 --python ABSOLUTE_PATH/render_fridge.py --
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

The current group is `owner-review-pending/refrigerator/candidate-02/`.
It contains four original transparent PNGs, the editable Blender scene, the
hash journal and the labelled review board. Door pivots are prepared and
scene transforms checked at 0,45,90 degrees. Closed renders alone are not a
completed door animation, Sim contact check, collision proof or runtime test.
Subsequent static integration evidence is recorded separately in
`../../../docs/assets/review-evidence/kitchen/README.md`.

Candidate 01 is superseded, not approved. Its originals and rejection notes
remain in its own folder. Candidate 02 passed primary and independent visual
review and is accepted under the delegated review policy. See its `review.md`
for limitations. The historical `owner-review-pending` folder name is retained
to avoid breaking source paths and review links; it is not a blocking gate.

## Static runtime integration

`catalog.json` lists accepted static batches in append order. The atlas builder
loads them through `assets/sprites/gen/offline_props.py`, validates image hashes,
true rotation labels, complete coverage, registration and padding, then
downsamples the source to 192x240. No per-facing crop, recentering or mirroring
is allowed. New sprites follow every existing record; previous art and its
registration tables are protected by prefix tests. Map only the relevant
object's sprite name after a successful build. The catalog pins the SHA256 of
the proof serialized as sorted-key, compact JSON. This preserves the exact
reviewed camera and dependencies without making Git line endings significant.
Changed proofs require another review; changed PNG bytes fail independently.
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
