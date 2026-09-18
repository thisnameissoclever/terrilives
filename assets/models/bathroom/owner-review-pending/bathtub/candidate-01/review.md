# Bathtub candidate 01

REJECTED after played-room review: `DOUBLE_FOOTPRINT_CENTERING`, 65/100.
Earlier source-only acceptance at 90/100 did not detect this placement error.
The runtime already centers the two-tile render row. This candidate's extra
half-tile model offset pushed the tub beyond the floor boundary. Candidate 02
centers the complete model around its local origin. Original art, proof,
failed room image and source snapshot remain here for comparison.

The model uses the approved Sim scene's toon materials, light and camera.
Four rigid rotations preserve the enamel shell, recessed floor, deck taps,
curved spout, overflow and drain. No external generation provider or paid
request was used. The authoring brief is implemented in the hashed scripts:
a warm enamel two-tile tub matching the bathroom fixtures, with physical
attachments and smooth edges. The saved model and four PNG originals are
retained together with their input hashes in `proof.json`.

The 160x176 logical canvas provides padding without changing world scale.
Originals are 1280x1408; atlas textures are 320x352. The canonical shell was
incorrectly offset along Y. Its isolated fixture also omitted runtime
footprint centering, concealing the problem. Other facings remain source
views, not proof of rotated gameplay footprints.

`scene-check-03.json` passes with six inside-solid contact witnesses, deck and
drain support, floor contact and a spout ray into the recessed basin. Six
deliberate displacements fail before a clean reload with unchanged model hash.
The first two check reports retain a checker error, not rejected art: an
initial 1 mm bound tolerance did not allow the 8 mm bevel to trim the edge.
The corrected check permits bounded inward trimming but no outward growth.

Residuals: broad soft interior shading; the drain is partly occluded in SE/SW.
No water, bathing pose or faucet animation is included. The review board only
resamples and arranges the original images; it does not paint over defects.
