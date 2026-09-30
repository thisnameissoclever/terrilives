# Office chair candidate 01: rejected

Final disposition on 2026-09-30: rejected, REAR-SHELL-BREAKTHROUGH. Subjective
correctness: 88/100. The independent reviewer's provisional 90/100 acceptance
was withdrawn during closer inspection. This candidate must not be shipped.

Provider/method: local Blender 4.5.14 LTS, procedural editable model; no image
model, generation prompt or paid request. Brief: an armless slate upholstered
desk chair, charcoal shell, five-spoke paired-caster base, smooth outlines,
same world scale and toon materials as the accepted desk, bike and Sim.
One physical model supplies all four registered rotations. The exact scripts,
rig, camera inputs and output hashes are in `proof.json`.

The NE view has a faint mark around source pixel (309,580). The hidden back
support reaches Y=0.29485 while the shell ends at Y=0.29. The support protrudes
through the rear face. The initial overlap checks proved attachment but did
not prove concealment. A new pure-layout test fails on these original values;
the saved-scene checker now checks rear clearance too.

All four original 768x960 RGBA images, review board and original layout/model
scripts are tracked here. The rejected editable model remains here locally,
ignored like earlier rejected furniture models. `scene-check.json` is the historical
attachment-only pass, not acceptance of the visible rear face. The next candidate
recesses the support without changing the shell, seat, materials or camera.
