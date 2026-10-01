# Living-room furniture

The long sofa uses the accepted offline-model-to-sprite workflow. The model
is an authoring source, not a live 3D asset. Preserve the object's identity,
2x1 footprint, saved coordinates, price, three interaction slots and actions.

`sofa_layout.py` defines four feet, a connected upholstered frame, two arms,
three equal seat cushions and three equal back cushions. Local Y is the long
axis; local -X is the physical front. The unchanged wide exporter maps that
to SE facing game +Y, NW -Y, SW -X and NE +X. The previous procedural sofa
duplicated opposing views; preserve its shipped SE arrangement, not those
incorrect NW/SW pictures. Keep the origin centered because the runtime already
centers the rotated footprint.

1. Run `python -B -m unittest discover -s assets/models/living`.
2. Launch installed Blender hidden with `--background --threads 2
   --python-exit-code 1 --python ABSOLUTE/render_sofa.py -- NEW_ABSOLUTE_DIR`.
   Wait for `proof.json` to report complete. The unchanged accepted Sim supplies
   the toon materials, light and camera. No paid request or image prompt is used.
3. Run `check_sofa_scene.py -- ABSOLUTE_MODEL NEW_ABSOLUTE_RESULT` in background
   Blender. Require 18 evaluated-solid contacts, four grounded feet, exact part
   dimensions and centers, expected rotated spans and ten rejected damaged
   copies. Reload the clean source and verify its bytes remain unchanged.
4. Run `assets/models/bathroom/review_wide_static.py DIR 'Long sofa'`. Inspect
   all four 1280x1408 originals and the reduced 320x352 texture views. Retain
   candidate files and decisions separately, including rejected results.
5. Obtain independent visual review, then append the accepted proof to the tail
   of `../static-props-03.json`. Preserve every older atlas record and pixel crop.
6. Rebuild WASM and test the actual GPU, all four placements, save/load, picking,
   colourways, Build preview and played room. `web/proofs/long-sofa.js` exercises
   those frame writers and the existing generic-use action.

The sofa has no occupied overlay or body socket. Its current `Lie down` action
uses a standing generic-use pose. Static geometry acceptance proves neither
reclining nor contact with a Sim on any cushion. That animation needs its own
multi-user interaction design and contact review.

See `../../../docs/assets/review-evidence/living/sofa.md` for runtime evidence
and the explicit limitations of candidate 01.

## Television and radio

`media_layout.py` defines the two one-tile cabinets. Their front is local -Y,
unlike the sofa's -X. The unchanged standard exporter maps that front to game
SE +X, SW +Y, NW -X and NE -Y. Preserve the shipped positions and saved facings.

1. Run the same living-model unit suite above.
2. Run hidden background Blender with `render_media.py -- television NEW_DIR`
   or `render_media.py -- radio NEW_DIR`, using absolute paths. Each candidate
   retains four 768x960 RGBA originals, the editable model and hashed proof.
3. Run `check_media_scene.py -- KIND MODEL NEW_RESULT`. Require four grounded
   feet, cabinet-to-foot support, cycle-free support paths, actual evaluated
   contact points, exact centers/dimensions and one-tile clearance. Seven
   damaged copies per model must fail for their intended reasons. Deleting the
   ground or contact guard must break that rejection proof. The clean source
   must reload successfully and retain identical bytes.
4. Run `../kitchen/review_fridge.py DIR LABEL` for the standard-canvas board.
   It only lays out/resamples originals; it does not repair pixels. Require
   primary and independent review before adding either proof to the catalog.
5. Append the four views of each object. The SE name has no suffix. Update the
   TV prefix in `web/src/render/lighting.ts` together with the content mapping;
   a new sprite does not automatically inherit the old sprite's lighting.
6. Run `/proofs/living-media.html` on the development server and call
   `livingMediaProof()` from its module for the actual WASM/GPU board. Keep that
   proof in its own document. Replacing the live game's DOM breaks its running
   UI. Separately test production Build commits, picking and played actions.

The TV's existing light pool and whole-sprite emissive strength remain always
on. The radio emits no light, but nearby lights can illuminate it. Neither
object has media audio, an animated screen, a power state or seated-use art.
See `../../../docs/assets/review-evidence/living/media.md` for evidence and
the unchanged living-room arrangement limitation.

## Low-backed armchair

The armchair is separate from the tall reading chair. Its local front is -X;
the centered seat remains SW in content, the action remains Sit (wire value 8),
and the existing rig supplies four samples. Rotating the body 90 degrees less
than the chair root aligns their different authored fronts. Do not reuse the
book-reading body or retain the old procedural armchair foreground over the
new occupied composition.

