# Long sofa candidate 01

Accepted for static integration by primary and independent visual review,
91/100. This is an internal visual judgment, not a new owner approval or a
reclining-animation claim. Runtime room acceptance is recorded separately.

1. Method: deterministic Blender 4.5.14 LTS authoring, using the accepted Sim's
   toon materials, camera and lighting. No image provider, image prompt, paid
   request, pixel repair or dependency change. Exact inputs and outputs are in
   `proof.json`; reviewed canonical JSON SHA256 is
   `b596582f7e72d3be24fcccba671e62435046aca2b527dde23728027029368abf`.
2. Design: sage three-seat sofa, equal seat/back cushions, rounded arms and four
   walnut feet. Centered two-tile body, local Y long axis and local -X front.
   SE retains the shipped front toward game +Y. NW and SW now show their real
   physical directions instead of repeating the old procedural front.
3. Both reviewers inspected all four source images and the reduced board.
   Form, occlusion, padding, outlines and style passed. Tiny terminal dots at
   cushion seams and a faint rear frame join remain minor polish notes, not
   missing parts or structural defects.
4. Initial `scene-check.json` records a checker API error, not a damaged model.
   `scene-check-02.json` then validated 18 solid joins and nine rejected damaged
   copies against unchanged model bytes. The stricter final check also pins
   every part center so supported but overlapping cushions cannot pass.
5. The existing three-slot generic-use interaction stays unchanged. No occupied
   sofa overlay, reclining rig, action socket or per-cushion Sim fit is claimed.
