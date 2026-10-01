# Wall bookcase: four-facing replacement

The existing `bookshelf` uses a shallow wooden model with four rows of books.
Definition 7, entity 10 at (8, 0), price 120, one-tile footprint and standing
Read a book interaction remain unchanged. The aquarium is not part of this pass.

## Source evidence

Candidate 01 passed primary and independent review of its four 768x960 RGBA
originals and reduced board. Independent subjective score: 93/100, not a
calibrated measurement or owner approval. Warm wood, muted spines and smooth
outlines match the accepted furniture. The opaque rear correctly hides books.

The cabinet is 1.54 high and 0.28 deep, with a 0.30-deep crown. Its authoring
back remains at Y=0.5. All four exporter rotations reproduce the old wall-edge
alignment, rotating around the tile origin rather than the cabinet centre.

`check_bookcase_scene.py` verifies 32 closed connected solids, four grounded
frame pieces and 41 evaluated surface contacts. Nine damaged copies and five
deleted guards are detected without changing the saved model bytes. Independent
review added a separate overhead-clearance invariant; minimum measured gap is
0.0019999743. Its red test failed for the wrong reason before the explicit guard
was added, then the corrected proof rejected penetration specifically.

Model SHA256: `9483a5f0dbf574ff7942b839c395b7c9dc89f1642b3a1ad8a174c1b870ab0ce5`.
Canonical proof: `bbe22a421bc086416d86506d579241d7200d7498f97f63532472cff1b55da7ae`.
Eight source inputs and four renders are hash-bound. No paid generation,
shared renderer change or Sim source change was used.

## Runtime evidence

1. `bookcase-gpu.png` records 14 real-renderer fixtures: four isolated facings,
   four midnight views, five restored colourways and Build preview. GPU
   validation and error lists were empty. Source emission remains zero;
   preview suppresses the old row and uses the expected restored colour.
2. Production Build controls rotated entity 10 through SW/NW/NE/SE, always at
   (8, 0) and tick zero. Returning to SE restored exact save bytes and world
   hash. Save SHA256:
   `d54a12df27cadfd3cb058cc58b1935fef1d2102f78e447c32f42e4ce7e98c9e2`;
   world hash: `14407959560176395908`.
3. The visible context menu was `Wall of Intent`, offering `Read a book` and
   `Nothing`. Selecting Read a book and normal 3x speed brought Tim to (9, 0),
   visual 4/activity 8, facing 2 at tick 10. His active queue was exactly
   `Read a book: Wall of Intent`. The socket-target column stayed 4294967295,
   as intended for standing reading. No direct simulation command or manual
   tick was used in this played check; state inspection was read-only.
4. `bookcase-room-day.png` uses flat daylight lighting at tick zero, not a
   simulated daytime claim. The night capture uses the normal midnight cycle.
   Four facing captures and `bookcase-room-reading.png` retain actual room
   scale, partition alignment and the standing pose. Production resources were
   `index-CO6VWDyF.js`, `terri_wasm_bg-CQ6ekp_o.wasm` and the atlas below.
   Page and console errors were empty. Owned contexts closed in finally blocks.
5. Independent runtime review accepted the GPU board and all seven room
   captures. This proves the captured placements and standing-reading pose,
   not every neighbouring arrangement or animation sample. No visual revision
   was requested. Both task-owned preview servers were stopped after checking
   their process identities. `bookcase-played.json` retains the UI observations.

## Preservation and checks

SE/NW/SW/NE records append at 1366..1369. The atlas has 1,370 records at
8192x4806, SHA256
`ce8e654ca1369c9d467845046f769c2f591d4b8e05551f05ce43dca08b570c43`.
The prefix test preserves all 1,366 older decoded sprites, names, sizes,
densities and nine registration/interaction tables. Legacy wall-bookcase art
remains in place. Gameplay, saves, Sims, rigs and placements are unchanged.

Passed locally, command exit 0:

1. `python -B -m unittest discover -s assets/models/living`: 33 tests.
2. `python -B -m unittest discover -s assets/sprites/gen`: 119 tests.
3. `cargo test --workspace`: 1,214 tests across five nonempty suites.
4. `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
6. `npm --prefix web test`: 1,378 tests across 101 files.
7. `npm --prefix web run typecheck` and `npm --prefix web run build`.
8. `python assets/sprites/gen/build.py --check`: fresh 1,370-record atlas.
9. `python check-doc-ids.py` and `git diff --check`.

Layout and integration tests were observed failing before the new source and
atlas records existed. Picking negatives were corrected to lie inside the
registered canvas and outside all four content bounds. Public deployment is
separate from local visual acceptance and source merge.

Independent code review verified every previous crop and metadata table,
source provenance and the revised clearance guard. An in-memory pixel change
to previous sprite 1365 made the prefix test fail with one assertion failure
and no errors; no asset file was altered.

Staged-only tree `30bee4a04a3678e238ed96a860fce6835a5cc64a` passed atlas
freshness, 119 sprite tests, 33 living-model tests and documentation IDs without
ignored source files. Its eight source inputs, four renders, saved model and
atlas bytes matched their hashes. Subsequent edits only add verification results
to this receipt.

Before pushing, main advanced to `fe8f9fe1e915427521d9bda5c78025317610a5b0`
through PR162. Its CI scheduling guards, family-label test and documentation
were inspected and merged without changing runtime or artwork. The merged
checkout passed `cargo test -p terri-core` (107 tests), the complete CI-script
suite (15 tests), documentation IDs and diff checks. Both appended lessons
were preserved; their separating blank line was restored after the union merge.
