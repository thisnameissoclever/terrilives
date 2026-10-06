# Fitted toilet use, 2026-10-06

Base revision: `6114716bc44c75cd40eb5cbd21b4a21143d01aa7` (main at verification).
This record covers the seated toilet loop only. Bath and shower sources are
separate work and are not accepted by this evidence.

## Source and storage

1. Accepted pose `assets/models/bathroom/actions/review/toilet/prototype-08-curved-support/proof.json`.
2. Loop batch `assets/models/bathroom/actions/review/toilet/loop-01/proof.json`:
   `a16299c576d6eed2d1b30bfb3b80b6b0df53f6eaa0765a62dc72d556cacb6ed7`.
3. Body-ink batch `assets/models/bathroom/actions/review/toilet/ink-01/proof.json`:
   `780238f3d7e6b351bb76d21a08631b45050ab816f160fed0f0236fe6e7a0751b`.
4. Export `assets/models/bathroom/actions/export/toilet-05/manifest.json`,
   canonical JSON SHA-256
   `361fd4f1d05fa357502f290548efbb5a1552e85cebcb51df72fb03da6cbddd97`.
   Exports `toilet-01` to `toilet-03` are historical and are not imported.
   An intermediate `toilet-04` registered the occupied scene 21 logical pixels
   above the empty fixture because its exporter omitted the tile drop that the
   static props and the seating renderer apply; the owner saw the toilet jump
   in play. `toilet-05` applies the same rule, `offline_bathroom.tables` now
   refuses an occupied scene whose anchor differs from its empty fixture, and
   `toilet-04` was removed before anything was committed.

The quiet closed loop has four samples over sixteen simulation ticks in four
facings and three shirts. The export was regenerated from the unchanged loop
and ink receipts after the import validator changed. Every one of the 48
scenes passes the unchanged source comparison limits (maximum six and
95th-percentile two colour levels against independent floating-point beauty);
the observed maxima are four and two.

## Contact certificate validator

The earlier validator accepted a certificate polygon that traced half a cell
twice with its second circuit displaced by 1e-10 metres. A fresh-context review
also showed that many thin partitions, each overlapping the next by just under
the pairwise tolerance, could hide a hole as large as all those overlaps.

The import validator now converts each partition to exact rationals, requires a
strictly positive turn at every vertex and exactly one winding, and bounds the
covered cell area from below by the exact sum of clipped pieces minus the exact
sum of pairwise overlaps. The frozen producer `contact_surface.py` is unchanged.
`test_bathroom_export_contract.py` accepts the authentic receipt and rejects
exact and displaced double winding, a denormal displacement, a spike, a
reversal, a clockwise cell, a zero-area sliver, two full cells, two copies of
one half, overlapping three-quarter halves and a hundred thin strips whose
float areas sum to the cell while each pairwise overlap stays under the
tolerance; a companion test shows that forgery passing every other check
when the exact bound is disabled.

## Renderer and picking

Render action code 18 identifies the seated toilet body; codes 14 to 17 belong
to the cleaning chores that reached main first. `web/proofs/toilet-use.js`
draws all 48 scenes through the real sprite renderer at texel-aligned scale
two and compares a full-frame copied readback with the decoded-layer shader
reference from `prepare-toilet-gpu-reference.py`. Maximum error is one colour
level and the 95th-percentile error is zero. The validation error scope and
uncaptured-error list were empty. `toilet-use-gpu-scenes.png` shows the sixteen
green scenes. This shader reference is not original beauty; the source-art
comparison above is the independent original-beauty gate.

`web/tests/toilet-production.test.ts` checks every facing and shirt, the
reduced-motion rest sample, visible body versus fixture click ownership,
compiled use through the WebAssembly bridge, save and load restoring the drawn
pose, and cancellation clearing it.

## Atlas preservation

The atlas appends 108 records (60 visible-contribution textures and 48 scene
aliases) after all 3,539 published records, for 3,647 in total. Every prior
decoded crop, name, size, density and existing metadata table entry remains
exact. `verify-sprite-preservation.py origin/main` produced the receipt
`.local-build/sprite-preservation.json` with `preserved: 3539` and
`appended: 108`; `build.py --check` passed on the same output.

## Actual house

A task-owned game served from this worktree at the `127.0.0.1:5174` origin,
which holds no save of the owner's, was played in the browser pane with the
`toilet-05` atlas. In a new game on Day 1, Tim was ordered to Use the toilet
through the Porcelain Standard menu; queue mode put the order behind his
waiting actions, and Casey reached the toilet first on her own at 06:06.
`toilet-empty-played.png` (01:45, menu open) and `toilet-use-played.png`
(06:06, Casey seated with the activity bubble) are the same camera: the
toilet bowl is drawn at the same screen position whether empty or occupied,
which is the defect the owner saw with the earlier anchor and the check this
record exists for. An earlier session on the superseded atlas also showed
save and load restoring a seated housemate with the status Saved game loaded,
and clicking the seated body keeping that housemate selected; the production
test covers both on the current atlas. No console error was reported. The game
respects the operating system's reduced-motion preference; the rest sample is
covered by the production test. The browser pane was left open for the owner
to watch and the dev server was stopped when the delivery finished.

## Local verification

1. `cargo test --workspace -j 2`: 1,787 tests passed on the merged tree.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -j 2 -- -D warnings`: passed.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: passed.
4. `npm --prefix web test -- --maxWorkers=1`: 2,132 tests passed.
   Web typecheck and production build: passed.
5. Bathroom action suite (`assets/models/bathroom/actions`): 96 tests passed,
   29 of them the contract and exporter tests. The intentionally red bath
   wall-support test from the checkpoint is not part of this delivery; it
   remains in history at ba38c907 for the bath track. CI discovers only the
   eight top-level bathroom tests; the action suite is a local gate.
6. Sprite generator suite: 204 tests passed after the content-bounds test
   learned to union bathroom scene layers and the prefix test counted the
   108 new records.
7. Changelog tests and build, document identifiers: passed.

Source review and local runtime proof do not establish public deployment.
