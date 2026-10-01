# Coat rack candidates

One editable wooden stand with muted teal hanging fabric supplies all four
facings. The approved Sim's camera, light and toon materials remain unchanged.
These are local Blender renders, not image-model requests; prompt and paid
spend are not applicable. No cloth simulation or new gameplay is claimed.

1. Candidate 01: rejected because the crossbar ran 90 degrees away from the
   old SE placement. All four originals, model and proof are retained in
   `rejected/candidate-01`. Subjective correctness: 80/100; visual consistency
   cannot compensate for an incorrect saved facing.
2. Candidate 02: bakes the orientation correction into the model, leaving
   the exporter and saved facing values unchanged. Source art and physical
   acceptance are tracked separately from runtime acceptance.
3. Candidate 02's first two scene checks rejected an exact upright/base butt
   joint because a floating-point seam narrowly separated their bounds. The
   repaired checker also accepts evaluated surface contact within 0.000001 model units.
   Scene check 03 passes seven wood contacts, six supported fabric samples,
   closed solids, one connected fabric component and full fold support.
   Nine damaged copies and five deliberately removed guards fail as intended.

Primary source review finds smooth contours and a plausible continuous fold.
The two fabric tails have different lengths and remain on opposite sides of
the rail. The small static drape retains the old asset's simple fabric identity;
it is not a detailed jacket. Later runtime evidence belongs in
`docs/assets/review-evidence/living/coat-rack.md` at the repository root.
