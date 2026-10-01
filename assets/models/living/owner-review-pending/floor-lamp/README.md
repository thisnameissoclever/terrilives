# Floor lamp attempts

Both candidates were built locally in Blender 4.5.14 LTS from deterministic
geometry, using the approved Sim's material family and registered camera.
No image-generation model, text prompt or paid service was used. The exact
source-file hashes, saved model hash and ordered render hashes are recorded
in each `proof.json`. Each directory contains separate original PNG views.

1. **Candidate 01: rejected, retained in `rejected/candidate-01`.** Primary and independent visual review found
   the shape and style acceptable, with two minor dark support-tip marks.
   Physical validation then found a degenerate internal wire edge in the
   base mesh, and code review found a continuous mast through the bulb.
   Its source hashes describe the earlier source, not the corrected files.
   The retained scene-check failure is evidence of rejection, not acceptance.
   Subjective correctness score: 80/100; no runtime integration.
2. **Candidate 02: accepted for integration.** Pole-aware mesh construction
   removes the wire edge. The bulb sits above the stand in a socket, with
   a separate surrounding shade support. Thinner recessed strut ends remove
   the stray dark marks. Primary and independent source-art review passed
   all four views and the reduced texture board. The saved-scene checker
   passed 13 closed parts, 15 solid contacts, five clear opening rays,
   seven damaged-scene rejections and three deliberate guard deletions.
   Subjective source correctness score: 96/100. Runtime evidence is kept
   separately in `docs/assets/review-evidence/living/floor-lamp.md` at the
   repository root; source acceptance alone does not prove release.

The scores are reviewer judgments, not measured probabilities or proof that
the model will behave correctly in the game. No candidate is owner-reviewed.
The owner authorized independent review and autonomous asset delivery.
