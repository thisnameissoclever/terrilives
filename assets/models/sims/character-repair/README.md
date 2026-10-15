# Fixture and prop companions

These exports keep the published fixture colors and add depth from the geometry that produced them. `asset-inventory.json` covers all 30 current furniture models and all 83 character clips. The production atlas and accepted model files remain unchanged.

1. `fixture-depth` contains 140 registered records for static furniture, plates, bowls, and pots. `aquarium-depth` contains 40 records for the published aquarium frames. Each record names its original atlas index and its rectangle in an independent 2048 by 2048 RGBA page.
2. `shelf-depth` contains an empty case and 24 independent book masks for each facing. Keep the existing stock-color composition. Among the case and present stock slots, select the largest decoded depth whose mask is nonzero.
3. `components` contains actor-free fridge-door and bike-crank states, plus bed bases with their static covers removed. The closed fridge and resting bike preserve the published color bytes. Other states retain published bytes wherever the same static source surface remains visible. Moving and newly revealed surfaces use the original source materials and lighting.
4. `dropped-book` preserves the published color pixels and registration. Its missing historical authoring scene requires reconstructed depth: the retained canonical book parts keep their shape, materials, scale, and floor support while their in-plane rotation is fitted to the complete published silhouettes across all four facings. This does not claim recovery of the missing original surface depths. The [dated comparison and physical checks](../../../../docs/evidence/2026-10-13-creator-repair/dropped-book-review/README.md) record that limitation and prove exact color preservation.

The RG channels encode `round((Blender X - Blender Y + 2) / 4 * 65535)`. Larger values are nearer the shared camera. Alpha is nonzero wherever the corresponding color has nonzero coverage. Decode before choosing depth; do not interpolate encoded bytes across separate surfaces. Values outside the declared range fail export.

Color and depth use the same source texel. `pageIndex` belongs to the named companion bundle, not the production atlas. Component `anchorOffset` is in logical pixels and adds to the original sprite's anchor. Its color and depth rectangles share registration.

The bunk source has an upper duvet but no lower duvet. Lower-only occupancy keeps the published bunk and adds its configured lower cover. Use the cover-removed base only when replacing the upper duvet. Double beds use one configured cover across their occupied places.

The ingredient bag remains a declared bitmap plane anchored to the carrying hand. Its source is a two-dimensional procedural badge; these exports do not claim it has authored volume.

Run the Blender scripts with two threads, background mode, scripts disabled, and Python failures mapped to a nonzero exit. Run `python assets/models/sims/character-repair/verify_assets.py` for byte, source-hash, coverage, catalogue, and registration checks. `verify_bathroom_floor.py` independently replays toilet, bathtub, and counter camera rays against the physical floor. `preview_assets.py` generates contact sheets from the delivered bytes.

The actor-free exporter isolates non-fixture geometry in a hidden collection because object visibility drivers can re-enable hidden character parts. Coverage registration rejects those leaks. Outline support includes the actual authored stroke width and the published Lanczos reduction kernel.

Runtime transitions, wall intersections, configured covers, and owner visual acceptance remain separate from successful asset export.
