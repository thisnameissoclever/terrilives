# Refrigerator room-fit correction

The owner reported that the published refrigerator faced the wrong direction
and was too small beside the kitchen counter. Both earlier reviewers missed
this. The historical acceptance is corrected in `README.md`.

## Cause and correction

1. `content/lot.toml` deliberately left the fridge at default SE while the
   other kitchen stations faced SW. Its doors faced the adjacent counter.
   The fridge now explicitly faces SW into the room.
2. The model was 0.76 wide and 1.62 tall beside a 1.0-wide, 0.86-high counter.
   Candidate 03 uniformly enlarges the physical model by 1.2, giving width
   0.912 and height 1.944. Camera, registration and logical quad size do not
   change. Actual handles reach 0.111 beyond the occupied tile's front edge.
3. Four existing fridge images are replaced. Every other decoded image through
   record 1104 is protected by a complement digest captured before replacement:
   `c360e7e68bab407603c36e3f49bb7e43a19cc4f6b1f9554a2abd6bc2a62d8d8d`.
   No Sim, interaction value, object identity or save schema changes.

## Visual and mechanical evidence

`fridge-room-fit-played.png` shows the whole household at Day 1, 03:28 with
Tim at the fridge. `fridge-room-fit-close.png` is the same paused state at
ordinary wheel zoom. Both primary and adversarial reviewers accepted the
door direction, relative width and height, floor contact, adjacent-counter
clearance and observed standing Sim fit. This is closed static acceptance,
not a guarantee of future door-opening or reaching animation clearance.

Ordinary UI selected Chill-o-Matic 3000 and Grab a snack. Tim reached Eating
at 03:27 and returned to Deciding what to do at 03:45 with hunger 73.4. The
two console errors were missing `favicon.ico` requests (404). The production
preview loaded `index-Cq0fXmPN.js` and `terri_wasm_bg-CZBq0qwH.wasm`.

The source batch is `assets/models/kitchen/owner-review-pending/refrigerator/candidate-03/`.
Independent review inspected all four originals and verified eight input
hashes, four image hashes, unchanged camera settings and saved-model hash.
Canonical proof SHA-256:
`f9093343b4774fa9cde6a498a9c5583f3a9aef15197d1cd5623dcfea755a4ad6`.
Saved model SHA-256:
`4bed8dfb3fb968725c99c8345ac5e17a4c75b45b5e487d867655ed17163a7b82`.

`room-fit-check.json` measures floor Z=0, 0.044 side clearance, height ratio
2.26 against the counter, and the hardware overhang. Scaled hinge transforms
pass at 0, 45 and 90 degrees. Resetting scale and raising the model each fail
their specific guard. A clean reload passes and preserves the model hash.
The old candidate fails the new width check. These Blender checks were run
by the primary agent; the reviewer inspected their code and retained report.

## Regression checks

All commands below passed with exit code 0:

| Command | Result |
| --- | --- |
| `cargo test --workspace --quiet` | 688 tests |
| `npm --prefix web test -- --maxWorkers=1` | 677 tests across 49 files |
| `npm --prefix web run typecheck` | PASS |
| WASM and Vite production builds | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 49 tests |
| `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'` | 14 tests |
| `python -B assets/sprites/gen/build.py --check` | 1,105 sprites, 4096x6258 |
| `python check-doc-ids.py` | PASS |
| `cargo fmt --all -- --check` | PASS |

The new compiled-placement test failed with SE index 1089 and passed with SW
index 1091. The save test initially exposed its old assumption that authored
and dynamic fridges share one facing. It now checks actual restored render
rows for authored SW and dynamic SE while retaining save-byte/world-hash
equality assertions. Existing saves reconstruct the current authored facing
at the unchanged fridge placement without a migration.

Atlas SHA-256:
`6b711ba6663c3b25582a72f186d464a9d027e6698f152d2e3c948ff4df415c5f`.
Publication must be recorded separately after merge and live verification.
