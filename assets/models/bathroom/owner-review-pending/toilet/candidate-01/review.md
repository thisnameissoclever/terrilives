# Toilet candidate 01: rejected

Primary review rejected the four-facing batch before integration. The raised
lid intersects the cistern and its cap. In the front views, the tank hides
most of the lid while a portion protrudes through its top. This is physically
incorrect, not harmless occlusion. Subjective correctness: 55/100.

Method: scripted Blender geometry, accepted Sim toon materials and registered
camera. No image-generation provider, prompt or paid request was used.
`source-toilet_model.py` preserves the exact model-building source for this
attempt; its hash matches the corresponding input in `proof.json`.

Next action: move the cistern behind the lid, align the hinge with the lid's
rear edge, extend the supporting ceramic neck, then export a new candidate.
Retain these images, model and proof unchanged. A saved-scene check must reject
this batch for insufficient lid-to-cistern clearance before the next one is
accepted.
