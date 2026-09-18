# Toilet candidate 02: rejected

Primary and adversarial review rejected this batch. Moving the cistern fixed
the first overlap, but the rear ceramic neck still intersects the lower part
of the raised lid. A pale rectangular block crosses the lid in both front
views and hides the hinge. It is not acceptable for integration.
Independent subjective correctness score: 76/100.

Method: scripted Blender geometry with the accepted toon material and camera.
No image-generation provider or paid request was used. All four output hashes,
saved model hash and eight source hashes were verified. The exact model source
is retained as `source-toilet_model.py`.

`scene-check.json` passed its limited checks: cistern clearance, cavity,
seat, bumpers, button and floor. It did not test the neck and is not acceptance
evidence. The added `neck-clearance-check.json` fails on the neck overlap.
Keep both results to show why the earlier passing check was insufficient.

Next action: keep the lower neck below the lid, support the tank from behind
the lid with a separate joined ceramic section, and verify separation from
both pieces before the next visual review. Preserve this batch unchanged.
