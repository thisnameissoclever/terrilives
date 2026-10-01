# Dining chair candidate 01

Source art accepted by primary and independent reviewers on 2026-09-30.
Subjective correctness score: 93/100. No rejected earlier candidate in this group.

Method: Blender 4.5.14 LTS deterministic geometry through the accepted Sim's toon
materials, light and registered camera. The exact Blender version is in
`proof.json`; that journal also records all source paths, hashes, four output
hashes, saved-model hash, camera matrix and canvas settings. No image model,
text prompt, paid provider or per-view paint correction was used. Spend: $0.

Design: warm wooden armless chair with four legs, three equal horizontal back
rails, rounded seat and side stretchers. Preserve the old physical facing
directions and one-tile footprint. `chair_layout.py` and `chair_model.py`,
identified by their journaled hashes, are the reproducible construction input.

Both reviewers inspected all four separate 768x960 RGBA originals and the
192x240 texture samples. Joints and occlusion are coherent; edges have no visible
tearing, furniture parts do not float, and the palette fits accepted furniture.
Rail gaps read mostly as dark lines at small scale, a nonblocking readability
limit rather than inconsistent geometry. Four layout tests pass. The saved
scene confirms 22 solid contacts, four floor contacts, physical fronts in every
view and five deliberately broken copies rejected without modifying the model.

Runtime review also accepted at 93/100 after inspecting the actual GPU views
and both chairs beside the existing table. Visible-back picking, all four Build
rotations and an unchanged-position confirmation passed without changing the
world hash. See `docs/assets/review-evidence/dining/chair.md` for retained images,
exact checks and evidence boundaries. Permitted next action: publish the tested
static-art replacement. Seated animation remains unproven.
