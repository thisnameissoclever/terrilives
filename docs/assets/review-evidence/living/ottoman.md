# Ottoman visual acceptance

Replace the small procedural ottoman with four views of one editable model.
Preserve persistence ID `sofa`, entity 18 at (12, 3), its one-tile footprint,
price 200, two interaction slots and existing fun/comfort effects. Do not
change `long_sofa`, the approved Sims or furniture placements.

## Source evidence

1. Candidate 01 retains the square teal cushion, central covered button and
   four wooden feet. Primary and independent review accepted all four
   768x960 RGBA originals and the reduced board. Subjective independent score:
   94/100, not a calibrated measurement or owner approval.
2. `surface-contact-proof-02.json` proves eight closed connected solids, four
   grounded feet and seven evaluated-surface support contacts. All 132 welt
   sections meet the cushion; maximum center-to-surface distance is 0.001
   against a 0.003 tube radius. Nine damaged copies and five deleted guards
   fail for their recorded reasons, including a seam with one floating section.
   Independent review prompted an explicit prohibition on welt modifiers,
   so base-mesh samples cannot misrepresent a deformed surface.
3. Model SHA256:
   `85d3155043bd11bb713fef3b8bfa516686c48448050a48eceb37057080a6f65b`.
   Canonical proof:
   `af10c666ee106d2265e7b27bd19f26e5cef10a0def5fb5bb8bd77aae9d62e61e`.
4. The unchanged exporter uses the approved Sim's camera, lights and material
   family. Textures reduce to 192x240 at density 2 on a 96x120 logical canvas.
   Symmetric facings are expected. No image repainting or runtime 3D is added.

## Runtime evidence

1. The isolated GPU proof passes 15 scenes: four facings under neutral and
   midnight lighting, five colourways restored from saves, Build preview and
   target-bound generic use. `ottoman-gpu.json` records the first active action
   as `Sit down: Chesterfield Regret`, activity 7, visual action 0 and no authored
   interaction target. The Sim stands beside the object. This is preserved
   behaviour, not seated-animation proof.
2. Production Build controls committed SW, NW, NE and SE at tick zero. No move
   was refused. The restored save SHA256 is
   `42fab5da88a2814585c1da9364a28f4f9f17239ea039e2dabf20629a0c238fa9`;
   world hash is `4442369640752043036`, both identical to the starting values.
3. Through the production UI, selected Tim, right-clicked the ottoman and chose
   Sit down. Natural 3x playback reached the target-bound generic action at tick
   14, with Tim at (12, 2). The screenshot clock shows 00:13 because the HUD
   refresh trails the simulation sample. No hidden state writes were used.
4. Primary and independent review accepted the GPU, room, night and played
   captures. The ottoman remains grounded and legible beside the surrounding
   furniture, with no visible clipping. Acceptance covers the shown layout and
   tested states. No art revision was requested.
5. Local production resources: `index-C4hA3bCD.js`,
   `terri_wasm_bg-DY1c7lfP.wasm` and the atlas hash below. GPU validation, page
   errors and console errors are empty. Owned browser contexts closed in
   finally blocks; both owned preview servers were stopped.

## Save/render correction

The stronger colourway round-trip test exposed stale render data immediately
after a V5 load. Base restoration built the render buffer before V5 added colour
components. Native and raw-WASM reproduction confirmed that components were
correct while the render column was zero. The loader now refreshes the complete
candidate after restoring every V5 field, without ticking, consuming queued
commands or changing saved state. Native and WASM tests cover immediate colour
parity and preservation of a pending recolour command. The normal frame loop
previously concealed the mismatch by refreshing before drawing.

## Preservation

New records append at 1358..1361 in SE/NW/SW/NE order. The atlas has 1,362
records at 8192x4777, SHA256
`25e299e075239638790be2385e644abc9e6388b4d7b62e0aef658e93ecefa782`.
The prefix tests preserve all 1,358 previous decoded sprite crops, non-packing
fields and nine registration/interaction tables. Legacy ottoman records remain.

## Checks

Passed locally, each command exit 0:

1. `python -B -m unittest discover -s assets/models/living`: 31 tests.
2. `python -B -m unittest discover -s assets/sprites/gen`: 115 tests.
3. `python assets/sprites/gen/build.py --check`: fresh 1,362-record atlas.
4. `cargo test --workspace`: 1,214 tests across five nonempty suites.
5. `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
6. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
7. `npm --prefix web test`: 1,367 tests across 99 files.
8. `npm --prefix web run typecheck` and `npm --prefix web run build`.
9. `python check-doc-ids.py` and `git diff --check`.

Observed failing tests before implementation: missing layout, absent atlas
records and the native/WASM restored colour mismatch. Two proof assumptions
were corrected against source: action queue entries are strings, and the
instance buffer stores colour strength minus one. The browser menu's CSS
uppercase transformation required checking its text content rather than its
displayed capitalization. None required a gameplay change.

Staged-only export `e4a272eaa9def94aa0e4679558e9c235317cc401` passed atlas freshness,
all 115 sprite tests, 31 living-model tests, documentation IDs and exact
eight-input/four-render/model/atlas hashes without ignored originals. The
modifier prohibition and its passing Blender proof were added after that export;
neither changes the model, source render inputs, runtime code or atlas.
A deliberately changed pixel in preserved sprite 1357 made the prefix test fail;
no file was changed. Independent code review accepted the loader correction,
provenance, append-only integration and save-state preservation.

Source merge and public deployment must be reported separately. Duplicate remote
CI does not block merging this locally verified batch under the owner's delivery
instruction; a full remote mutation sweep remains additional evidence.
