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
