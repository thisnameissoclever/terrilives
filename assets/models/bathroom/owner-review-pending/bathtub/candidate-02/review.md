# Bathtub candidate 02

Accepted by primary and independent source, GPU and static SE room review at
90/100. The played view keeps the tub inside the exterior floor boundary,
with plausible size beside Casey and no visible floating or collision.
The complete shell and every fitting moved together to center the model on
local Y=0. Its shape, materials, lighting, camera and world scale match
candidate 01; that candidate failed room placement and remains retained.

No image-generation provider or paid request was used. The source brief is
the same warm enamel bathroom tub with a recessed basin, attached satin-metal
deck fittings and smooth edges. The implementation and nine render inputs
are hashed in `proof.json`, along with all four original PNGs and the model.

`scene-check.json` passes. Six sampled inside-solid contacts cover the plinth,
overflow and tap parts. Drain/deck support, floor contact and the spout's ray
into the recessed basin also pass. Six deliberate displacements fail before
a clean reload with the model hash unchanged.

The runtime render row is (14.5,9) for the authored tub at (14,9). The SE shell
spans approximately X=[13.581,15.419], within the occupied X=[13.5,15.5].
Other rotations are source views, not a change to footprint rotation rules.

Residuals remain broad interior shading and partial drain occlusion in two
views. No bathing pose, water or faucet motion is included. Integration and
played evidence are recorded in the bathroom review-evidence directory.
