# Refrigerator static replacement

Reviewed 2026-09-17. The owner delegated per-object visual acceptance to the
primary and adversarial reviewers. Both passed this static replacement.
This evidence does not claim a published deployment or an opening animation.

## Visible result

1. `fridge-four-facing-gpu.png` shows indices 1089 through 1092 in SE, NW,
   SW and NE order through the actual WebGPU SpriteRenderer and generated
   atlas. The inspection fixture draws one floor tile below each fridge at
   2x camera zoom. No GPU validation errors were observed. This is a renderer
   fixture, not four objects simultaneously placed in the household.
2. `fridge-played.png` shows the built bundle `index-CvX27vfC.js` served from
   the production preview server. The refrigerator fits its original corner
   placement and adjacent counter height; Tim is eating in front of it.
3. The player-facing path used Tim's roster button, canvas keyboard targeting,
   the fridge's `Grab a snack` button and the visible 1x/Pause controls. Tim was
   observed eating at Day 1, 00:41 and returned to idle at 01:18 with hunger
   restored from 60.8 to 100.0.
4. A save at 00:41 was followed by actual 1x play to 00:42. Confirming Load
   restored 00:41 and Tim's eating state. The status read `Saved game loaded`,
   both persistence controls were enabled, and the confirmation dialog was
   closed. The clock HUD updates separately from the persistence status;
   verification waited for both rather than treating a stale clock as failure.

The independent reviewer found no blocking placement, facing, outline or
depth-order defect. This is the existing eating action, not a new reach/open
sequence. Hinged doors remain authoring structure only.

## Data and regression evidence

Atlas: 1,093 sprites at 4096x6095, SHA256
`445b674cf3f9252d9cc005213e926c7369baa6772fa75676cde696b1d66026e2`.
Only `fridge.sprite` changes in content. Its identity, footprint, placement,
roles, interactions and save format are unchanged. All 1,089 preceding decoded
sprite records and existing animation/attachment tables match the main baseline.

1. `cargo test --workspace --quiet`: 687 tests passed, exit 0.
2. `npm --prefix web test -- --maxWorkers=1`: 674 tests passed in 49 files,
   exit 0. Typecheck, WASM compilation and production Vite build passed.
3. Python sprite suite: 49 tests after the final provenance guard. Kitchen
   authoring suite: 6 tests. Atlas freshness and documentation IDs passed.
4. `check_prop_mutations.py`: five deliberately broken implementations failed
   their named assertions. Production source bytes stayed unchanged; all nine
   ordinary loader tests then passed. Mutations cover horizontal mirroring,
   tile-anchor compensation, facing order, reviewed proof and source pixels.
5. The web picking regression covers all four views: visible body clicks hit,
   while transparent top and side margins miss. Save coverage observes actual
   render-buffer indices for both authored and dynamically spawned fridges.

## Review corrections

The first static import lacked content bounds, so transparent canvas margins
intercepted clicks. A failing picking test caught it; bounds now come from
the downsampled alpha channel. Adversarial review also showed that a symmetric
fixture could not detect mirroring, and that acceptance needed to bind to the
exact camera/provenance record. An asymmetric landmark and pinned proof digest
now cover those failures.
