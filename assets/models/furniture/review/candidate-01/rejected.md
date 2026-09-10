# Rejected review set

Provider: local Blender 4.5 with the approved Sim scene, not an image model.
Source: `bike-authoring.blend` and `chair-authoring.blend` in this folder.
The full set is retained for comparison. Do not request approval of this set.

1. Empty views contain detached eye outlines. The Sim's visibility drivers
   override per-object `hide_render` during evaluation. Hide the entire Sim
   reference collection for empty views; do not erase the unwanted pixels.
2. The first towel spans the bend into the raised grip, so its analytic flat
   support model does not match the actual handle tube along its full width.
   Shorten and move the towel onto a genuinely straight support segment,
   keeping the holding area clear. A correct cross-section alone is insufficient.

The occupied chair and bike establish a plausible first fit, but these defects
make the full set unsuitable for approval. Runtime layering is not tested here.
