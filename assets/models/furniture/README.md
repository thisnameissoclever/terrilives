# Furniture authoring checkpoint

Current visual candidate: `review/candidate-02/`. Initial independent visual
review passed on 2026-09-10; owner acceptance and runtime integration are open.
These files are not yet used by the live game.

`preview.py` opens the existing accepted Sim rig, builds editable furniture
with `build_parts.py`, and renders actual SE/NW/SW/NE rotations. It preserves
the source rig on disk. The per-object authoring scenes include the Sim as a
contact reference, not as furniture geometry to bake into the final object.
`geometry.py` defines the physical crank, grips and towel section independently
of Blender. No external generation service or new dependency is used.

Run the installed Blender launcher with an absolute path to `preview.py`,
`--background --threads 2 --python-exit-code 1`, and a hidden process window.
Wait for `review/status.json` to report `complete`, then run:

```powershell
python -B assets/models/furniture/review_images.py
python -B -m unittest discover -s assets/models/furniture -p test_*.py
python -B assets/models/furniture/check_mutations.py
```

Review sheets use the high-resolution rendered pixels without geometry
retouching. The density board downsamples the same source to 1x, 2x and 4x
logical resolution and enlarges each to the same displayed size. It illustrates
detail loss; it is not a GPU screenshot or a benchmark. The next export design
must separate physical texture dimensions from logical sprite dimensions.

## Review result

The primary and independent reviewers inspected all four views. Candidate 01
was rejected for driven eye outlines in empty renders and a towel crossing the
handle bend. The rejected images and explanation remain in its directory;
large rejected scene snapshots remain local and ignored.

Candidate 02 removes those issues. Remaining polish: abrupt chair seam endings,
rounded upholstery protrusions above the rear panel, and rigid-looking towel
tails. These do not block initial design feedback. The approved character is
unchanged. Source hashes and output hashes are recorded in `proof.json`.
Subjective initial-checkpoint correctness: bike 88/100, chair 86/100. These
scores describe the sampled visual result only, not animation completeness,
runtime correctness or owner approval. Both reviewers passed the initial
checkpoint with the named polish concerns; neither approved the full milestone.

Only one occupied pose per facing is shown. A full crank cycle, all reading
samples, paired runtime layers, native game scale, actual adjacent-wall
clearance and played acceptance remain unverified. Do not describe this
checkpoint as the completed bike-and-chair milestone.

## Mechanical evidence

Eight furniture tests pass. Four deliberate in-memory mutations fail their
corresponding tests: mirrored rotation, same-phase cranks, missing-view guard
removal and hash guard removal. The script restores original bindings and
confirms production source bytes are unchanged, then reruns the eight tests.
The review-sheet builder confirms all 16 expected source images are nonempty,
padded and byte-matched to their manifest. These tests do not establish style
or physical contact; those require visual and scene-based review.
