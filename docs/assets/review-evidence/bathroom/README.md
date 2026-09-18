# Bathroom sink verification

## Refrigerator correction carried forward

The combined atlas now retains refrigerator candidate 03 and its SW kitchen
placement from commit `3ef2f3b`. It contains the same 1,109 records, with hash
`b10c81d72d41cdbb818b2e78cd4b7a88a662f3dae6fec7994e8cbfe9d6f6cf35`.
Decoded-image comparison against the pre-merge bathroom branch verified all
1,105 non-fridge records unchanged. Comparison against the fridge correction
verified its complete 1,105-record atlas unchanged, including all four fridge
images. Only atlas packing coordinates may differ between these comparisons.

Fresh merged-tree checks passed with exit 0: 688 Rust tests, 681 web tests,
50 sprite tests, typecheck and atlas reproducibility. The screenshots and
hashes below describe the earlier bathroom-only checkpoint, not this combined
build or a published revision. Refrigerator room-fit evidence is recorded in
`../kitchen/fridge-room-fit.md`.

## Original bathroom checkpoint

Candidate 01 replaces Basin Basic without changing its identity, footprint,
placement, interaction definitions or Sim art. The owner delegated per-object
acceptance to primary and adversarial review on 2026-09-17.

## Static source and integration

Primary and independent review accepted all four source views at 89/100
(subjective correctness score). The GPU board also passed independent review.
The source review retains three minor limitations: a partial inner-rim outline,
broad planar bowl shading and a lever that merges visually with the faucet at
small sizes. None was judged a blocking structural or style defect.

1. Source: `assets/models/bathroom/owner-review-pending/sink/candidate-01/`.
2. Canonical proof SHA-256: `9cad34182a412802eb0e7224a2fa715af63437064c7ea74122e3edd0507cf226`.
3. Saved model SHA-256: `86039365e144c7972db456181270c65c0b86fa17c032b6a9b300979272f96c7c`.
4. Atlas SHA-256: `1a9f01e8cd873e905b014b6b639a0fca4a5dd60902de6d96300ce32d35d70202`.
5. Atlas: 1,109 records, 4096x6313 pixels. New records 1105 through 1108 use
   SE, NW, SW, NE order, logical 96x120 frames and 192x240 source pixels.
6. Global `assets/models/static-props.json` replaces the kitchen-only catalog.
   Existing entries retain their order and proof pins. Append globally, not
   separately per room, so later additions cannot renumber another room.

The saved-scene checker validates the bowl floor, drain and flange support,
faucet outlet over the bowl, pedestal contact and lever attachment bounds.
Five in-memory displacement mutations were caught, then a clean reload passed
and the model hash remained unchanged. The lever test checks bounding-box
overlap; it is not an independent proof of exact surface contact.

## Runtime evidence

`sink-four-facing-gpu.png` uses the actual SpriteRenderer at 2x scale for all
four facings. Validation returned null and the uncaptured-error list was empty.
The independent reviewer judged floor registration, facing and clipping correct.

`sink-played.png` shows the built game at Day 1, 01:16 with Casey at Basin Basic.
The test selected Casey, opened the exact Basin Basic menu and chose Wash hands.
At 01:09 the activity was Using object and hygiene was 68.1. At 01:15 hygiene
was 76.8. At 01:36 the action had ended, activity was Deciding what to do and
hygiene was 100. The adjacent washer partially hides the pedestal in this view.
These checks establish placement and the existing interaction, not a new
hand-contact, running-water or washing animation.

Independent review accepted the played screenshot: the visible pedestal and
bowl align, washer occlusion is reasonable, and Casey does not visibly
intersect the fixture. The reviewer assessed the still image; the timed hygiene
and completion results above come from primary live observation.

The production preview loaded `index-0-rm2kNS.js` and
`terri_wasm_bg-kZBJzYyE.wasm`. Its two console errors were both missing
`favicon.ico` requests (404); no additional runtime error was reported.
Local acceptance does not establish publication. A deployed revision and live
atlas hash must be recorded separately after merge.

## Checks

All listed checks completed with exit code 0 on 2026-09-17:

| Command or check | Result |
| --- | --- |
| `cargo test --workspace` | PASS, 687 Rust tests |
| `npm test -- --maxWorkers=1` in `web` | PASS, 681 tests across 50 files |
| `npm run typecheck` in `web` | PASS |
| WASM and Vite production build | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS, 50 tests |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | PASS, 2 tests |
| Static-loader mutation checks | PASS, 5 mutations caught; 9 clean-loader tests passed afterward |
| `python -B assets/sprites/gen/build.py --check` | PASS, 1,109 records |
| Documentation ID check | PASS |

The geometry tests were observed failing before implementation. The web tests
failed on the missing four names before integration and passed afterward.
The catalog migration alone was checked before appending bathroom records and
left the atlas byte-identical. A decoded-prefix digest now preserves all 1,105
prior records, in addition to the earlier kitchen prefix guards.
