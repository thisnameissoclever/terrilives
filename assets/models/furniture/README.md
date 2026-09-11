# Furniture authoring checkpoint

The owner approved `review/candidate-02/` on 2026-09-10. The character's
appearance remains unchanged. Animation and runtime integration are complete:
the exercise bike and reading chair use these exports in all four facings.
Live publication is verified separately through the successful main CI and
GitHub Pages deployment, not inferred from this authoring checkpoint.

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
detail loss; it is not a GPU screenshot or a benchmark. Runtime exports use
192x240 physical pixels on the unchanged 96x120 logical canvas (density 2).

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

The original candidate shows one occupied pose per facing. Subsequent cycle
review is in `review/animation-02/`: eight cycling poses and four reading poses
for each facing. Primary and independent visual review passed those sampled
views. Reading motion is subtle; it is not a page-turn animation. Native game
scale, actual adjacent-wall clearance and played acceptance remain open.
Do not describe the offline review as the completed bike-and-chair milestone.

## Reproducible animation export

1. Preserve the approved source `../sims/sim-01/sim-01-rigged.blend`. Run
   `validate_contact.py` in hidden background Blender. It traces actual shoe
   meshes against the bike through 16 phases and checks both soles against
   the pedal tops. The wider pedal spindles and measured ankle height fix
   collisions missed by the first static review.
2. Run `render_animation_batch.py` in background Blender, then
   `python -B assets/models/furniture/review_animation.py assets/models/furniture/review/animation-02`.
   Inspect all 48 poses before production export. Rejected `animation-01`
   remains separately labelled; do not use it as an export source.
3. For a new batch, run `render_provenance.py` in background Blender with
   `-- ABSOLUTE_NEW_BATCH_DIRECTORY` after Blender's script arguments. It
   wraps `render_contributions.py` and hashes the complete Python/reference
   dependency set before and after rendering. Its journal records
   source/script hashes and each rendered PNG. It resumes only an unchanged
   batch. Do not edit signed inputs while rendering. Changed
   geometry requires a new batch, not a mixture of old and new frames.
4. Wait for `review/contributions-01/status.json` to say `complete`, then run
   `python -B assets/models/furniture/export_contributions.py`. There are 584
   source passes: eight empty views and 144 pose/palette groups, each with a
   full-scene reference, visible Sim contribution, visible furniture
   contribution and shared outline. A partial `--check-ready` run validates
   finished groups only and cannot publish a production manifest.
   For a later batch, pass `--input ABSOLUTE_BATCH_DIRECTORY`; use `--output`
   to review its export separately before replacing the accepted manifest.
5. The exporter validates provenance, complete coverage, palette-stable
   silhouettes and reconstruction against the independent full-scene image.
   Separate display-transformed passes differ slightly at antialiased edges;
   the comparison is bounded, not byte-exact. The source remains 768x960;
   runtime layers are 192x240 with one shared anchor. Identical exported
   contributions share content-addressed files.
6. Append the manifest through `assets/sprites/gen/build.py`, rebuild WASM,
   and run the Python, Rust and web checks. Verify actual GPU sampling and
   played interaction before publishing. The shader adds the two visible
   premultiplied contributions, overlays the shared outline once, and only
   then applies the alpha test. Ordinary alpha-over of the two base layers
   would create seams where their coverage meets.

All palettes retain the same rig, camera and physical attachments. Only the
approved shirt materials change. At runtime the exact active target ID binds
the rider to its furniture; nearby objects are never guessed from distance.
Cycling plays source phases 0,7,6,5,4,3,2,1 so the upper pedal moves toward the
handlebars. Reading retains source order 0,1,2,3. Phase zero remains the resting
and reduced-motion pose; reversing playback does not change any PNG or index.

The first completed batch predates the full dependency wrapper. Its original
five-script journal is preserved. `dependency-proof.json` separately records
post-render hashes and verifies the additional Sim inputs against their Git
revision. This proves present source agreement, not the state of those inputs
throughout the earlier render. Do not present it as generation-time evidence.

## Mechanical evidence

At the original candidate checkpoint, eight furniture tests passed. Four deliberate in-memory mutations failed their
corresponding tests: mirrored rotation, same-phase cranks, missing-view guard
removal and hash guard removal. The script restores original bindings and
confirms production source bytes are unchanged, then reruns the complete suite.
The review-sheet builder confirms all 16 expected source images are nonempty,
padded and byte-matched to their manifest. These tests do not establish style
or physical contact; those require visual and scene-based review.
