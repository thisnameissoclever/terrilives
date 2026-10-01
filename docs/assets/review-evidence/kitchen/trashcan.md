# Trash can: four-facing replacement

The existing `trashcan` object uses a closed grey pedal-bin model. Persistence
ID, definition 13, entity 6 at (6, 0), price 20, one-tile footprint and scenery-only
behaviour remain unchanged. No interaction or lid animation is introduced.

## Source evidence

Candidate 01 passed primary and independent review of all four 768x960 RGBA
originals and reduced samples. Independent subjective score: 93/100, not a
calibrated measurement or owner approval. Smooth grey enamel, fitted lid and
dark hardware follow the accepted kitchen's material family. The model is 0.64
high beside the 0.86 counter; its cylindrical body is 0.42 wide.

`assets/models/kitchen/check_trashcan_scene.py` checks the saved scene: five
closed connected solids, one grounded base and five evaluated surface contacts.
Eight damaged copies and three deleted guards are rejected. The original model
bytes remain unchanged. The check covers the closed exterior, not a hollow
interior or functioning pedal linkage.

Model SHA256: `8bf0a7b7722947acd90ae84472214b9a6b65e449833af3b9b270337af6ef8150`.
Canonical proof: `aa16ddca687c5429b804febfa973b774acc79f9a0350b5bcbde1d009e4b74030`.
Eight source inputs and four renders are hash-bound. No paid generation or
image repainting was used. Camera, lights and material family come from the
unchanged approved Sim scene.

## Runtime evidence

1. `trashcan-gpu.json` records 14 real-renderer scenes: four isolated facings,
   four midnight room views, five restored colourways and Build preview.
   GPU validation and error lists are empty. Partial door occlusion in room
   views is expected and is not part of the isolated sprite.
2. Normal production Build controls rotated entity 6 through SW, NW, NE and SE
   while paused at tick zero. All placements remained (6, 0). Returning to SE
   restored exact save bytes and world hash. Save SHA256:
   `3a7ea02e5c2146e57cffb5b79ed72f517ad264e906ef6a0bccc6681375b8cf69`;
   world hash: `7060072437166737253`.
3. Right-clicking the visible bin opened `Receptacle for Later` with only
   `Nothing`. The scenery still offers no actions. Imported-art picking now
   excludes the empty strip of floor beneath the old procedural canvas, as
   documented by the existing importer policy. Tests cover this intentional
   difference as well as body, top-padding and side-padding clicks.
4. The retained production room, night and menu screenshots show the bin beside
   the end counter. Production resources are `index-yydzyapi.js`,
   `terri_wasm_bg-ZFDW7cBr.wasm` and the atlas below. Page and console errors
   are empty. State inspection was read-only; placement changes used controls.
5. The first played check completed rotations but its final menu read used an
   incorrect selector. It timed out and closed its context. After reading the
   actual `#object-menu` markup, a fresh complete run passed. No game code or
   saved state was changed to accommodate the check.
6. Primary and independent review accepted the GPU, room, night and menu
   captures. No visual revision was requested. All owned browser contexts
   closed in finally blocks; both task-owned preview servers were stopped.

## Preservation and checks

New SE/NW/SW/NE records append at 1362..1365. The atlas has 1,366 records at
8192x4779, SHA256
`92e78dcf52e54b897cae02bcae7fd60d2aee3c87f428fe1bc7f486ef9ef05eba`.
Independent review verified all 1,362 preceding decoded crops, names, sizes,
densities and nine registration/interaction tables unchanged. The old bin
records remain in place. No gameplay, save, Sim, rig, placement or importer
implementation changed.

Passed locally, command exit 0:

1. `python -B -m unittest discover -s assets/models/kitchen`: 15 tests.
2. `python -B -m unittest discover -s assets/sprites/gen`: 117 tests.
3. `cargo test --workspace`: 1,214 tests across five nonempty suites.
4. `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
6. `npm --prefix web test`: 1,372 tests across 100 files.
7. `npm --prefix web run typecheck` and `npm --prefix web run build`.
8. `python assets/sprites/gen/build.py --check`: fresh 1,366-record atlas.
9. `python check-doc-ids.py` and `git diff --check`.

Layout and integration tests were observed failing before the new source and
atlas records existed. Independent code review accepted the closed-exterior
checker, exact provenance, prefix preservation and intentional picking change.
A deliberately altered pixel in previous sprite 1361 made the prefix test fail;
the mutation existed in memory only and no asset file was changed.
Staged-only tree `439b1f1f9841b50b7ff47cadcd4290d301f22acd` passed atlas freshness,
117 sprite tests, 15 kitchen-model tests, documentation IDs and exact eight-input,
four-render, model and atlas hashes without ignored originals. Subsequent edits
only add review and verification results to this receipt.
Public deployment is separate from local visual acceptance and source merge.
