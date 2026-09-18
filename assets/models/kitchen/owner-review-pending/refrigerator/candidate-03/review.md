# Refrigerator candidate 03: room-scale correction

Primary and adversarial review accepted this batch and the integrated kitchen
view on 2026-09-17. The whole-room and close screenshots show the SW door face
aligned with the kitchen fronts and appropriate size beside the counter and
standing Tim. No blocking floor, side, wall or observed Sim overlap was found.

The original geometry is uniformly enlarged by 1.2 in model space. Camera,
projection, registration, palette and physical part relationships are unchanged.
Both hinges are checked after scaling at 0, 45 and 90 degrees. All four views,
eight input hashes and the saved model hash passed independent source review.

Measured width is 0.912 and height is 1.944, compared with the counter's width
1.0 and height 0.86. The saved scene has floor contact and 0.044 side clearance
to the adjacent counter. Its handles extend 0.111 beyond the front of the
occupied tile; the gameplay footprint remains one tile, not a claim that every
visible part fits inside it. Candidate 02 fails the new width check.

`room-fit-check.json` retains dimensions, scaled-hinge results and two caught
corruptions: reverting scale and raising the model above the floor. The saved
model hash is unchanged. These checks do not establish collision-free door
opening or a finished reaching animation.
