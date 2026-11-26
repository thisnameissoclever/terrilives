# Fixture and prop companions

These exports add depth to published fixture colors using the geometry that produced them. `asset-inventory.json` lists the covered furniture models and character clips, along with each bundle's manifest hash. Run `build_inventory.py` to regenerate it.

1. `fixture-depth` contains 140 registered records for static furniture, plates, bowls, and pots. `aquarium-depth` contains 40 records for the published aquarium frames. `outdoor-depth` contains 24 records for four pools, the pool lounger and the patio umbrella. Their source catalogs run from `static-props-07.json` through `static-props-10.json`. Each record names its atlas index and its rectangle in an independent 2048 by 2048 RGBA page.
2. `shelf-depth` contains an empty case and 24 independent book masks for each facing. Keep the existing stock-color composition. Among the case and present stock slots, select the largest decoded depth whose mask is nonzero.
3. `components` contains actor-free fridge-door and bike-crank states, plus bed bases with their static covers removed. The closed fridge and resting bike preserve the published color bytes. Other states retain published bytes wherever the same static source surface remains visible. Moving and newly revealed surfaces use the original source materials and lighting.
4. `dropped-book` preserves the published color pixels and registration. Its missing historical authoring scene requires reconstructed depth: the retained canonical book parts keep their shape, materials, scale, and floor support while their in-plane rotation is fitted to the complete published silhouettes across all four facings. This does not claim recovery of the missing original surface depths. The [dated comparison and physical checks](../../../../docs/evidence/2026-10-13-creator-repair/dropped-book-review/README.md) record that limitation and prove exact color preservation.

The red and green channels encode `round((Blender X - Blender Y + limit) / (2 * limit) * 65535)`. Larger values are nearer the shared camera. The signed depth limits are 2 tiles for the original fixtures, 3 for the rectangular pool, 4 for the 3 × 4 above-ground pool and 6 for the 5 × 7 in-ground pool. The blue channel stores 0 for the original fixtures and `128 + limit - 3` for wider ranges on covered texels. Alpha is nonzero wherever the corresponding color has nonzero coverage. Decode each texel before comparing surface depths. Values outside the declared range fail export.

To regenerate pool color, run the model's Blender exporter in `assets/models/outdoor`. The 3 × 4 pool uses `export_lodge_pool.py` and the 5 × 7 pool uses `export_in_ground_pool.py`. Each takes a fresh `--output` directory and writes four registered views, the editable model, evaluated geometry, and render provenance.

After building the color atlas, run `export_pool_depth_v9.py` in Blender for each changed pool. Point `--color` at its registered color export and `--output` at a new directory. Pass that depth directory to the matching option in `pack_pool_depth_v9.py`.

| Model | Color prefix | Depth packing option |
| --- | --- | --- |
| Compact pool | `offlinePool` | `--compact` |
| Rectangular pool | `offlinePoolRectangular` | `--wide` |
| 3 × 4 above-ground pool | `offlinePoolLodge` | `--lodge` |
| 5 × 7 in-ground pool | `offlinePoolInGround` | `--in-ground` |

The depth packer verifies source hashes, dimensions and exact alpha coverage. New rectangles append to the depth pages so established fixtures keep their registrations.

Color and depth use the same source texel. `pageIndex` belongs to the named companion bundle, not the production atlas. Component `anchorOffset` is in logical pixels and adds to the original sprite's anchor. Its color and depth rectangles share registration.

The bunk source has an upper duvet but no lower duvet. Lower-only occupancy keeps the published bunk and adds its configured lower cover. Use the cover-removed base only when replacing the upper duvet. Double beds use one configured cover across their occupied places.

The ingredient bag remains a declared bitmap plane anchored to the carrying hand. Its source is a two-dimensional procedural badge; these exports do not claim it has authored volume.

Run the Blender scripts with two threads, background mode, scripts disabled, and Python failures mapped to a nonzero exit. Run `python assets/models/sims/character-repair/verify_assets.py` for byte, source-hash, coverage, catalogue, and registration checks. `verify_bathroom_floor.py` independently replays toilet, bathtub, and counter camera rays against the physical floor. `preview_assets.py` generates contact sheets from the delivered bytes.

The actor-free exporter isolates non-fixture geometry in a hidden collection because object visibility drivers can re-enable hidden character parts. Coverage registration rejects those leaks. Outline support includes the actual authored stroke width and the published Lanczos reduction kernel.

Runtime transitions, wall intersections, configured covers, and owner visual acceptance remain separate from successful asset export.
