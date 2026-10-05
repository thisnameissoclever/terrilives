# Aquarium swimming attempt, 2026-10-05

Method: Blender 4.5.14 LTS, local procedural authoring from the accepted
aquarium and unchanged shared character render rig. No image model, image
prompt, paid request or dependency change was used.

Inputs and exact hashes are retained in each sample's `proof.json`.
`aquarium_swim.motion(frame)` supplies bounded translation and tail flexion
with three independent phases. Eight complete samples have four actual model
rotations each. `scene-check.json` binds evaluated containment, attachment and
lid visibility to the saved model bytes.

Decision: accepted for source and local runtime integration by primary and
independent reviewers. No source retry or rejected render occurred. The loop
is calm station-holding motion with fixed headings, not fish touring the tank.
Primary visual correctness score: 93/100, a subjective review value rather
than a calibrated percentage of mechanical correctness. The independent
reviewer accepted without assigning a numerical score.

The complete local proof and remaining publication boundary are in
`docs/assets/review-evidence/living/aquarium-swimming-2026-10-05.md`.
