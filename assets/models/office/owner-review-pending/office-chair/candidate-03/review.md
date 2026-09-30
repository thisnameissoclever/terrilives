# Office chair candidate 03: accepted source art

Accepted on 2026-09-30 by primary and independent review at subjective 92/100.
Method: local Blender 4.5.14 LTS, procedural editable geometry with the accepted
Sim camera and toon materials. No image model, prompt or paid request.
The brief remains an armless slate upholstered chair with a charcoal shell,
five-spoke paired-caster base and smooth contours. One model supplies four
registered rotations; `proof.json` binds all inputs, originals and saved model.

Candidate 01 broke through its rear shell. Candidate 02 fixed that defect but
its NW view faced sideways to the desk. Both are rejected and retained with
originals, source snapshots and reasons. This candidate bakes a -90 degree
turn into every part. It preserves the existing physical meaning of SE/NW/SW/NE
without changing saved facing codes, lot placement or the shared exporter.

All four originals and the review board passed inspection. The saved-scene
check passes 34 parts, 33 contacts, ten grounded wheels, 0.010059 rear clearance
and physical fronts SE=+Y, NW=-Y, SW=-X, NE=+X in game coordinates. Six damaged
scenes fail for their intended structural defects. Restoring the earlier
orientation in memory makes the independent direction test fail at SE.

This source acceptance does not establish runtime placement, seated body fit,
rolling or swivel animation. Corrected room evidence and integration results
are recorded in `docs/assets/review-evidence/office/chair.md`.
