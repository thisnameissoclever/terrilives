# Toilet static replacement

Candidate 03 passed primary and adversarial source review on 2026-09-17 under
delegated asset acceptance. Subjective correctness: 88/100. This replaces the
static Porcelain Standard art without changing gameplay or the accepted Sims.

## Retained source evidence

1. Directory: `assets/models/bathroom/owner-review-pending/toilet/candidate-03/`.
2. Canonical proof SHA-256: `c0046046dc041a22bf429ff9d4f6ccb181e210fcaf1649e46cf1e1faeaacc430`.
3. Saved model SHA-256: `7eac6444f15d540cfc025c3d5c650ba694c2f30c6cdaebb119853b08f7651859`.
4. All four original PNG hashes and eight source hashes were independently
   verified. Camera, palette and Sim source remain unchanged.
5. `scene-check.json` passes with approximately 0.011 metres of lid/cistern
   clearance, recessed floor at 0.245 metres, open seat at 0.45 metres and
   supported fittings. Five sampled points inside paired evaluated solids
   establish hinge contacts. Eight deliberate displacements are caught; a
   clean reload passes and the saved model hash remains unchanged.

Candidates 01 and 02 are retained as rejected. The first intersects the lid
with the cistern. The second clears the tank but intersects the lower lid with
the ceramic neck. Candidate 02's original passing checker report is retained
beside the later failing neck check; it demonstrates the earlier check's
limited scope, not acceptance.

Candidate 03 has two accepted limitations: broad shading reduces the rear
inner rim's contrast beneath the hinge, and the stepped rear support is boxy.
Neither reviewer judged these mechanically impossible. Static checks do not
prove future lid motion, plumbing or every possible mesh intersection.

## GPU and played verification

`toilet-four-facing-gpu.png` shows the actual SpriteRenderer at 2x scale in
SE, NW, SW and NE order. Indices are 1109 through 1112, with logical 96x120
frames and 192x240 textures. The validation error scope returned null, the
uncaptured-error list was empty, and the browser document was visible.
This isolated fixture imports the real renderer but does not run the game
bootstrap. It proves four-facing rendering, not four household placements.

`toilet-played.png` shows the production build at Day 1, 00:53. Casey was
selected, waiting orders cleared, and the exact Porcelain Standard menu's
Use the toilet action chosen. Casey arrived beside the object with activity
Using object and bladder 98.6. At 01:09 the activity changed to Deciding what
to do and bladder was 100. The sole reported console error was a missing
`favicon.ico` (404).

The game still uses its generic standing pose beside this fixture. This check
does not claim a seated animation, clothing change, flushing motion, or a
finished occupied-fit contract. The nearby shower partially hides Casey's
lower body; the toilet remains visible.

Independent review accepted both runtime images without a blocking scale,
registration, depth or clipping defect. The reviewer reran all 50 generator
tests, the four toilet web tests and atlas reproducibility check, all passing.
Timed recovery and the full build/suite results are primary-run evidence.
The dedicated verification tabs were closed after checking them.

Built bundle: `index-D6s_RKOs.js`. WASM: `terri_wasm_bg-BTcl9GbX.wasm`.
Atlas: 1,113 records at 4096x6331 pixels, SHA-256
`7663d648070c9f65e6e725409b1ba03b35b25633f4f181c2d285fb7aaea04005`.
Local acceptance is not publication; record deployment separately after merge.

## Checks

Each command completed with exit code 0:

| Command | Result |
| --- | --- |
| `cargo test --workspace` | PASS, 687 tests |
| `npm --prefix web test -- --maxWorkers=1` | PASS, 685 tests across 51 files |
| `npm --prefix web run typecheck` | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| `npm --prefix web run build` | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS, 50 tests |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | PASS, 4 tests |
| `python check-doc-ids.py` | PASS |
| `python -B assets/sprites/gen/build.py --check` | PASS, 1,113 records |

The new bowl and seat geometry tests were each observed failing on an empty
implementation before passing. The four web tests failed on missing sprite
names before integration and passed afterward. The decoded-prefix guard pins
all 1,109 prior records with digest
`cb9a2872f53ef196f60fb64ff7b675e6ac202ea1542526b35892bcd7a8ad9fca`.

## Refrigerator correction carried forward

The combined atlas retains refrigerator candidate 03 and its SW lot placement.
Its 1,113 records now have atlas hash
`a7e4a19892154beb2ff000efbc1cc210cf0b432570acd1415a54ebf43a9ea6b0`.
Direct decoded-image comparisons preserve all 1,109 non-fridge records from
the previous toilet branch and all 1,109 records from the corrected sink
branch. The 1,109-record complement digest was calculated from the old toilet
commit `38dac45`, excluding only the four intentionally replaced fridge images.
Fresh checks passed: 688 Rust tests, 685 web tests, 50 sprite tests, typecheck,
atlas reproducibility, formatting and documentation IDs. Earlier screenshots
and hashes above remain evidence of their original checkpoint, not publication
of this combined build.
