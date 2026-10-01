# Covered double-bed runtime evidence

Observed 2026-10-01 on the Windows development host, based on `bf1f8377` plus the covered-bed runtime changes delivered with this record. The approved export manifest has SHA-256 `0c9b1c854d2a74993b1d3e9fb9297e75c4fa5ca59762daa531c363d57acca2cb`. The atlas has SHA-256 `2b6b7ba9f3ea12f98ee2ae590b97b11da5fb8d0f36d6599a7b73b7cb6e298f6c`.

## Runtime checks

1. `cargo test --workspace`: PASS, exit 0. Core 109, data 273, data integration 1, simulation 791 and WebAssembly bridge 156 tests passed. `cargo clippy --workspace --all-targets -- -D warnings`: PASS, exit 0. `cargo fmt --all -- --check`: PASS. The earlier save compatibility evidence remains in [domestic-integration](domestic-integration/README.md).
2. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: PASS, exit 0. `npm --prefix web run typecheck`: PASS, exit 0. `npm --prefix web test -- --maxWorkers=1`: PASS, exit 0, 1,797 tests in 123 files.
3. `python -m unittest discover -s assets/sprites/gen -p test_covered_bed.py`: PASS, exit 0, four importer tests. The prefix receipt compares every original sprite's cropped pixels, dimensions and registration against released `fd75b9c2`; all 1,700 remain identical. Atlas coordinates may move during packing.
4. The browser proof uses the production `SpriteRenderer`, atlas and shader on the graphics processing unit (GPU). Its independent Python reference starts with original export images. All 64 scenes pass at zooms 0.73 and 1.37, with default and strong furniture colour changes: 256 cases, 732,052 stable pixels, maximum channel error 2/255 and maximum 95th-percentile error 1/255. Reference pixels within 0.012 of the alpha-test boundary are excluded from that image comparison; the separate numeric control tests alpha composition directly. There are no GPU validation errors.
5. All 240 legacy interaction pairs, one ordinary Sim and one floor produce byte-identical native frames against the released shader. This comparison uses the same current atlas, whose original sprite prefix is independently pinned.

## Deliberate failures

1. Removing the second logical sleeper, swapping physical places, clamping CPU alpha before filtering, and using the logical row instead of the actual shared draw row each fail the bed tests. Each source file is restored byte-for-byte and the nine bed tests pass after each restoration. See `covered-bed-runtime/web-mutations.json` and the named failure logs.
2. Removing the authored sleep projection fails the native exact-activity assertion: actual `(5, 0)` instead of `(5, 9)`. The restored test passes. See `covered-bed-runtime/native-mutation.json`.
3. Omitting the second GPU body, adding shared ink twice and recolouring the whole scene fail image comparisons with maximum channel errors 188, 59 and 175 respectively. Clamping summed alpha before division survives the real-art comparison, so that comparison does not prove the denominator. A controlled texture through the production shader catches it: the mutant renders `[79,79,79,255]` instead of `[64,64,64,255]`; the restored shader renders the expected result. All shader changes are restored byte-for-byte to SHA-256 `75b80cf09c29cb4a18150c5160418b8eecef60d59dcb412efefa87c13c1f1b64`.

## Played game

The task-owned localhost save uses public simulation commands and an empty save slot. An independently reviewed placement at `(17,8)` supports both approach routes in all four facings; guessed positions were rejected by placement or routing rather than bypassed.

1. The actual game shows two covered sleepers and distinct sleeping bubbles. Clicking each visible head selects its own Sim. Both assignment owners and current occupants appear in Sim details.
2. Clearing and restoring one assignment while both Sims sleep leaves both actions intact. Clearing one Sim's orders removes that sleeper while the other remains asleep. Loading the saved game restores both sleepers and their assignments.
3. Assignment controls remain usable at 390 by 844 and 320 by 568. Keyboard focus reaches Clear assignment on the short phone. The document has no horizontal overflow at widths 320 and 800. Screenshots retain desktop, phone, one-sleeper departure and restored-load views. The game is muted and task-owned pages are closed after verification.

The reference generator is [make-covered-bed-gpu-reference.py](make-covered-bed-gpu-reference.py). Run it from the repository root, start Vite from `web`, then open `/proofs/covered-bed.html`. The generated reference is ignored and is not a production asset. `/proofs/covered-bed-sum.html` runs the alpha denominator control. `/proofs/covered-bed-played.html` prepares an isolated test save only when its origin's slot is empty. These checks establish local runtime behavior; deployment is verified separately after merge.

## Final integration checks

The release integrates main `93968a17` and export clarification `f7e74963`. The main change affects the changelog, its writing rules and presentation, rather than game simulation. The sleeping-place note is consolidated into the existing October 1 entry as those rules require.

1. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: PASS, exit 0, 130 tests. Its first run found missing physical-layer padding bounds and a furniture-only assumption in the composite alias check. The generator now adds bounds after importing layers; the test independently unions physical layer alpha support. The original failure and restored pass logs are retained.
2. `python assets/sprites/gen/build.py --check`: PASS, exit 0, 1,833 sprites at 8,192 by 6,096. All six model test groups from CI pass with exit 0, as recorded in the model log.
3. `npm --prefix web run typecheck`: PASS, exit 0. The full web suite after main integration passes again: 1,797 tests in 123 files. `node --test scripts/build-changelog.test.mjs`: PASS, exit 0, 12 tests. `node scripts/build-changelog.mjs` and `npm --prefix web run build`: PASS, exit 0. The existing large-chunk advisory remains; it is not a build failure.
4. `python check-doc-ids.py` and `git diff --check`: PASS, exit 0. Independent adversarial source review recommends release after the full Python suite; that suite has passed. The GPU and atlas hashes remain unchanged after the bounds metadata correction. The generated notes show the new sleeping-place controls with no horizontal overflow on the short phone.
