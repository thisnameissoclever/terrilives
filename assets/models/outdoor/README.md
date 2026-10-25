# Outdoor store models

This folder holds three procedurally modeled outdoor items: a backyard pool, a pool lounger and a patio umbrella. Each one renders to four facings through the larger registered static prop exporter in `../bathroom/render_wide_static.py`, the same exporter the bathtub uses. The current candidates have passed independent static review. Pool activity-v2 has matching color and depth exports. Configured motion and displayed game review remain open; earlier candidates remain as rejection evidence.

## Contents

- [Models and dimensions](#models-and-dimensions)
- [Files](#files)
- [Render a candidate](#render-a-candidate)
- [Current candidates](#current-candidates)
- [Tests](#tests)

## Models and dimensions

One tile is 1.0 world unit. Every model is centered on the origin with its base on Z=0.

**Pool** (2 by 2 placement tiles). The activity model retains warm wood cladding and pale stone coping, with five dark trim bands and a deeper basin. Coping spans 1.92 by 1.92; its top is Z=0.90, the floor is Z=0.06 and opaque water is Z=0.82. The liner is 1.72 wide below the coping, whose opening is 1.70 wide. Water uses the accepted 256 by 256 grid; ripple highlights are faces of that connected surface. Water affects visibility and supplies no collision or support.

The ladder is centered at X=-0.50 on the +Y side. Two 0.013-radius rails have four external and four internal flat treads, at Z=0.20, 0.40, 0.60 and 0.80. Evaluated non-water geometry spans X=-0.96 to 0.96, Y=-0.96 to 1.085 and Z=0 to about 1.32377. The external ladder occupies part of the reserved approach tile beyond the pool footprint. Runtime activity fitting uses evaluated solids and rail handles; the older layout helper only bounds rail control points and is not a collision envelope.

**Pool lounger** (1 by 2 tiles, long axis along world Y as the bathtub is authored). A pale wood frame with four short legs, a deck board and a muted teal padded cushion. The model is 0.62 wide and 1.80 long. The seat cushion top is 0.42 high, which suits the generic chair-sitting pose on its edge. The backrest at the +Y end is hinged on the frame, raised 40 degrees and reaches about 0.80 high; two wood props hold it from the side rails.

**Patio umbrella** (1 by 1 tile). A slate weighted round base 0.40 across with a dark bronze socket collar, a slim pale wood pole with a bronze tilt collar, and an octagonal canopy with alternating cream and muted coral panels. The canopy measures 1.56 across its rib tips, its lowest valance edge is 1.90 high and the finial top is 2.25 high. The canopy overhangs the tile, which is expected.

## Files

Each object has three source files, following the plant and bathtub pattern:

- `*_layout.py` holds the dimensions and any vertex helpers in pure Python, with no Blender import.
- `*_model.py` defines `build(root)`, which creates the named meshes under `root` with the helpers in `../furniture/build_parts.py` and returns the model checks recorded in `proof.json`.
- `render_*.py` adds this folder, `../bathroom`, `../kitchen` and `../furniture` to the import path and calls `render_wide_static.run` with its own source files listed for hashing.

`test_outdoor_layout.py` checks the layout numbers without Blender.

## Render a candidate

Run Blender in the background with one new absolute output folder after `--`. The exporter refuses an existing folder, so give every attempt a new numbered candidate folder.

```powershell
& 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' --background --threads 2 --python-exit-code 1 --python <absolute path>/assets/models/outdoor/render_pool_activity_v2.py -- <absolute path>/assets/models/outdoor/owner-review-pending/pool/candidate-NN
```

Use `render_lounger.py` or `render_umbrella.py` the same way. The launcher can return before rendering finishes. Wait for `proof.json` in the output folder to report `"state": "complete"`, or `"failed"` with a traceback, with a bounded wait. Each run writes `proof.json`, an authoring `.blend` and `closed-SE.png`, `closed-NW.png`, `closed-SW.png` and `closed-NE.png` at 1280 by 1408 pixels, the 160 by 176 logical canvas at density 8.

The atlas importer, `assets/sprites/gen/offline_props.py`, rejects a facing whose visible pixels come within 8 source pixels of any canvas edge. Check each PNG's alpha bounding box with Pillow before proposing a candidate.

## Current candidates

| Object | Current folder | Earlier folders |
|---|---|---|
| Pool | `owner-review-pending/pool/activity-v2` | Original candidate-04 accepted the shallow static pool. Original 01 had plain water; 02 outlined separate ripple meshes; 03 had visible stair steps. Activity-v1 added the basin and treads but regressed to a coarse water grid and was rejected. |
| Pool lounger | `owner-review-pending/lounger/candidate-01` | none |
| Patio umbrella | `owner-review-pending/umbrella/candidate-02` | 01 had a slate base collar that blended into the base and a slightly flatter canopy |

The original candidate-04 pool, lounger and umbrella passed the review in `docs/assets/review-evidence/outdoor/2026-10-17/art-review.md`. The later activity-v2 review compared all four source views against activity-v1, rejected the coarse ripples, and accepted the finer water detail. Evaluated non-water solids and rail handles are identical between those two activity candidates; their source scenes and pose inputs are preserved. Static review does not establish configured-body fitting or runtime depth. The static prop catalog `../static-props-07.json` binds each accepted proof with the status `accepted-independent-review`, and `assets/sprites/gen/build.py` imports their twelve sprites into the atlas after every earlier sprite. `../sims/character-repair/export_outdoor_depth.py` gives those twelve sprites registered depth in `../sims/character-repair/outdoor-depth`, so the renderer compares housemates with each pixel's physical depth rather than with a depth estimated from its footprint.

## Tests

```powershell
py -3 -B -m unittest discover -s assets/models/outdoor
```

The suite checks the footprints, outer bounds against the tile budget, the rim and water heights, the ladder clearing the coping, the cushion and backrest heights, and the canopy width, lowest edge and finial height.
