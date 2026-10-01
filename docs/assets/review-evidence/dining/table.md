# Dining table replacement

Candidate 01 replaces the procedural dining table with four renders of one
editable oak model. The table keeps its ID, price 120, SE base facing, 2x1
base footprint, saved placement and both interaction slots. Only its sprite
mapping changes. Source and runtime review do not establish seated eating or
table-resting dishes.

## Source and registration

The model has four equal legs, four aprons and one rounded top, with the same
oak material values as the accepted dining chair. Top height is .79; chair
seat height remains .535. All four source views are 1280x1408 RGBA with padded
silhouettes. The unchanged wide exporter preserves the Sim's camera, lighting
and toon materials. No provider requests, new dependencies or pixel repairs
were used.

The centered model is long along local Y. SE/NW span game X over 2x1 tiles;
SW/NE span game Y over 1x2. Runtime centers are (2.5,3) and (2,3.5) respectively
when placed at the original origin (2,3). No model offset or base-facing change
is needed. Four new records occupy indices 1254-1257 in SE/NW/SW/NE order,
with 320x352 textures, density 2, 160x176 logical size and anchor
(80,144.0004375).

Source: `assets/models/dining/owner-review-pending/dining-table/candidate-01`.
Model SHA-256: `5fa0a9091151a7ab7570e8da7ba5307ea52dcd40b539418c239af921f15c1e99`.
Canonical proof SHA-256: `aebd743ba6415a60ad04948d1a6d1ebd07b9cba39ad73d8dc6221d51fc986b33`.

The existing packer selected 8192x4128 for 1,258 records. This remains within
the renderer's existing 8192 limit, without reducing source or texture quality.
Atlas SHA-256: `3099b3621579b21b7ef5b77c5e3f3b2135666d0203ce4c1a5889ea134af3943c`.
All 1,254 preceding names, dimensions, densities and decoded RGBA sprites are
unchanged; their ordered digest is
`646e4dc2a7e3d403505234661cdc9d5c9713bb014db0a66ae027e80303590946`.
Atlas coordinates changed during packing, so the generated metadata diff is
large despite the unchanged earlier art.

## Review and negative checks

Primary review inspected all four originals and the reduced board. Independent
source review accepted the candidate at 93/100, a subjective score. The far
leg is physically present and correctly concealed by the tabletop. Aprons are
also mostly concealed; no part was moved merely to expose it to the camera.

Saved evaluated geometry verifies 16 solid-overlap contacts, four floor contacts,
equal leg dimensions, top height and all four physical spans. Eight damaged
copies are rejected: lifted leg, detached long apron, detached end apron,
detached top, quarter-turned source basis, missing leg, widened leg and a leg
protruding through the tabletop. The saved clean model reloads unchanged.
`scene-check.json` retains the initial six-case result;
`scene-check-strict.json` records the strengthened eight-case result.

Independent in-memory review caught 13 layout mutations and five prefix
mutations. It found two initial omissions: grounded/contact checks alone let
an oversized leg pass, and a picking probe above the entire image did not test
internal blank padding. Both are corrected, with deliberate bad cases shown
to fail. The lessons file records the cause and prevention.

## Runtime evidence

`table-four-facing-gpu.png` uses actual WASM placement through the real frame
builder and WebGPU, including rectangular footprint depth. All four rotations
passed GPU validation without errors. A terminal dinner was observed at tick
1133: Tim, entity 34, at (2,2), carrying dinner, visual action EAT. Plate and
hands remain visible above the table. The meal follows Sim hand anchors, not
a hard-coded table surface height. Independent GPU review accepted it at 93/100.

`table-room.png` and `table-played.png` show the production build after bringing
in main `cdcb390f`, including the compact controls and conversation-audio fixes.
Bundle: `index-CBIvuxM-.js`; WASM: `terri_wasm_bg-CSeP3qBu.wasm`.
The actual Build controls selected table 7, rotated through all four valid
facings, and confirmed its original SE placement. The paused world hash stayed
`9007575744255697436` before and after. No page errors were observed. Test-owned
browser contexts were closed; another task's proof context was left untouched.
Independent final room review accepted the batch at 93/100: scale, chair
clearance, grounding, material match and readability passed, with no blocker.

A second capture requested solely to tidy the isolated board's labels stalled.
Its owned context was closed and the tool wait terminated. The earlier successful
GPU capture remains the evidence; the subsequent production-room check completed.

## Verification

All commands below exited 0. Tests establish the stated behavior, not visual
approval by themselves.

1. `cargo test --workspace --quiet`: 1,208 tests passed. No Rust source changed
   afterward; upstream integration changed only web behavior and documentation.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -- -D warnings`: passed.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --release`: passed.
4. `npm --prefix web test -- --maxWorkers=1`: 1,289 tests in 92 files passed
   after upstream integration. The six table tests cover registration, padding,
   default placement, all four actual rotations and save/load.
5. `npm --prefix web run typecheck` and `npm --prefix web run build`: passed
   after upstream integration.
6. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`:
   91 tests passed, including exact earlier-sprite preservation.
7. `python -B -m unittest discover -s assets/models/dining`: eight tests passed.
8. Source board validation, saved-scene validation, documentation IDs and
   whitespace checks passed.

A clean archive of staged tree `cf6d3870944fe10184946ab695e6a00668657ef2`
also passed the fresh atlas check, all 91 sprite tests and all eight dining
tests without ignored sources. Only this evidence paragraph was added afterward.

Publication of this table batch is recorded in its pull request, separately
from these local checks. The preceding dining-chair release at `7b23f9c0` was
verified live on 2026-09-30: main CI 36788089140 and Pages 36788511892 succeeded,
including `actions/deploy-pages@v4`; the public entrypoint was
`index-9nkw0Y4Q.js`. Its atlas returned HTTP 200 with exact SHA-256
`517df8095e60b058dc9b4abb438a2e68fbd106a7b3ce417d2d38c49496c9f3ac`.
