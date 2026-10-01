# Ottoman sitting integration

Status: accepted offline art and local runtime checks; browser review pending.
No GPU, played-action, source-merge or public-release acceptance is
claimed here. The static-art receipt remains in [ottoman.md](ottoman.md).

## Source and import

The byte-preserved `sitting-02` package contains the additive `ottoman_sit` action,
four samples in all four facings and three shirt colours. Approved Sim geometry,
weights, materials, rest bones and shared actions remain unchanged. The strict
contact evidence measures cushion and sole support, furniture intersections and
12 selected body/body pairs. It does not claim exhaustive anatomical checking.

The reviewed importer reuses empty records 1358..1361 and appends 72 records:
48 body frames plus 24 shared furniture/outline layers. It adds exactly four
action-8 profiles with `halfCycleTicks: 10`, matching the saved two-sample-per-second
cadence. Armchair cadence remains 24. Object identity, one-tile footprint, price,
effects, duration, declared slots and save compatibility remain unchanged.

The local atlas has 1,450 records at 8192x5261. SHA-256:
`4c92f7cbd5916537011a0d4100f34991beecc585937f8ed097a596ad6aaa88c5`.
All 1,378 previous decoded sprites and their non-packing fields are unchanged.
All historical registration tables and interaction entries remain unchanged;
only the four previously static ottoman keys gain interaction profiles. Older
prefix tests explicitly allow those four keys, not a regenerated baseline.

## Verified evidence

Each command exited 0:

1. `python -m unittest discover -s assets/sprites/gen`: 157 tests before the main
   synchronization described below, including 29 prefix-preservation tests.
2. `python assets/sprites/gen/build.py --check`: current 1,450-record atlas;
   repeated successfully after synchronization because upstream inputs changed.
3. `python assets/sprites/gen/prove_ottoman_receipt.py --output output/ottoman-receipt-guards-02.json`:
   28 deliberate in-memory defects failed named assertions; all 32 restored
   receipt/importer tests passed with source bytes unchanged. Compiler errors,
   skipped tests and unexpected exceptions are not accepted as detection.
4. `python assets/sprites/gen/ottoman_originals.py --catalog assets/models/living/ottoman-reviewed.json --originals output/ottoman-sit-candidate-02/contributions --output output/ottoman-originals-verified-01.json`:
   all 196 original RGBA PNGs passed hashes, full decoding, dimensions and required
   padding. Re-encoding matched every retained texture and all 48 reconstruction
   measurements. This is separate from a clean build using encoded exports only.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm -- --jobs 2`:
   fresh release WASM after the reservation and sink-audio integration.
6. `cargo test --workspace --jobs 2`, `cargo clippy --workspace --all-targets --jobs 2 -- -D warnings`,
   and `cargo fmt --all -- --check`: passed at the main revision listed below.
7. `npm --prefix web test -- --maxWorkers=1`: 1,577 tests in 112 files passed.
   Four later tests of the mutation-result classifier also passed separately.
8. `npm --prefix web run typecheck` and `npm --prefix web run build`: passed.
   Production outputs: `index-DPpqK3kO.js`, `terri_wasm_bg-DZ719wRo.wasm`.
9. `node web/proofs/prove-ottoman-runtime.mjs output/ottoman-runtime-mutations-05.json`:
   eight renderer/cancellation defects and two proof-classifier defects failed
   their specific assertions; all 28 restored focused tests passed. The journal
   retains the expected assertion markers and explicit zero-unhandled-error
   reports. Production source, WASM, tests and proof-tool hashes stayed unchanged.
10. `python assets/sprites/gen/prove_ottoman_prefix.py --output output/ottoman-prefix-mutations-01.json`:
    corrupt old pixels, changed anchors, wrong facing and wrong cadence each
    failed their named assertion. All three restored tests passed; files stayed
    byte-identical.
11. A clean archive of tree `8eae6b5c88d236fe69cd3fb7ed3d09f7e6273914` passed
    `python assets/sprites/gen/build.py --check`, all 157 sprite tests and all 51
    living-model tests. It contains no ignored originals or temporary producer
    files. This export predates the final browser-proof classifier tightening;
    those later test-only changes were checked by command 9, not this archive.

The original-image run pins catalog SHA-256
`d5b452a54d71d225eac8f943676ef8a320207d155a573d35693a7a3367d91cc4`
and bundle SHA-256
`6124f9c2be19d241ce3f48a19b2a0c018fa3131ef94b68cb3ade81dbba5fdeb2`.
Retained copies are in `assets/models/living/owner-review-pending/ottoman/sitting-02/`.
The production receipt checks evidence; it does not rerun Blender geometry.

Independent code review caught and prompted fixes for null dependency digests
disabling optional hash comparisons, and a verification run accepting a new
internally valid bundle in place of its starting evidence. The tests reproduce
both cases with re-signed receipts. Separate fixtures isolate the hip gap, floor
gap, reconstruction percentile limit and each authoring-preservation condition.

## Integration and remaining proof

The worktree fast-forwarded from `a199fc4d` through `2021647f` to
`d0c7f45d0df141418364e38412308272bc588874`, retaining reservation, sink-audio,
dialog-focus and housemate-control spacing changes. The aquarium's 88-file batch
is committed separately as `909518310587eddad43c2a43abc4e9d26024823e` on
`twcx/aquarium-visuals`. The ottoman checkpoint is stacked on that commit on
`twcx/ottoman-sitting`; neither branch checkpoint establishes release acceptance.
No source-model or accepted image bytes
changed upstream. Checkpoint stash `603386124df8434496c40e4eeae3188ea74bb667`
retains the latest pre-sync tracked state; neither `.tmp/` nor `output/` was stashed.

The fresh WASM build and all 24 focused ottoman/interaction-production tests
passed after synchronization. They cover exact-target selection, all samples
and colours, authored cadence, reduced motion, immediate save restoration and
simultaneous armchair/ottoman sitting. Cancelling either sitter preserves the
other sitter's exact target and occupied frame. The isolated browser fixture now
covers all 48 occupied samples, reduced motion, recolours, midnight and
cancellation, but has not run. Browser verification still awaits resolution of the
documented tool file-access denial. Do not bypass it or report offline evidence
as played acceptance. Close owned pages and preview servers after any later
authorized browser pass.
