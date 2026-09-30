# Desk chair verification

Candidate 03 replaces only the `desk_chair` sprite mapping. The existing
one-tile footprint, NW facing, placement (6,7), price 60, save identity and
absence of interactions are unchanged. No Sim, rig, desk, collision rule or
save-format change is included.

## Source review

The editable model, four original 768x960 RGBA renders, review sheet, input
hashes and mechanical check are in
`assets/models/office/owner-review-pending/office-chair/candidate-03/`.
Primary and independent reviewers accepted the static source at a subjective
92/100. The chair has slate upholstery, a charcoal shell and a five-spoke base
with paired casters. All four views are rotations of one model, not mirrors.

Candidate 01 is retained and rejected for a back support breaking through the
rear shell. Its source layout test failed at rear extent 0.29485 versus maximum
0.28. The recessed support now has 0.010059 clearance behind the covering face.
The saved-scene validator passes 34 parts, 33 solid-overlap contacts and ten
grounded wheels. Six deliberate mutations fail for their intended reasons;
the original saved-model hash is unchanged after clean reload. Attachment
checks alone had missed the visible breakthrough; the added clearance guard
detects it in the original candidate too.

Candidate 02 was also rejected: source shape review passed, but its NW image
faced sideways to the desk. The replacement had a different base front direction
from the old chair. Candidate 03 bakes a -90 degree turn into all parts while
leaving the shared export rotations and every saved facing value unchanged.
Its actual seat-to-back vector now gives game directions SE=+Y, NW=-Y, SW=-X,
NE=+X under the four standard rotations. The new unit test fails on candidate
02 with SE X=1 instead of 0; the saved-scene checker rejects that original
model with `Physical front mismatch: SE`. The independent reviewer also restored
the former orientation in memory and observed the intended test failure.

## Runtime review

1. [Four-facing GPU sheet](chair-four-facing-gpu.png) uses the actual
   `SpriteRenderer` at 2x zoom, ordered SE, NW, SW, NE. The harness is
   `web/proofs/office-chair.js`, callable from the isolated `/proofs/` page.
   Validation returned null; uncaptured GPU errors were empty. All four
   textures use the same floor registration and density 2.
2. [Room overview](chair-room.png) and [closer room view](chair-played.png)
   show the production build with neutral lighting at Day 1, 00:00. The chair
   faces the desk's working edge and its wheels rest on the floor. Primary
   and independent review accepted the corrected runtime visuals at 92/100,
   with no clipping, unsupported pieces or style mismatch. The reviewer confirmed
   the physical front points toward the desk opening, not merely that it is NW.
3. A normal click on the visible chair in Build mode picked object 24. Controls
   cycled NW -> NE -> SE -> SW -> NW and confirmed the unchanged position.
   World hash `8851935318653561696`
   stayed unchanged. No page errors occurred. The first browser check waited
   for Confirm to become enabled after success; success correctly clears the
   selection and disables that button. The corrected check waited for
   `Furniture placed.` instead. No application change was needed.
4. Production resources were `index-BQY_y9xV.js`,
   `terri_wasm_bg-B2Bs8fu3.wasm` and the content-addressed atlas below. Tests used
   disposable browser contexts, not the owner's save. Each context closed in
   `finally`, including the timed-out first check.

The actual-WASM regression checks the lot's sprite, position, footprint,
price, all four placement previews and save round-trip. It failed against the
old binary with sprite 299 instead of 1247, then passed after rebuilding the
content mapping. This is current-save round-trip coverage, not an additional
old-save migration claim. The unchanged migration tests also pass.

This is static chair art, not a new seated Work, rolling or swivel animation.
The desk still uses its existing standing interaction. An unoccupied chair
beside the desk and its seat height do not establish occupied knee clearance.

## Atlas preservation and local checks

The four new records are 1246 through 1249, physical 192x240, logical 96x120.
All 1,246 preceding records preserve names, indices, dimensions, density and
exact decoded pixels. The prefix digest is
`8e68ba22a49d0c01e3bfc4886ba6f01e22d9d8360a94c5dfcc9c84924c75b731`.
Only packing X/Y changes. The new tail catalog follows the cutaway-wall records;
adding this chair to the earlier static batch would have renumbered them.

Atlas: 1,250 records, 4096x8007 pixels. SHA-256:
`88e5d3803df947e81c383515277cf7ebcce5de5ac30cb2321519f2b2108b8593`.

Commands passed with exit code 0:

1. `cargo test --workspace --quiet`: 1,197 tests. The two historical chair
   index assertions now expect 1247; all position and footprint assertions
   remain intact. The initial run caught each stale 299 assertion.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -- -D warnings`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --release`.
4. `npm --prefix web test -- --maxWorkers=1`: 1,252 tests across 89 files.
5. `npm --prefix web run typecheck` and `npm --prefix web run build`.
6. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 89 tests.
7. `python -B -m unittest discover -s assets/models/office -p 'test_*.py'`: 8 tests.

The final orientation correction changed source art and the web texture binding,
not Rust code, object mapping or `atlas.toml` bytes. The existing rebuilt WASM
therefore remains current. The full web suite, typecheck, production build and
sprite suite were rerun against candidate 03. The Rust checks did not need an
identical second run.

The staged tree was exported with `git archive` and extracted into a separate
local directory. Atlas freshness, all 89 sprite tests and all eight office
tests passed there, exit 0, without ignored candidates or workspace scratch
files. The first attempt started before extraction finished and could not
find the script; that invocation is not test evidence. Documentation IDs and
the final diff check also pass. Task-owned preview servers were stopped.

These are local checks, not a claim that remote CI or Pages has completed.
The local mutations are targeted model and mapping checks, not the full remote
Rust mutation sweep. Per the owner's delivery rule, duplicate remote checks
do not delay merge after the relevant local checks pass.
