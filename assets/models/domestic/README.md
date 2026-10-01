# Dishes and cleanup

`dishes.py` builds thin .30-unit ceramic plates, a prep bowl and spoon, and a
served meal. `render.py` exports four facings through the approved Sim camera.
The model is saved in `dishes.blend`; the export receipt verifies the model,
source scripts and rendered pixels before atlas assembly.

`render_cleanup.py` loads the unchanged approved Sim rig and saves
`cleanup.blend`. It renders eight walking samples, four holding samples and
four washing samples in every facing and all three shirt palettes. The plate
is part of the render, so the hands and torso occlude it correctly. Washing
includes a .30-unit step toward the sink and uses a wider registered canvas
to keep the extended arms and plate inside the frame.

Run Blender in background mode with two threads and `--python-exit-code 1`.
After the receipt reports all 192 renders complete, run
`python assets/models/domestic/export_cleanup.py`, then
`python assets/sprites/gen/build.py`. Runtime frames have two texture pixels
per logical pixel. Raw cleanup renders remain local; runtime frames, receipts
and editable models are retained.

`assets/sprites/gen/surface_items.py` projects slots from the actual counter
camera and the current dining table's model geometry and export camera. Legacy
table sprites retain their original support definition. Props continue the owner's
depth field and use the same local light. The renderer fixture is
`web/review/domestic.html`; played evidence and independent visual review are
recorded in `docs/assets/review-evidence/domestic/README.md`.

Run `python -B -m unittest discover -s assets/models/domestic` for complete
clips, palette geometry equality, frame bounds, registration and source-rig
preservation. Run the sprite-generator tests for support margins and the
unchanged earlier atlas prefix.
