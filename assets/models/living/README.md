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
