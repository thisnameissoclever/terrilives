# Nightstand and dresser replacement

Reviewed 2026-09-17 under delegated primary and adversarial acceptance.
Nightstand candidate 02 and dresser candidate 01 passed source and played-room
review. Both received subjective source scores of 91/100. No owner action is
required. This record does not claim publication.

Independent final integration and room-fit score: 92/100, with no blocking
visual finding. Broad plain side/back panels remain the minor style limitation.

## Scope and retained behavior

1. Nightstand: warm oak, two closed drawers, satin pulls, four feet and a small
   closed teal book. Body dimensions are 0.52x0.48x0.52; book height is 0.553.
   Its unchanged (2,6) placement now faces SW into the room rather than along
   the spine wall. This existing spot remains near the bed's foot end.
2. Dresser: matching oak, three closed drawers and four feet, dimensions
   0.88x0.50x0.95. Its (0,10) placement and SE facing remain unchanged.
3. Both IDs, names, one-tile footprints and decorative-only behavior remain.
   No Sim, pose, bed, interaction, inventory or save schema changes.

## Source and mechanical evidence

Nightstand proof: `d809044fa1f971692f9e58c87c480cf8721c9f97b5b470b71868b07439aa01ec`.
Nightstand model: `f2f5efce1b3052e380493ac9807c0c430f326f88537b17849b93fe5057fa022e`.
Dresser proof: `f9bc06893154c3025fc84b73f323f14ba6d2f627504f861045b38fa9e87323b7`.
Dresser model: `f1475cbb34fbb897dbdcfef9e7d237e93495ad2b63226025f76af1c349d8361e`.

Each complete proof records eight input hashes and four 768x960 original RGBA
renders. The registered camera and toon materials are reused unchanged. The
independent reviewer checked every input, output and model hash.

The first nightstand candidate remains rejected for tiny gaps behind fronts
and the book spine. The contact test failed before correction. Each accepted
saved model passes evaluated-mesh support witnesses, four grounded feet,
one-tile bounds and height checks. Three deliberate displacements each fail
the intended assertion; a clean reload passes with the same model hash. These
finite probes do not prove arbitrary collision or moving-drawer clearance.

## Actual rendering and room review

`storage-four-facing-gpu.png` uses the real WebGPU SpriteRenderer. Rows are
nightstand then dresser; columns are SE, NW, SW, NE. Each stands on a single
floor diamond at 2x zoom. Validation scope returned null and no uncaptured
GPU errors were recorded. This fixture is not a placed household.

`storage-played.png` shows the production build paused at Day 1, 04:53 after
ordinary running and wheel zoom. Bill stands in the bedroom for comparison.
Primary and adversarial reviewers accepted nightstand height beside the duvet,
dresser scale beside Bill, floor contact, footprint fit, wall clearance and
drawer direction. `storage-whole-house.png` retains the unzoomed room context.
No console ERROR entries were found in this session log. The bundle was
`index-DtXCHA2_.js`, with `terri_wasm_bg-CDBv_c6A.wasm`.

The test origin still reports an invalid saved game from the previously
documented zero-byte fixture. That file was left untouched; this session does
not establish browser save migration. Native save regressions remain separate.
The dedicated review tab was closed, leaving the original blank tab alone.

## Regression checks

The eight appended views occupy indices 1125 through 1132. Every previous
record's metadata (except repacked X/Y) and decoded pixels match Git parent
`b7c8609`, including the corrected refrigerator. Both reviewers independently
compared all 1,125 prior images. The prefix guard also pins the 1,125-record
complement digest, and the content test pins actual authored storage facings.

Commands passed with exit code 0:

1. `npm --prefix web test -- --maxWorkers=1`: 702 tests in 55 files.
2. `npm --prefix web run typecheck` and `npm --prefix web run build`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
4. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 52 tests.
5. `python -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'`: 3 tests.
6. `python -B assets/sprites/gen/build.py --check`: 1,133 sprites, 4096x6689.
7. `cargo fmt --all -- --check` and `python check-doc-ids.py`.
8. `cargo test --workspace --quiet`: 689 tests.
9. `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'`: 8 tests.

Atlas SHA-256: `5b1e65f7794939690d638d3bd73390a2f121a99414f55ec41c090b8dcecba603`.
Main CI and Pages must pass before any live acceptance claim.
