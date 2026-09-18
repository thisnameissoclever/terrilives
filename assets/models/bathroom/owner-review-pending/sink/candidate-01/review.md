# Bathroom sink candidate 01

Accepted for static integration by primary and adversarial review on
2026-09-17 under delegated approval. Subjective correctness: 89/100.
All four full-resolution originals and the reduced review samples were
inspected against the accepted kitchen palette and Sim style.

The ceramic basin, pedestal, faucet and drain remain coherent across true
rotations. The saved-scene checker confirms a recessed floor, drain and flange
support, spout placement over the bowl and pedestal support. Five displaced
parts fail their intended assertions; the clean model then passes and its
hash is unchanged. All source and PNG hashes match the render proof.

Retained limitations: the inner outline ends at both rear sides as a partial
U; broad planar shading remains visible in the bowl; the tiny lever blends
with the faucet at reduced size. Review found these nonblocking. The lever
guard uses bounding-box overlap, not an exact surface-contact proof, and does
not independently establish hinge-to-faucet attachment. The actual geometry
and images show no corresponding defect.

This accepts the static candidate, not runtime placement or a washing
animation. Preserve the originals, saved model and proof unchanged. Water,
plumbing simulation and Sim hand-contact animation are not implemented here.
