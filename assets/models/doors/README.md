# Solid door model

`doors.json` selects the immutable reviewed export. Its `doors.blend` contains the editable oak leaf, hardware on both faces, joined casing, flush threshold, camera and lights. `render_doors.py` constructs that scene using the existing character scene's materials and lighting. It does not modify the character source.

Four orientations each have a fixed frame and nine leaf poses, from 0 to 90 degrees. The logical canvas is 112 by 120 pixels, exported at density 3. The ground origin is (56, 99), with the game's 32:21 ground projection and 38 pixels per height unit. Colour and surface data use the same camera and evaluated geometry.

## Rebuild

Run Blender 4.5 in background mode with two render threads:

```text
blender --background --threads 2 --python-exit-code 1 --python assets/models/doors/render_doors.py -- assets/models/doors/export/NEW
python assets/models/doors/package_depth.py assets/models/doors/export/NEW
python assets/sprites/gen/build.py
```

The Microsoft Store installation uses `blender-launcher.exe` with these same arguments; launch it with a hidden window. Check the new export's `status.json` for `state: complete` and all 40 records before packaging. Export uses Blender's bundled NumPy; local packaging uses NumPy and Pillow. CI consumes the checked exports and needs only Pillow.

The manifest pins the exporter, shared geometry helpers and source scene by SHA-256, plus every colour/depth PNG. Atlas generation validates those hashes and appends the records without changing historical sprite identities. Raw `*-depth.npy` intermediates are ignored; the PNGs, manifest and editable scene are delivery assets.

Manifest input references use forward slashes on every host. The asset tests
interpret these references as portable relative paths and verify their hashes;
native Windows path formatting would fail the Linux publication build.

## Surface depth

Each `Depth.png` encodes model-space game X+Y in red and green: `(R * 256 + G) / 65535 * 4 - 2`. Blue marks only the flush floor threshold. Alpha is opaque data, not colour coverage. The colour sprite supplies coverage. Nearest surface data extends four physical texels beyond the solid for filtered outlines.

The shader places each covered pixel at its model surface. Threshold pixels instead follow the renderer's floor ordering, immediately ahead of the floor tile and behind the casing, leaf and Sims. This distinction matters: assigning a vertical depth plane to a floor strip cuts off feet even when the door panel itself sorts correctly.

Run `python -B -m unittest discover -s assets/sprites/gen -p test_door_assets.py` for coverage, solid edge-on silhouettes, threshold tagging and clean casing joins. `/proofs/door-depth.js` exercises the production WebGPU shader against independent depth brackets in both draw orders, all orientations, all poses and three scales.

The shared `../architecture-depth.json` sets wall and fixed casing depth to 0.14 game units. Casing faces are 0.43 and 0.57 around their existing 0.5 center; the threshold follows those faces. The hinge moves from 0.455 to 0.465, retaining its 0.035 seating offset from the front face. Aperture width and height, slab width, poses, registration, materials and floor-order tagging are unchanged. The manifest records both configured dimensions and actual casing mesh vertex bounds.

Never reuse an export directory. The exporter rejects an existing manifest or status receipt before writing anything. New selected exports require independent source-art acceptance in `review.json`, pinned to their exact manifest SHA-256; `doors.json` enables this requirement. Previous accepted exports and scenes remain intact.
