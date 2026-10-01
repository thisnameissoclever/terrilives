# Potted plant attempts

Keep each four-view batch together. No paid provider or image-generation model
was used. These are background Blender renders of the checked-in editable model,
using the approved Sim's camera, lights and toon materials. `proof.json` records
the exact Blender version, input hashes, camera, settings and output hashes.

| Attempt | Method and brief | Result | Reason and next action |
| --- | --- | --- | --- |
| 01 | `render_plant.py`, nine curved broad leaves on connected stems, square terracotta pot | Rejected | Soil was a rectangular block floating 0.017 above the interior floor. Retained under `rejected/candidate-01` with original model/layout scripts and all four PNGs. Replace the soil with a fitted tapered volume. |
| 02 | Same model and render setup, fitted soil reaching the floor and walls | Source accepted, 93/100 subjective independent score | All four originals have consistent structure and smooth contours. Thin central branches merge at small sizes, but the plant remains legible. See runtime acceptance record for the separate game checks. |

Candidate 01's first checker run failed because the new connectivity probe
needed a Blender vertex lookup table. The corrected checker then caught the
floating soil. Candidate 02's checks 01 and 02 passed; check 03 adds the
independent reviewer's soil-containment guard and a sideways-shift rejection.
These checker revisions did not alter candidate 02's artwork.

Scores are reviewer judgments, not calibrated percentages of correctness.
Model SHA256: `566bcf2d16e19ba14a6760bc125c41bd5299c98b7f0eba7c94d86c1a83a0f986`.
Canonical render proof: `a85664527ed38b04d809fef1d7c06e257b94147d1eb805e7e9e2ab0c28828f25`.
