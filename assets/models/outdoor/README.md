# Outdoor store models

This folder holds the four pool models, pool lounger, and patio umbrella. Each model renders to four facings. The two pools sold in Build have separate Blender exporters for the fitted stairs and the below-grade basin.

## Contents

- [Models and dimensions](#models-and-dimensions)
- [Files](#files)
- [Render a candidate](#render-a-candidate)
- [Current candidates](#current-candidates)
- [Tests](#tests)

## Models and dimensions

One tile is 1.0 world unit.

**Backyard Lodge** occupies 3 by 4 tiles, including the exterior stairs. Its wood walls surround a rectangular basin. Pale stone coping tops the wall at Z=0.90, and water sits at Z=0.82. The model retains the fitted stair treads and landing, with wider, lower rails. Sims can step up and down with their arms free.

**Garden Basin** occupies 5 by 7 tiles. Its stone surround meets the ground at Z=0, and water sits at Z=-0.18. Sims hop in from the deck and climb out on three submerged ladder treads. The floor opening follows the placed pool, so the original ground and finishes can reappear if the pool moves or is sold.

**Backyard Rectangle and Backyard Square** remain in existing lots at their original 3 by 2 and 2 by 2 footprints. Both have an inclined exterior ladder, straight walls, and full-width water. Their variants share the original fitted ladder at X=-0.50 and standing approach at (-0.5, 1.5). The wide sprite and depth map are offset half a tile from that frame. Color, depth, character drawing, and water effects rotate together.

**Pool lounger** (1 by 2 tiles, long axis along world Y as the bathtub is authored). A pale wood frame with four short legs, a deck board and a muted teal padded cushion. The model is 0.62 wide and 1.80 long. The seat cushion top is 0.42 high, which suits the generic chair-sitting pose on its edge. The backrest at the +Y end is hinged on the frame, raised 40 degrees and reaches about 0.80 high; two wood props hold it from the side rails.

**Patio umbrella** (1 by 1 tile). A slate weighted round base 0.40 across with a dark bronze socket collar, a slim pale wood pole with a bronze tilt collar, and an octagonal canopy with alternating cream and muted coral panels. The canopy measures 1.56 across its rib tips, its lowest valance edge is 1.90 high and the finial top is 2.25 high. The canopy overhangs the tile, which is expected.

## Files

The lounger, umbrella, and legacy pool sources follow the plant and bathtub pattern:

- `*_layout.py` holds the dimensions and any vertex helpers in pure Python, with no Blender import.
- `*_model.py` defines `build(root)`, which creates the named meshes under `root` with the helpers in `../furniture/build_parts.py` and returns the model checks recorded in `proof.json`.
- `render_*.py` adds this folder, `../bathroom`, `../kitchen` and `../furniture` to the import path and calls `render_wide_static.run` with its own source files listed for hashing.

`test_outdoor_layout.py` checks the layout numbers without Blender.

## Render a candidate

Use a fresh output directory for each pool export. Each writes the editable Blender file, four registered color views, evaluated geometry, and the proof file.

```powershell
blender -b -t 1 -P assets/models/outdoor/export_lodge_pool.py -- --output .scratch/lodge
blender -b -t 1 -P assets/models/outdoor/export_in_ground_pool.py -- --output .scratch/basin
```

For legacy assets, run `export_pool_fixture_v9.py` in background Blender with `--source` pointing to the matched ladder source and `--output` pointing to a new directory. Add `--compact` to export the square model. Render either legacy asset with `render_pool_activity_v5.py --directory <export> --output <sprites>`.

For the lounger and umbrella, pass a new output directory after -- to the corresponding renderer. The launcher can return before rendering finishes. Wait for `proof.json` in the output folder to report `"state": "complete"`, or `"failed"` with a traceback, with a bounded wait. Each run writes `proof.json`, an authoring `.blend` and `closed-SE.png`, `closed-NW.png`, `closed-SW.png` and `closed-NE.png` at 1280 by 1408 pixels, the 160 by 176 logical canvas at density 8.

The atlas importer, `assets/sprites/gen/offline_props.py`, rejects a facing whose visible pixels come within 8 source pixels of any canvas edge. Check each PNG's alpha bounding box with Pillow before proposing a candidate.

## Current candidates

| Object | Current folder | Earlier folders |
|---|---|---|
| Backyard Lodge | `owner-review-pending/pool/lodge` | Adapted from the activity-v9 contact fixture. |
| Garden Basin | `owner-review-pending/pool/in-ground` | Uses the activity-v9 interior treads at the height of the submerged ladder. |
| Legacy pools | `owner-review-pending/pool/activity-v9` and `activity-v9-compact` | Original candidate-04 accepted the shallow static pool. Original 01 had plain water; 02 outlined separate ripple meshes; 03 had visible stair steps. Activity-v1 added the basin and treads but regressed to coarse water and was rejected. Activity-v2 restored fine water detail with the older external ladder. Activity-v4 retains that water detail with the compact six-tread ladder and crest landing. Activity-v5 widened the passage from 52 to 56 centimeters. Activity-v6 added a toe recess. Activity-v7 widened the turn platform. Activity-v8 used an inset ladder that cut into the basin. Activity-v9 uses a continuous wall and an external ladder. |
| Pool lounger | `owner-review-pending/lounger/candidate-01` | none |
| Patio umbrella | `owner-review-pending/umbrella/candidate-02` | 01 had a slate base collar that blended into the base and a slightly flatter canopy |

The original candidate-04 pool, lounger and umbrella passed the review in `docs/assets/review-evidence/outdoor/2026-10-17/art-review.md`. The activity-v2 review compared all four source views against activity-v1, rejected the coarse ripples, and accepted the finer water detail. Activity-v4 passed a separate four-view static review. Its evaluated solids, rail paths and water geometry match the retained compact r3 scene. Depth export hides the `pool_rail_authoring_path` helpers and renders the visible solids, rails and water.

In the historical r3 export, [v14 pool motion](../sims/character-creator/pool_activity_motion_v14.json) guided the elbows toward the pool during the ladder crest transition. [Contacts v3](../sims/character-creator/clips/pool/contacts-v3.json) derives from `contacts-v2.json` by replacing only `revisions.poseProducer` with the SHA-256 digest of the exact v14 motion file. The physical geometry and contact policy retain their original bytes. Verify the derivative by reversing that digest substitution and comparing the complete file with v2.

The static prop catalogs `../static-props-07.json` and `../static-props-08.json` retain legacy colors. Catalogs `../static-props-09.json` and `../static-props-10.json` bind the Lodge and Basin proofs. The atlas build packs them with their [registered depth maps](../sims/character-repair/README.md). The renderer uses each pixel's physical depth to place a housemate in front of or behind the object. Verify entry, paddling, exit, and water coverage in the game after updating a model.

The [active pool release](../../../web/src/render/character/pool-active-release.ts) selects the matching motion, physical contacts and climb-out data. The Sim pushes off at tick 12 of entry. The game fits the climb-out to the selected body and returns it to the original dry approach. A save during the climb preserves the phase and elapsed ticks.

## Tests

```powershell
py -3 -B -m unittest discover -s assets/models/outdoor
```

The suite checks the footprints, outer bounds against the tile budget, the rim and water heights, the ladder clearing the coping, the cushion and backrest heights, and the canopy width, lowest edge and finial height.
