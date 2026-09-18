# Counter and kitchen sink static replacements

Reviewed 2026-09-17. Primary and adversarial review accepted both candidate-01
groups under the owner's delegated review policy. This is local production
build evidence, not a published deployment or new interaction animation.

## Visual and played evidence

1. `counter-sink-four-facing-gpu.png` shows the actual SpriteRenderer at 2x
   zoom: counter above, sink below, each in SE, NW, SW and NE order. Indices
   are 1097 through 1104. The running fixture returned a null GPU validation
   error and an empty uncaptured-error list. The screenshot establishes
   appearance, not those error-scope results.
2. `counter-prep-played.png` shows Tim beside the counter at Day 1, 01:12,
   during `Cook dinner - step: Prepare food (carrying ingredients)`. The
   production bundle was `index-Bk-_b6ZX.js`. After ordinary menu selection
   and 1x play, the chain reached Eat dinner at 02:24 and returned to
   `Deciding what to do` at 03:24, with hunger and comfort both 100.
3. `sink-wash-played.png` shows Casey at the kitchen sink at 10:57, with the
   ordinary `Using object` HUD status. After selecting Casey, clearing orders,
   leaving Queue off and choosing `Wash the dishes` from `Basin, Communal`,
   Casey approached the sink. Hygiene read 71.3 at 10:57 and 81.0 at 11:09.
   At 11:11 Casey was Walking with hygiene 81.7. These HUD readings prove
   observed use and improvement, not an exact uninterrupted 23-tick action.
4. Both reviewers inspected the played images and found no blocking scale,
   counter-height, placement or occlusion defect. The eight-facing fixture
   received the same acceptance. Subjective source scores remain counter
   92/100 and sink 90/100. No water, dish props or hand-motion clip is claimed.

The first sink wait incorrectly expected the menu label in the HUD. The next
attempt used Tim after his 06:00 work departure, so the order was deferred.
Source review identified both errors before the successful Casey check. The
initial timeout does not prove that Tim failed to use the sink. Only the
task-owned verification household and tabs were used; all its tabs were closed.

## Source and regression evidence

Atlas: 1,105 sprites, 4096x6258, SHA256
`15a3388c69d904b1e3440d61dc680cfe87c8c42ce39132205dcd5a1d342f913a`.
Content changes only `counter.sprite` and `kitchen_sink.sprite`. Placement,
footprints, roles, interaction values, save format and accepted Sims remain
unchanged. Generated atlas coordinates move during packing; prefix tests
compare decoded pixels and record identity rather than packed positions.

1. `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'`:
   14 tests, PASS, exit 0. New mesh tests were observed failing before
   implementation and passing afterward. CI now runs this authoring suite.
2. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`:
   49 tests, PASS, exit 0. Prefix checks preserve 1,089, 1,093 and 1,097 prior
   records and decoded pixels, including the refrigerator and stove.
3. `npm --prefix web test -- --maxWorkers=1`: 677 tests in 49 files, PASS,
   exit 0. Counter/sink picking tests first failed because the records were
   absent; all six kitchen tests passed after atlas generation. They check
   indices, density, anchors, visible-content hits and empty-margin misses.
4. `cargo test --workspace --quiet`: 687 tests, PASS, exit 0. Typecheck,
   `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
   and `npm --prefix web run build` also passed with exit 0.
5. `python -B assets/sprites/gen/build.py --check` and
   `python -B check-doc-ids.py`: PASS, exit 0. The loader mutation runner caught
   all five intended corruptions, preserved source bytes and passed its nine
   ordinary tests afterward.
6. Saved-model checks passed for both candidates. The sink probe initially
   caught four corruptions. Adversarial review exposed a floating-drain gap in
   the bounding-box check; `scene-probes-drain-red.json` records the surviving
   mutation. Surface rays replaced that claim of support. The final
   `scene-probes-contact-green.json` catches seven exact-error corruptions,
   reloads a passing clean scene and verifies the saved model hash is unchanged.
   These Blender results come from the generated JSON, not launcher exit codes.

The source notes retain the drain's near-rim projection in all four views and
broad bowl shading. Neither reviewer considered them blocking. Surface-item
placement and interaction-specific animation remain separate work.
