# Outdoor store models

This folder holds three procedurally modeled outdoor items: a backyard pool, a pool lounger and a patio umbrella. Each one renders to four facings through the larger registered static prop exporter in `../bathroom/render_wide_static.py`, the same exporter the bathtub uses. Pool activity-v6 widens the ladder passage by moving the left rail four centimeters outward and extending the treads to meet it. The landing has a recessed corner on the basin side for the descending leg. The color views and contact fixture come from the same evaluated Blender model.

## Contents

- [Models and dimensions](#models-and-dimensions)
- [Files](#files)
- [Render a candidate](#render-a-candidate)
- [Current candidates](#current-candidates)
- [Tests](#tests)

## Models and dimensions

One tile is 1.0 world unit. Models are centered on the origin; the evaluated pool bounds below include its beveled ladder stringers.

**Pool** (2 by 2 placement tiles). The activity model retains warm wood cladding and pale stone coping, with five dark trim bands and a deeper basin. Coping spans 1.92 by 1.92; its top is Z=0.90, the floor is Z=0.06 and opaque water is Z=0.82. The liner is 1.72 wide below the coping, whose opening is 1.70 wide. Water uses the accepted 256 by 256 grid; ripple highlights are faces of that connected surface. Water affects visibility and supplies no collision or support.

The compact ladder is centered at X=-0.50 on the +Y side. Two 0.013-radius rails rise above three external and three internal flat treads, at Z=0.25, 0.50 and 0.75, with a crest landing at Z=1.00. Toe recesses retain a continuous liner backing. Evaluated non-water geometry spans X=-0.96 to 0.96, Y=-0.96 to 1.00 and Z=-0.00627 to about 2.16265. Every solid stays within the square footprint in X and Y. Runtime preparation uses evaluated solids and the rails' retained Bezier paths; bounds alone do not establish contact or clearance.

**Pool lounger** (1 by 2 tiles, long axis along world Y as the bathtub is authored). A pale wood frame with four short legs, a deck board and a muted teal padded cushion. The model is 0.62 wide and 1.80 long. The seat cushion top is 0.42 high, which suits the generic chair-sitting pose on its edge. The backrest at the +Y end is hinged on the frame, raised 40 degrees and reaches about 0.80 high; two wood props hold it from the side rails.

**Patio umbrella** (1 by 1 tile). A slate weighted round base 0.40 across with a dark bronze socket collar, a slim pale wood pole with a bronze tilt collar, and an octagonal canopy with alternating cream and muted coral panels. The canopy measures 1.56 across its rib tips, its lowest valance edge is 1.90 high and the finial top is 2.25 high. The canopy overhangs the tile, which is expected.

## Files

Each object has three source files, following the plant and bathtub pattern:

- `*_layout.py` holds the dimensions and any vertex helpers in pure Python, with no Blender import.
- `*_model.py` defines `build(root)`, which creates the named meshes under `root` with the helpers in `../furniture/build_parts.py` and returns the model checks recorded in `proof.json`.
- `render_*.py` adds this folder, `../bathroom`, `../kitchen` and `../furniture` to the import path and calls `render_wide_static.run` with its own source files listed for hashing.

`test_outdoor_layout.py` checks the layout numbers without Blender.

## Render a candidate

For the pool, run export_pool_fixture_v6.py in background Blender with --baseline-fixture, --motion and --output after Blender's -- separator. Use the matching contacts-v5.json and v16 motion as inputs. Then run render_pool_activity_v5.py with --directory pointing to the exported candidate and --output pointing to a new sprite directory. Supply absolute paths. Check that the model and fixture hashes in proof.json match the exported candidate.

For the lounger and umbrella, pass a new output directory after -- to the corresponding renderer. The launcher can return before rendering finishes. Wait for `proof.json` in the output folder to report `"state": "complete"`, or `"failed"` with a traceback, with a bounded wait. Each run writes `proof.json`, an authoring `.blend` and `closed-SE.png`, `closed-NW.png`, `closed-SW.png` and `closed-NE.png` at 1280 by 1408 pixels, the 160 by 176 logical canvas at density 8.

The atlas importer, `assets/sprites/gen/offline_props.py`, rejects a facing whose visible pixels come within 8 source pixels of any canvas edge. Check each PNG's alpha bounding box with Pillow before proposing a candidate.

## Current candidates

| Object | Current folder | Earlier folders |
|---|---|---|
| Pool | `owner-review-pending/pool/activity-v6` | Original candidate-04 accepted the shallow static pool. Original 01 had plain water; 02 outlined separate ripple meshes; 03 had visible stair steps. Activity-v1 added the basin and treads but regressed to coarse water and was rejected. Activity-v2 restored fine water detail with the older external ladder. Activity-v4 retains that water detail with the compact six-tread ladder and crest landing. Activity-v5 widened the passage from 52 to 56 centimeters. Activity-v6 adds the recessed landing. |
| Pool lounger | `owner-review-pending/lounger/candidate-01` | none |
| Patio umbrella | `owner-review-pending/umbrella/candidate-02` | 01 had a slate base collar that blended into the base and a slightly flatter canopy |

The original candidate-04 pool, lounger and umbrella passed the review in `docs/assets/review-evidence/outdoor/2026-10-17/art-review.md`. The activity-v2 review compared all four source views against activity-v1, rejected the coarse ripples, and accepted the finer water detail. Activity-v4 passed a separate four-view static review. Its evaluated solids, rail paths and water geometry match the retained compact r3 scene. Depth export hides the `pool_rail_authoring_path` helpers and renders the visible solids, rails and water.

The [v14 pool motion](../sims/character-creator/pool_activity_motion_v14.json) guides the elbows toward the pool during the ladder crest transition. [Contacts v3](../sims/character-creator/clips/pool/contacts-v3.json) derives from `contacts-v2.json` by replacing only `revisions.poseProducer` with the SHA-256 digest of the exact v14 motion file. The physical geometry and contact policy retain their original bytes. Verify the derivative by reversing that digest substitution and comparing the complete file with v2. This binds the new motion to the existing r3 physical export.

The static prop catalog `../static-props-07.json` binds the accepted art proofs, and `assets/sprites/gen/build.py` packs their sprites into the atlas. `../sims/character-repair/export_outdoor_depth.py` produces registered depth in `../sims/character-repair/outdoor-depth`. The renderer uses each pixel's physical depth to place a housemate in front of or behind the object. Verify fitted entry, paddling, exit and water coverage in the displayed game after the complete compiler accepts the tested body.

The game uses the V6 model with the v18 motion and v7 contacts. The Sim pushes off from the ladder at tick 12 of entry and climbs out on a separately authored path. The worker fits that path to the Sim before playback. The renderer uses the same fixture coordinates for the water surface, the ladder and the swimmer. [Motion](../sims/character-creator/pool_activity_motion_v18.json) · [Contacts](../sims/character-creator/clips/pool/contacts-v7.json)

## Tests

```powershell
py -3 -B -m unittest discover -s assets/models/outdoor
```

The suite checks the footprints, outer bounds against the tile budget, the rim and water heights, the ladder clearing the coping, the cushion and backrest heights, and the canopy width, lowest edge and finial height.
