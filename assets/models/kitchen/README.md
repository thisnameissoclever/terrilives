# Kitchen asset review

Continue the accepted offline Blender-to-sprite workflow, kitchen first. The
first object is the existing refrigerator, not a new gameplay object. No runtime
mapping, footprint, interaction, save format or accepted Sim is changed here.

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
   and style. Use fresh independent visual review before owner review.
6. Record defects and scores with each candidate. Retain rejected originals.
   Nothing becomes production art until owner approval and played verification.

The current group is `owner-review-pending/refrigerator/candidate-02/`.
It contains four original transparent PNGs, the editable Blender scene, the
hash journal and the labelled review board. Door pivots are prepared and
scene transforms checked at 0,45,90 degrees. This is not a completed door
animation, Sim contact check, collision proof or runtime integration.

Candidate 01 is superseded, not approved. Its originals and rejection notes
remain in its own folder. Candidate 02 passed primary and independent visual
review; owner approval is still pending. See its `review.md` for limitations.
