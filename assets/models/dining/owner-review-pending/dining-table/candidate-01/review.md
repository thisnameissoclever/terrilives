# Dining table candidate 01

Source accepted on 2026-09-30 after primary and independent visual review.
Both reviews inspected the four original images and reduced texture board.
Independent score: 93/100, a subjective assessment, not a measured probability.
Runtime acceptance is recorded separately in the release evidence.

Method: deterministic Blender 4.5.14 LTS authoring, using the approved Sim's
toon materials, lighting and registered camera. No image-model prompt, paid
request, pixel repair or image mirroring was used. Geometry and exact render
input hashes are retained in `proof.json`; model and solid-contact evidence
are in `scene-check-strict.json`. The earlier `scene-check.json` is retained
to show the initial six-case check before adversarial review strengthened it.

1. Smooth, continuous edges and matching warm-oak materials passed review.
2. Four legs support one top through four aprons. The far leg is correctly
   concealed by the top at this camera angle. Eight deliberately damaged copies
   failed validation; the saved clean model remained byte-identical.
3. All four images come from real rotations of the centered long-Y model.
   SE/NW cover 2x1 tiles; SW/NE cover 1x2. Similar opposite views are expected
   for this symmetric table.
4. Aprons are mostly hidden by the top. No attempt was made to expose them
   artificially. Seated animation and table-resting dishes are not established
   by this static replacement.

Saved model SHA-256:
`5fa0a9091151a7ab7570e8da7ba5307ea52dcd40b539418c239af921f15c1e99`.
Canonical sorted-key proof SHA-256:
`aebd743ba6415a60ad04948d1a6d1ebd07b9cba39ad73d8dc6221d51fc986b33`.
