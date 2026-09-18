# Shower static replacement

Candidate 01 passed primary and adversarial source review on 2026-09-17 under
delegated asset acceptance. Independent subjective correctness: 90/100.
Rainfall Cubicle retains its identity, footprint and interaction definitions.
The accepted Sim design and other objects' decoded pixels remain unchanged.

## Source evidence

1. Directory: `assets/models/bathroom/owner-review-pending/shower/candidate-01/`.
2. Canonical proof SHA-256: `86fc45fcc8ddb648427b83f15bd5560a8d117bdd6d3195d0fcd46d2512c9d486`.
3. Saved model SHA-256: `c57a911a5e3964e4d23278e1a48150e2fcf3e940ad91183b9480db8a78e60865`.
4. The independent reviewer verified four PNG hashes, nine source hashes and
   the saved model hash. The source review covers all four original views.
5. `scene-check.json` passes eight sampled inside-solid contact witnesses,
   arm-end connections, drain and trim support, and tray floor height. Seven
   deliberate displacements are caught; a clean reload passes and the saved
   model hash remains unchanged. The reviewer inspected this report and its
   checker, but did not independently rerun Blender.

Accepted limitations: the SW panel has broad triangular shading, and small
fittings merge at game size. The panels are opaque. The vertical probe below
the head establishes tray coverage, not simulated spray direction or water
containment. These checks do not certify every possible mesh intersection.

## GPU and played verification

`shower-four-facing-gpu.png` uses the actual SpriteRenderer at 2x scale in
SE, NW, SW and NE order. Records 1113 through 1116 use logical 96x120 frames
and 192x240 textures. The GPU validation scope returned null, the uncaptured
error list was empty, and the browser document was visible. The independent
reviewer accepted facing, floor registration, control placement and clipping.
The isolated renderer document does not run the game bootstrap.

`shower-played.png` shows Casey at Day 1, 04:34 in the production build. The
test selected Casey, cleared waiting orders, opened the exact Rainfall Cubicle
menu and chose Take a shower. At arrival, activity was Using object, hygiene
54.8 and energy 85.8. At 05:00 the activity changed to Deciding what to do,
hygiene was 93.6 and energy 77.5. The sole console error was a missing
`favicon.ico` request (404).

This verifies the static fixture and existing action, not a showering pose,
hand contact, water animation, clothing change or transparent glass. Casey
uses the existing generic standing pose beside the fixture.

Independent review also accepted the played still: tray registration, adjacent
fixtures and panel occlusion are coherent, with no blocking float or clipping.
The timed need changes above are primary live observations, not conclusions
from the still image. Both dedicated verification tabs were closed afterward.

Built bundle: `index-B3CqUY-O.js`. WASM: `terri_wasm_bg-t1B9_GqE.wasm`.
Atlas: 1,117 records, 4096x6403 pixels, SHA-256
`7065e2ad8b0474c2fe94b977e9fab6d14c84af6f432b12eb37eeae8d0a8bdb1a`.
Local acceptance does not establish publication. Record deployment separately.

## Checks

Each command completed with exit code 0:

| Command | Result |
| --- | --- |
| `cargo test --workspace` | PASS, 687 tests |
| `npm --prefix web test -- --maxWorkers=1` | PASS, 689 tests across 52 files |
| `npm --prefix web run typecheck` | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| `npm --prefix web run build` | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS, 50 tests |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | PASS, 5 tests |
| `python check-doc-ids.py` | PASS |
| `python -B assets/sprites/gen/build.py --check` | PASS, 1,117 records |

The new tray geometry test was observed failing before implementation. Four
web tests failed on missing names before integration and passed afterward.
The decoded-prefix guard pins all 1,113 previous records with digest
`0f8c408d7519f793bbd744716881354099f0a1b84a8117e30c01bbf9983712e1`.
Independent review reran the four shower web tests, nine static-loader tests,
the prefix guards and atlas reproducibility check, all passing.

## Refrigerator correction carried forward

The combined atlas retains refrigerator candidate 03 and its SW lot placement.
Its 1,117 records now have atlas hash
`9843586ce1e0d52f034a931561296f3c3507818024f75fbb79d4f338ecb24e11`.
Decoded-image comparisons preserve all 1,113 non-fridge records from the old
shower branch and all 1,113 records from the corrected toilet branch. The
1,113-record complement digest was calculated from old shower commit `a776c95`,
excluding only the four intentionally replaced fridge images. Fresh checks
passed: 688 Rust tests, 689 web tests, 50 sprite tests, typecheck and atlas
reproducibility. Earlier screenshots and hashes above describe their original
checkpoint, not publication of this combined build.

## Combined room check

`combined-room-fit.png` shows the rebuilt production preview at Day 1, 03:32.
Its bundle is `index-BcLLP00R.js`, WASM `terri_wasm_bg-CXYd8-h0.wasm`, and
atlas hash is the corrected combined hash above. Primary and independent
review accepted the visible sink, toilet and shower directions, their heights
beside standing Casey, and visible floor contact and clearance. The unchanged
washer hides part of the sink; hidden edge clearance remains unverified by
this screenshot. No washing, reaching or showering animation is claimed.

Ordinary UI selected Casey, Basin Basic, then Wash hands. Casey reached Using
object, then returned to Deciding what to do; hygiene rose from 60.3 at the
paused screenshot to 83.7 after completion. The only console error was a
missing favicon (404). WASM and Vite production builds passed with exit 0.
The dedicated verification tab was closed afterward.
