# Coat rack visual acceptance

Replace the old polygon drawing with four registered views of one wooden
stand and supported teal drape. Preserve `coat_rack`, name, price 35, entity
14 at (15, 1), one-tile footprint, colourways and lack of interactions.
No gameplay, save schema, dependency or paid provider changes are included.

## Source acceptance

1. Candidate 01 is retained under the object's `rejected` folder. Independent
   review caught a 90 degree mismatch between its crossbar and the old SE
   direction. Candidate 02 bakes the correction into child geometry while
   keeping the root and saved facing values unchanged.
2. Primary and independent visual review accepted all four 768x960 RGBA
   originals and the reduced board: continuous wooden construction, smooth
   contours, plausible fold and consistent material/occlusion. Subjective
   source correctness: 95/100. This is not owner review or a calibrated score.
3. The approved Sim supplies unchanged camera, lights and toon materials.
   The importer reduces originals to 192x240 textures at density 2 on a
   96x120 logical canvas. No pixel repainting or cloth simulation was used.
4. `candidate-02/scene-check-03.json` passes eight closed parts, seven wooden
   contacts, six fabric support samples with measured gap zero, a single
   connected fabric component, full fold support and upright clearance.
   Minimum fabric radius is 0.0199999214 around the 0.02-radius rail.
5. Nine damaged scene copies and five deleted guards fail as intended.
   Independent code review checked the added edge-support and connectivity
   guards, provenance and unchanged model bytes. The first two checker runs
   exposed a floating-point seam at the upright/base joint; evaluated
   surface-distance checking repaired the verifier without changing art.
6. Saved model SHA256:
   `75e4496205ea976efd3336e07fd1bf765dc61807c6161254176feda531d42b49`.
   Canonical render proof digest:
   `a58bd9b333f07152c36d014aa15c9a6d3b5901563e2f73ed7332817cd9782dd4`.
   All eight input hashes and four rendered-file hashes match current files.

## Runtime and played evidence

1. `coat-rack-gpu.png` shows 14 actual WebGPU scenes: four facings under neutral
   and midnight lighting, five colourways and a Build preview. GPU validation
   and page errors are empty. Source emission remains zero; received room
   light is 0.1199999973. The initial proof wrongly equated received light
   with emission; it was corrected against the actual frame writer.
2. Production Build controls committed SW, NW, NE and SE at tick zero, all
   with object 14 and no refusal. Save SHA256, world hash, tick, colourway
   and facing returned exactly to the initial values. The JSON record holds
   these read-only observations; no hidden simulation writes were used.
3. Normal 3x playback reached tick 241, Day 1 at 04:01. The room, night and
   played screenshots retain the existing furniture layout. The rack has no
   action to animate. Its lower portion remains behind the exterior door at
   the saved location; the isolated board establishes the complete silhouette.
4. Production resources: `index-DdD-YaQD.js`, `terri_wasm_bg-DucfSu6R.wasm`
   and the atlas below. No page errors. Owned browser contexts closed in
   finally blocks; both task-owned preview servers were stopped.
5. Independent review accepted the GPU board and actual room, night and played
   captures. The shown scale, materials and door occlusion are coherent.
   This does not prove every possible neighbour overlap or door state.

## Preservation and checks

Atlas: 1,354 records, 8192x4749. SHA256:
`7db5617af8b9ead864546355f9b23c4fffee8809faa0afe34f10d7c87e429049`.
The four records append at 1350..1353. All 1,350 earlier decoded sprite crops,
non-packing records and nine metadata tables remain unchanged. Prefix digest:
`1009056971762c537c044fda941938285e8661d038650059866905e7d60c4bd8`.
Independent in-memory damage to each metadata table and a byte in sprite
1349 fails preservation checking. Parsed object content changes only the
rack's sprite field; older procedural records remain in the atlas.

1. Living-model tests: 26 passed. Sprite tests: 111 passed. Exit 0 for both.
2. Full web suite: 1,353 passed in 97 files, exit 0. Its six new tests first
   failed on the absent replacement sprite, then passed after integration.
3. Rust workspace run passed core 106, data 267, integration 1 and sim 692
   tests, with one stale expected rack sprite failing. Updating that literal
   from 26 to 1350 passed the targeted test. The subsequently run WASM suite
   passed 147 tests. These runs cover all 1,214 tests, not one all-green run.
4. Rust format, clippy, release WebAssembly, TypeScript and Vite passed.
   The only Rust source edit is the test expectation and its comment.
5. Clean index export `11a63d35646ccbda9a6a0222bf33cfe660c731e0` passed atlas
   freshness, all 111 sprite tests and 26 living-model tests. All eight source
   inputs, four renders and the model match their hashes in that export.
   Ignored local originals and scratch files are not required. Documentation
   IDs, prose scans and whitespace checks also passed.

Source merge, CI and public deployment are separate release facts. These
local results do not establish what GitHub Pages currently serves.
