# Stacked laundry verification

Candidate 02 replaces Cycle, Perpetual's art without changing its identity,
placement, footprint or decorative role. It remains noninteractive. Primary
and adversarial review accepted the static source and runtime images at a
subjective correctness score of 90/100 under the delegated approval policy.

## Source

1. Directory: `assets/models/bathroom/owner-review-pending/laundry/candidate-02/`.
2. Canonical proof SHA-256: `701191a5e165100ca92604dcb7e6a89507c84032bfa160bca88630e356cc176f`.
3. Model SHA-256: `9d13fee1a2b293510e669174c396d47e8b31453fbcd2864ab363f0b6def6ac9c`.
4. Four PNG hashes and eight source hashes passed independent review.
5. Candidate 01 remains rejected because its detergent drawer overlapped the
   indicator. Its files, source snapshot and failing report remain available.

The saved-model checker records four floor contacts, 34 sampled inside-solid
attachment witnesses, door rims with open centers and washer control clearances
of approximately 0.075 and 0.095. Six deliberate displacements fail; a clean
reload passes and the model hash remains unchanged. These finite checks do
not establish all possible collision clearances or future animated poses.

Residual limitations: minor rim contour ticks at source size, broad plain side
panels and controls that lose detail at game size. Windows are opaque dark
material. No moving drums, opening doors, utility connections or laundry
gameplay are introduced.

## Runtime

`laundry-four-facing-gpu.png` shows the real SpriteRenderer at 2x scale in
SE/NW/SW/NE order. The GPU validation result was null and its uncaptured-error
list empty. Both reviewers accepted facing, floor registration and clipping.

`laundry-played.png` shows the ordinary production preview at Day 1, 05:28,
with Casey at the adjacent sink. Both reviewers accepted laundry height and
width beside Casey and the sink, its room-facing front, floor contact and
visible wall clearance. Foreground overlap with the sink reads as depth
occlusion, not visible intersection; it does not prove every hidden clearance.

The ordinary UI selected Casey, Basin Basic, then Wash hands. Casey was seen
Using object, then returned to Deciding what to do at 05:40; hygiene increased
from 94.7 at the paused screenshot to 100. This checks access beside the new
laundry unit, not a laundry action. The keyboard target list deliberately
excludes decorative objects, so laundry has no keyboard action target.

Production preview loaded `index-BbsfVjrA.js` and `terri_wasm_bg-D0_OgE5d.wasm`.
Its only console error was a missing favicon (404). The dedicated test tabs
were closed afterward.

## Regression checks

All commands passed with exit 0:

| Command | Result |
| --- | --- |
| `cargo test --workspace --quiet` | 688 tests |
| `npm --prefix web test -- --maxWorkers=1` | 693 tests, 53 files |
| `npm --prefix web run typecheck` | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| `npm --prefix web run build` | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 50 tests |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | 6 tests |
| `python -B assets/sprites/gen/build.py --check` | 1,121 sprites, 4096x6450 |
| `python check-doc-ids.py` | PASS |
| `cargo fmt --all -- --check` | PASS |

The reviewer independently reran four laundry web tests, the prefix and
catalog tests, and atlas reproducibility. Full-suite results above are primary
evidence. Direct decoded-image comparison preserves all 1,117 previous records
and the exact four laundry images restored from the saved batch. The prefix
guard's 1,117-record complement hash was calculated from the pre-correction
batch, excluding only the four deliberately replaced refrigerator images.
Source proof checks protect the current refrigerator independently.

Atlas SHA-256:
`1807af29c250915c9f2c54265bef6008d045fa33384922504a6206ab529634d0`.
Publication requires separate merge, deployment and live verification.
