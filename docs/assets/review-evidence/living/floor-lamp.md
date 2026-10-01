# Floor lamp visual acceptance

## Scope

Replace the floor lamp's procedural drawing with four views rendered from
one editable model. Preserve `floor_lamp`, its name and price, saved entity
15 at (14, 2), one-tile footprint, colours and lack of interactions. Preserve
the existing room-light pool and whole-sprite emissive strength. No power
state, bulb simulation, gameplay change, dependency or paid request is added.

## Source and physical review

Source: `assets/models/living/lamp_layout.py`, `lamp_model.py` and
`render_lamp.py`. The approved Sim supplies the unchanged camera, lights and
material family. Candidate 02 lives in
`assets/models/living/owner-review-pending/floor-lamp/candidate-02`.
Its four 768x960 RGBA originals use 96x120 logical registration. The importer
reduces them to 192x240 textures at density 2; it does not repaint them.

1. Candidate 01 looked plausible but contained a degenerate wire edge and
   a stand through the bulb. Its evidence remains in `rejected/candidate-01`,
   with the rejection and subjective score in the object-level README.
2. Candidate 02 uses single axis vertices and a separate support around the
   bulb. Its shade is open at both ends. Recessed strut tips remove the small
   dark marks from the first render. Primary and independent source review
   accepted all four facings, smooth contours and reduced-size readability.
3. `check_lamp_scene.py` verifies the saved model, not just declared dimensions.
   It passed 13 closed meshes, 15 evaluated-solid contacts, a grounded base,
   five unobstructed shade rays and clearance between the bulb and stand.
4. Seven deliberately damaged scenes were rejected: lifted base, detached
   stem, shade, support or bulb, shifted root and capped shade. Deleting the
   ground, contact or opening guard broke that rejection proof. The clean
   source reloaded and retained its exact hash:
   `0eca9543ab2ba4c92b0b9b1d44341c5fe9dfd0e367372621f900fb7f7c9885a9`.
5. Independent review checked all eight input hashes, four render hashes,
   model hash and canonical catalogue proof digest against current files.
   These are targeted structural checks, not an exhaustive physical simulation.

## Runtime and played evidence

1. `floor-lamp-gpu.png` and its JSON record 14 actual WebGPU scenes: all four
   facings under neutral and midnight light, five colourways and a Build
   preview. Source strength remained 0.85 and the lamp tile's pool remained
   0.35, within Float32 representation. GPU validation and page errors were
   empty. The round lamp is intentionally similar across facings.
2. `floor-lamp-room.png` shows the production build at neutral lighting;
   `floor-lamp-night.png` shows automatic midnight lighting. The production
   page's DOM was not replaced by a proof board.
3. Actual Build controls committed SW, NW, NE and SE in order at tick zero.
   Every result identified entity 15 with no refusal. The full save bytes,
   world hash, tick, facing and colourway were identical after the cycle.
   Read-only observations used the existing stress handle, not injected
   simulation changes. `floor-lamp-played.json` retains the results.
4. Normal 3x playback then advanced to tick 241, Day 1 at 04:01, before a
   normal Pause click. `floor-lamp-played.png` shows that actual played room.
   The lamp has no interaction to animate. Primary and independent reviewers
   accepted its scale, grounded appearance, occlusion and nighttime rendering.
5. Production resources were `index-DNgAMbsA.js`,
   `terri_wasm_bg-BJWyACFk.wasm` and the atlas below. No page errors were
   recorded. Dedicated contexts closed in finally blocks; both task-owned
   Vite servers were stopped. No existing browser save was used.

## Preservation and local checks

Atlas: 1,350 records, 8192x4741. SHA256:
`734be515a3593bcada8f5f6d5e3f30a087213d34c2cbe43faae01330a29d3e2f`.
The four records append at 1346..1349, after the occupied armchair, through
`static-props-04.json`. All 1,346 earlier decoded sprites, non-packing records
and nine metadata tables remain unchanged. Their combined pixel/record digest:
`5bb69041d92d148d77878a4ee007148f8341ed0e42cccb46e14df30d1a8d2cf1`.
Independent comparison against the prior commit confirmed this preservation.
Parsed content differs only in the lamp's sprite field.

1. `python -B -m unittest discover -s assets/sprites/gen`: 109 passed, exit 0.
   Living-model suite: 25 passed, exit 0.
2. `cargo test --workspace`: 1,214 passed, exit 0. Rust format and clippy,
   release WebAssembly, TypeScript, Vite and documentation-ID checks passed.
3. Full web suite: 1,346 passed and one new test exposed a too-strict Float32
   expectation. After correcting that assertion, all six lamp tests passed.
   Together the full and focused runs cover 1,347 tests in 96 files. An earlier
   focused run also caught an invalid test-only wall accessor, which was fixed.
4. Restoring the obsolete lamp light prefix caused 20 failures in the lamp
   and lighting suites, including lost illumination in all four facings.
   Restoring production code passed all 28 focused tests. Exact source hash
   before and after the mutation:
   `2f7c89884b1f6ea7da586f8262991853648a57f8880b62e293bc7c7c1ef666a4`.
5. Deleting an earlier entry from each of nine metadata tables in memory
   caused its preservation test to fail. Altering historical crop pixels in
   memory also failed the pixel test. Both unmodified tests passed afterward;
   no artifact bytes were changed on disk.
6. Clean export of staged tree `7996a2b86fce59ec01835e62858a6f668f048b4a`
   passed atlas freshness, all 109 sprite tests and 25 living-model tests.
   All eight input hashes, four renders and the saved model also match in
   that export. Ignored scratch files are not required.

The first browser helper failures were verifier defects, not accepted game
defects: blocked modal clicks, a suppressed original preview row and an
invented clock accessor. Fresh-context review checked the actual controls
before the successful production pass. The architecture document now also
describes the mixed procedural/offline atlas and elapsed-time speed correctly.

Source merge, remote CI and public deployment remain separate release facts.
Local acceptance does not prove GitHub Pages is serving this revision.