1. Run the living-model unit suite. `armchair_layout.py` pins four grounded
   feet and a connected, low-backed frame. The recessed front clears the
   unchanged seated trousers; cushion top is 0.404 model units.
2. Run hidden background Blender with `render_armchair.py -- NEW_ABSOLUTE_DIR`.
   Require four complete 768x960 RGBA views and a byte-bound editable model.
3. Run `preview_armchair.py -- ABSOLUTE_DIR` for all sixteen green occupied
   source views. `review_armchair.py DIR` arranges the twenty originals without
   repainting them. Require primary and independent source-art review.
4. Run `check_armchair_scene.py -- ABSOLUTE_MODEL NEW_ABSOLUTE_RESULT` in
   background Blender. Require all four samples, every visible body part,
   surface-crossing and containment checks, twelve structural contacts, four
   grounded chair feet and correctly attributed damaged-scene rejections.
5. Hip proximity has two separate limits: closest gap 0..0.003, and a wider
   near-support neighborhood within 0.01 model units. The latter needs width,
   depth and positive hull area, not merely diagonal point extents. This is
   visual support for a rounded rigid hip, not cloth or cushion simulation.
   No body/chair penetration is allowed. The unchanged shoe soles sit about
   0.01915 above the model floor; do not report exact planted-foot contact.
6. Run `render_armchair_contributions.py -- ABSOLUTE_MODEL NEW_ABSOLUTE_DIR`.
   Require 196 originals: four empty views and 48 occupied groups, each with
   full-scene, body, furniture and outline passes. Three shirt palettes must
   retain identical evaluated contact and alpha coverage. Resume only with
   identical source hashes and Blender build.
7. Run `export_armchair.py RAW_DIR NEW_EXPORT_DIR`. Fully decode every original
   and compare all 48 reconstructed composites with their full-scene renders
   using the established error limits. Encode at 192x240, with the existing
   96x120 logical canvas and registered anchor. Runtime acceptance remains a
   separate step: append-only atlas integration, all facing/color/action
   states, actual GPU composition, picking, save/load and played-room review.

8. `armchair-reviewed.json` binds the accepted source, contact journal, raw
   receipt, comparison and export. The atlas imports it through
   `offline_armchair.py`, after all earlier sprites. Run the full original-file
   verification locally; clean builds validate retained evidence and exports
   without requiring ignored originals or Blender.
9. Run `armchairProof()` from `web/proofs/armchair.js` in the isolated
   `web/proofs/index.html` document, then play the production build separately.
   Require target-bound Sit, four facing commits, all shirts and samples,
   pause/reduced-motion/save/cancel/picking checks, and independent review.

Candidate 01 is rejected for arm, trouser and hip intersections. Candidate 02
fixes the arm/base fit but still intersects the hips. Candidate 03 has passed
source, contact, contribution, GPU and played review. See
`../../../docs/assets/review-evidence/living/armchair.md`; local acceptance does
not itself prove a source merge or public deployment.

## Floor lamp

`lamp_layout.py` defines a cream, open-ended shade, metal base and stem,
socket, bulb and independent shade support. `lamp_model.py` revolves the
closed profiles into smooth solids. Axis poles use a single vertex; never
collapse a whole ring into an internal wire edge. The stem must end below
the bulb, with the shade supported around it rather than through it.

1. Run the living-model unit suite above, then hidden background Blender
   with `render_lamp.py -- NEW_ABSOLUTE_DIR`.
2. Run `check_lamp_scene.py -- ABSOLUTE_MODEL NEW_ABSOLUTE_RESULT`. Require
   closed meshes, a grounded base, 15 evaluated-solid contacts, a clear
   shade opening and stand/bulb clearance. Damaged scenes and deliberate
   deleted checks must fail for the recorded reasons.
3. Run `../kitchen/review_fridge.py DIR 'Floor lamp'`, inspect all originals
   and the reduced board, and obtain independent visual review.
4. Append to `../static-props-04.json`, which loads after the occupied
   armchair. Adding this asset to an earlier catalogue would move existing
   sprite indices. Preserve the old procedural lamp records as well.
5. Update the floor lamp's content sprite and the lighting prefix together.
   Its existing whole-sprite emissive strength and room pool remain unchanged.
   No power state, new light emitter or interaction is introduced.
6. Run `floorLampProof()` from `web/proofs/floor-lamp.js` in the isolated
   proof document. Separately check the production Build controls, paused
   save equality after four rotations, room-scale appearance and natural
   simulation playback. Close owned contexts in finally blocks.

Candidate 01 is rejected for invalid mesh topology and a mast through the
bulb. Candidate 02 passes source-art and solid-contact review. See
`../../../docs/assets/review-evidence/living/floor-lamp.md` for runtime
evidence and the limits of its acceptance.
