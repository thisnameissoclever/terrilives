# Dining chair verification

Candidate 01 replaces only the existing `chair` sprite mapping. Its price 40,
one-tile footprint, save identity and absence of interactions are unchanged.
The two chairs remain at (1,3), facing NE, and (4,3), facing SW, toward the
table between them. The table, approved Sims and all other art remain intact.

## Source and geometry

The four separate 768x960 RGBA originals, review board, editable Blender scene,
source hashes and mechanical results are in
`assets/models/dining/owner-review-pending/dining-chair/candidate-01/`.
Primary and independent review accepted the source at a subjective 93/100.
It uses the existing toon material, light and camera setup. No paid image or
model request was made. Exact construction inputs are the journaled scripts.

The saved scene has 14 parts and 22 solid-overlap contacts. Four feet touch
the floor; all three back rails have equal dimensions. Physical fronts derived
from seat and back geometry are SE=+Y, NW=-Y, SW=-X and NE=+X in game space.
Five deliberately broken copies fail for the intended reasons: raised foot,
detached stretcher, detached seat, detached back rail and missing rear post.
The original model reloads cleanly and its bytes remain unchanged afterward.
The scene checker preserves exact failures in `scene-check.json`.

Small rail gaps read mostly as dark lines at game size. Both reviewers accepted
that readability limit; no floating part, torn line or inconsistent rotation
was found. This is static furniture, not a seated dining animation or occupied
leg-clearance proof. The existing table action still uses a standing body.

## Runtime evidence

1. [GPU facings](chair-four-facing-gpu.png) were drawn by the actual
   `SpriteRenderer` through `web/proofs/dining-chair.js`, ordered SE, NW, SW,
   NE. All four use density 2 and the unchanged floor registration. Validation
   returned null and uncaptured GPU errors were empty. The harness pass flag
   covers those errors; direct inspection of the PNG establishes appearance.
2. [Room overview](chair-room.png) and [closer played view](chair-played.png)
   show the production build at Day 1, 00:00 with neutral lighting. The chairs
   face the ends of the table, have seats below its surface and meet the floor.
   Primary and independent runtime review accepted the result at 93/100, with
   no clipping or mismatch with neighboring furniture.
3. A normal click on the visible back selected chair 8. Build controls cycled
   NE -> SE -> SW -> NW -> NE, then confirmed its unchanged position. World
   hash `757726977152363945` was unchanged. The first harness click aimed at
   the seat behind the table and selected the table; clicking the exposed back
   tested visible chair picking without an application change.
4. The actual-WASM regression checks both placements, prices, footprints,
   facing masks, sprite indices, all four previews and save round-trip. It
   failed against the old mapping with 258 instead of 1253, then passed after
   rebuilding. Independent source-direction checks establish physical facing;
   a saved facing code by itself would not establish it.
5. Browser contexts were disposable and closed in `finally`, including the
   failed harness attempt. No page errors occurred in the completed pass.
   Production resources were `index-Bo-_CvhF.js`,
   `terri_wasm_bg-Ba9lwvvh.wasm` and the atlas below. Task-owned servers stopped
   after verification. The owner's browser profile and saved game were not used.

## Preservation and checks

New records 1250 through 1253 are physical 192x240, logical 96x120. All 1,250
earlier records preserve their names, indices, dimensions, density and decoded
pixels. Their prefix digest is
`e1bb3a60a41c7f8aa0859f3a443210f22f93c4999987a5da6c5861ae4ec32305`.
The new test first failed on the missing appended records, then passed after
building the tail catalog. Source records are appended to `static-props-03.json`.

Atlas: 1,254 records, 4096x8022. SHA-256:
`517df8095e60b058dc9b4abb438a2e68fbd106a7b3ce417d2d38c49496c9f3ac`.

The worktree fast-forwarded to main `1517a1ac4a52217ef5f5b3f714c676a2fdeff5cc`
before final validation, preserving the independently released sleep-schedule
changes. No chair file overlapped that update. Commands passed with exit 0:

1. `cargo test --workspace --quiet`: 1,208 tests on the integrated revision.
   Earlier 1,197-test results were superseded after main changed.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -- -D warnings`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --release`.
4. `npm --prefix web test -- --maxWorkers=1`: 1,257 tests across 90 files.
5. `npm --prefix web run typecheck` and `npm --prefix web run build`.
6. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 90 tests.
7. `python -B -m unittest discover -s assets/models/dining`: four tests.
8. `python -B assets/sprites/gen/build.py --check`: fresh 1,254-record atlas.

A temporary test wrapper supplied five corrupted atlas modules in memory to
the unchanged dining-chair regression. Each run failed with exit 1 at its
intended assertion: density 1 produced 192x240 instead of logical 96x120;
anchor Y=100 differed from 116.000437; full-canvas content bounds made empty
space selectable; an injected split pair violated static ownership; swapped
SW/NE lookups returned 1253 instead of 1252. Production files were not mutated.
The temporary wrapper was removed after the check.

Independent review also caught 14 in-memory Python mutations: lost grounding,
oversized seat, detached stretcher, unequal rails, uneven rail spacing, raised
seat, missing support declarations, duplicate part names, a 90-degree authoring
basis error, swapped facing records, a renamed prior sprite, one changed prior
pixel, incorrect new density and incorrect new width. Each failed its intended
assertion. Source, tests and atlas SHA-256 values were identical before and after.
The restored five-test web regression passed with exit 0.

A separate `git archive` of the staged tree passed atlas freshness, all 90
sprite tests and all four dining layout tests with exit 0, without ignored
workspace files. Only this verification prose was added afterward. Documentation
IDs, diff checks and the final format check passed. No dependencies changed.

These local and targeted mutation checks are not a full remote Rust mutation
sweep. Merge and public deployment remain separate states; duplicate remote
checks do not delay the owner's authorized merge after local acceptance.
