# Potted plant visual acceptance

Replace the old screen-space foliage with four views of one editable broad-leaf
plant. Keep `potted_plant`, its name, price 30, no interactions, one-tile footprint
and entities 13 at (15, 0) and 28 at (10, 11). No layout, save schema, gameplay,
lighting policy, dependency or paid-service changes are included.

## Source evidence

1. Candidate 01 was rejected for soil floating inside the planter. Its original
   scripts, model, four renders and failed checks are retained in the object's
   `rejected/candidate-01` folder. Candidate 02 fits a tapered soil volume to
   the planter and leaves the foliage unchanged.
2. Primary and independent review accepted all four 768x960 RGBA originals and
   their reduced board. Muted greens, terracotta and smooth outlines fit the
   accepted furniture. Subjective independent score: 93/100, not owner approval
   or a calibrated measurement. Central stems merge slightly at small sizes.
3. `candidate-02/scene-check-03.json` proves 21 closed connected parts and 20
   surface contacts, a clear planter opening and grounded soil within the
   evaluated convex outer shell. Seven damaged copies and five deleted guards
   fail for the recorded reasons. Soil containment was added after independent
   review; a displaced soil volume can remain supported yet protrude outside.
4. All eight input hashes, four render hashes and model hash match. Model:
   `566bcf2d16e19ba14a6760bc125c41bd5299c98b7f0eba7c94d86c1a83a0f986`.
   Canonical proof:
   `a85664527ed38b04d809fef1d7c06e257b94147d1eb805e7e9e2ab0c28828f25`.
5. The unchanged exporter supplies the approved Sim's camera and materials.
   Original renders are reduced to 192x240 at density 2, on a 96x120 logical
   canvas. No image repainting, runtime 3D or new animation is introduced.

## Runtime evidence

1. `potted-plant-gpu.png` and its JSON contain 14 actual GPU scenes: four facings
   under neutral and midnight lighting, five colourways and a Build preview.
   GPU validation and page errors are empty. Source emission is zero; the
   fixture receives 0.1199999973 room light. Existing whole-sprite colourways
   still recolour the pot and leaves together.
2. The proof identifies entity 13's row, or its appended preview body, and checks
   that entity 28 is untouched. Sprite-only lookup would confuse the two plants.
   Tests cover both entities' facings, footprint, colour independence, picking,
   preview suppression and save/load.
3. Production Build controls committed SW, NW, NE and SE independently for both
   plants at tick zero with no refusal. The paused save SHA256 returned to
   `4126d07e3a4650acb70c43945c18e22151d16184121d74671fc81ad55a115a07`;
   world hash returned to `14358444542929377430`. No hidden state writes were
   used in this played check. JSON retains each placement and result.
4. Natural 3x playback reached tick 241, Day 1 at 04:01. The room, night and
   played screenshots show both original placements. Low walls partly cover
   the bottoms of the pots; their foliage remains visible. The isolated GPU
   views show the complete pots without atlas clipping.
5. Local production resources: `index-DrbD9DS_.js`,
   `terri_wasm_bg-BuQVIoIE.wasm` and atlas
   `398b58facd5c78ce2c43a88d8e2a43fb49e85ea39131163af00a8b4f5be3a545`.
   Browser and console errors were empty. Owned contexts closed in finally
   blocks, and both task-owned preview servers were stopped.
6. Independent visual review accepted the GPU, room, night and played captures.
   The pot occlusion follows the short wall edges rather than the sprite bounds.
   Acceptance covers the shown placements and tested states, not every possible
   furniture arrangement. No runtime art revision was requested.

## Preservation and checks

The atlas has 1,358 records at 8192x4764. New records append at 1354..1357 in
SE/NW/SW/NE order. All 1,354 prior decoded sprite crops, non-packing fields and
nine registration/interaction tables are unchanged. Legacy plant records stay
available; only the content sprite reference and two Rust expectations change.

Passed locally, each command exit 0:

1. `python -B -m unittest discover -s assets/models/living`: 29 tests.
2. `python -B -m unittest discover -s assets/sprites/gen`: 113 tests.
3. `python assets/sprites/gen/build.py --check`: fresh 1,358-record atlas.
4. `cargo test --workspace`: 1,214 tests across the five nonempty suites.
5. `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
6. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
7. `npm --prefix web test`: 1,360 tests across 98 files.
8. `npm --prefix web run typecheck` and `npm --prefix web run build`.

New tests were observed failing before their implementation: missing layout
functions, absent atlas records and missing WASM sprite mapping. The preview
test initially assumed an invalid sprite number; source inspection corrected
it to the renderer's actual off-screen suppressed-row contract.

Staged-only export `6c356649ed0732d8349e629c0e96788680f59058` passed atlas freshness,
all 113 sprite tests, all 29 living-model tests, documentation IDs and exact
eight-input/four-render/model hash validation without ignored originals. Only
this receipt paragraph was added afterward. A deliberately changed pixel in
the last preserved sprite (1353) made the prefix test fail; unmodified data
then passed. Whitespace checking also passed. Independent code review accepted
the final containment guard, provenance, two-instance handling and receipt.

Source, GPU and local played evidence do not prove a public deployment. Record
merge and deployment status separately; do not wait for duplicate remote tests
after this locally verified batch is authorized for merge.
