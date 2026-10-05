# Dining furniture

Continue the accepted offline-model-to-sprite process without changing the
existing furniture's prices, footprints, positions, actions or save identities.
The replacements are the one-tile wooden dining chair and two-tile oak table.
This static-furniture procedure does not establish body fit. The current seated
meal animation and table dishes use the separate contribution workflow in
[`../domestic/README.md`](../domestic/README.md).

`chair_layout.py` defines four feet, continuous rear posts, equal back rails,
seat, aprons and stretchers. Its physical front is local -X. The unchanged
exporter therefore produces SE facing game +Y, NW -Y, SW -X and NE +X, matching
the old chair. Preserve the NE chair at (1,3) and SW chair at (4,3), facing the
table between them. Do not move the lot to conceal a rotated authoring basis.

1. Run `python -B -m unittest discover -s assets/models/dining`.
2. Launch installed Blender hidden and in background mode with two threads,
   `--python-exit-code 1 --python ABSOLUTE/render_chair.py -- NEW_ABSOLUTE_DIR`.
   Require a completed proof, not merely a successful launcher exit.
3. Run `check_chair_scene.py -- ABSOLUTE_MODEL NEW_ABSOLUTE_RESULT` the same way.
   It examines saved evaluated geometry, 22 solid contacts, four grounded feet,
   equal rails and physical facing vectors. Deliberately broken copies must fail;
   the clean saved scene must reload with unchanged bytes.
4. Use `assets/models/kitchen/review_fridge.py DIR 'Dining chair'` for the board.
   Inspect all four originals and downsampled texture views, then obtain an
   independent visual review. Record provider/method, exact source hashes,
   decision, score and limitations beside each candidate. Retain rejected sets.
5. Append accepted views to the tail catalog `../static-props-03.json`. Pin the
   sorted-key compact JSON proof hash. Never insert before earlier sprites.
6. Check actual GPU views, picking, both saved table-facing chairs, Build
   rotation and a save round trip. Preserve every prior decoded sprite.

This is deterministic Blender authoring, not an image-model request. The
accepted Sim supplies toon materials, light and camera registration. No paid
provider, new dependency, image prompt or pixel repair is involved.

## Dining table

`table_layout.py` defines four equal grounded legs, four ordinary aprons and
one rounded top. Its long axis is local Y, unlike the desk's local X. The shared
90-degree SE export makes it span game X, preserving the table's existing SE
base and 2x1 footprint. SW/NE use 1x2. Keep the model centered at (0,0); the
runtime already centers the object within its rotated footprint.

Use `render_table.py` with a new absolute candidate directory. It reuses the
unchanged wide exporter: 1280x1408 source images, 320x352 textures and a
160x176 logical canvas. Run `check_table_scene.py` against the saved model and
a new absolute result path. Require 16 evaluated-solid joins, four floor
contacts, equal leg dimensions, correct rotated spans and eight rejected
damaged copies. `assets/models/bathroom/review_wide_static.py` produces the
four-facing board without repairing pixels.

`web/proofs/dining-table.js` is the historical static-table graphics proof.
The table-only replacement did not add seated eating or table-resting dishes;
the later domestic contribution workflow supplies those current features.
Test both default placement and save/load after all
four rotations. Preserve all earlier atlas records and decoded pixels even
when the existing packer selects a wider atlas.
