# Household shirt verification

Implementation workspace: `D:/VIBES/.worktrees/terrilives/rigged-sim-animation`.
Requested colors: Tim blue, Bill unchanged green, Casey red. The owner approved
the shared character and authorized publication after these checks.

## Completed checks

1. `cargo test --workspace --locked -j 2 --quiet -- --test-threads=2` exited 0:
   66 core, 182 data, 325 simulation and 68 WebAssembly-boundary tests passed
   (641 total), with no ignored or filtered tests.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets --locked -j 2 -- -D warnings`
   both exited 0.
3. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`
   exited 0: 23 tests passed.
4. `python -B check-doc-ids.py` exited 0: documentation IDs are unique.
5. The SE/SW idle palette sheet passed direct and independent adversarial
   visual inspection. Blue and red retain collar, cuff, pocket and shaded
   fabric detail. Neither review found a visible identity or geometry change.
   A subsequent all-facing idle/walk/eat sheet retained the same identity and
   clean material boundaries. This is not acceptance of every furniture contact.
6. From `web`, `npx tsc --noEmit` and `npx vitest run --maxWorkers=1`
   exited 0: 534 tests across 37 files passed.
7. `python -B -m unittest discover -s assets/models/sims/sim-01 -p 'test_*.py'`
   exited 0: 21 model/export tests passed.
8. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
   and `npm --prefix web run build` exited 0. Production preview uses port 4173.

The Python suites, TypeScript check, all 534 web tests and production build
were repeated after the final bike correction and exited 0. Atlas generation
and `--check` also exited 0: 836 records, 1024 by 4596 pixels. Final atlas SHA-256:
`413a1b81f8c7cf09491a784dcd807519652f2bd7b27e450d286f35e53f121e25`.
CI now runs both Python suites before atlas reproducibility, using its existing
Pillow installation. No dependency manifests or lockfiles changed.

A disposable checkout exported from the final Git index also passed all 21
model tests, 23 sprite tests and atlas `--check`. This caught and corrected
newline conversion on the byte-hashed approved manifest and Windows-only
separators in preservation records. The manifest's raw and staged Git object
IDs now both equal `2312c3e533d882b45272d07b51c545f7d4ed2b99`.
Its approved SHA-256 was not changed to accommodate Git conversion.

## Importer mutation proof

Removed `or variant != expected_variant` from the production import guard.
The test supplies an otherwise-valid red export while requiring blue.
`python -B -m unittest test_offline_sims.ExportTests.test_rejects_wrong_or_unknown_shirt_variant`
from `assets/sprites/gen` exited 1 with `AssertionError: ValueError not raised`.
Restoring the guard restored all 23 passing tests. The production file's
SHA-256 before and after was
`a67b21df94c5318e8f903c46a2bc30c7f043df4c107230eb23c851b253f14508`.

The first mutation experiment exposed an invalid-name fixture that failed
for the wrong reason. The fixture was corrected to valid red names before
the causal experiment above. An error-message mismatch was not accepted as
proof that the palette guard prevented an otherwise-valid wrong export.

## Runtime mutation proofs

Each deliberate defect was applied separately, the focused test failed, and
the original production file was restored before the next experiment:

1. Map Tim to red instead of blue: three shirt tests failed (exit 1).
2. Drop persistent identity from held-food selection: expected X 183,
   received 213.815765 (exit 1).
3. Drop identity from picking: expected the target entity, received null
   at the palette-specific test boundary (exit 1).
4. Drop identity from bubble selection: expected Y 85, received 74 (exit 1).

The eight focused runtime tests passed after restoration. Before/after hashes
were identical: frame.ts
`e894d4c8f0f7583c3278582244133634ca9a1583bd1ac08710eef7fa89cbba78`,
input.ts `903a1dd9e361812b6bcfad0a1188b5ddbdfd0be06cd4bddfa70d00275d094e2b`.
The frame hash predates the intentional removal of the legacy exercise branch.
Actual palettes share geometry, so tests deliberately use distinct anchor
fixtures to expose missing identity arguments instead of passing accidentally.

## Played evidence

The owner authorized a dedicated headed Chrome game tab. Other tabs and
applications were not controlled. Save, advance and Load restored tick 159
with Tim/0 blue, Bill/1 green and Casey/2 red. The production build was also
played on port 4173 with flat lighting and audio muted in that test session.

Screenshots include Tim eating and then fed, Bill/Casey beginning and ending
a conversation, the original household palette check, reading, fish watching
and Casey cycling. Each filename identifies its scenario; screenshots are
real browser captures rather than offline composites.

The cycling review caught a new wall collision caused by moving the bars
forward. The correction restores their original horizontal extent and lowers
the assembly 25 pixels. The final production captures
`production-casey-cycling-close-final.png`,
`production-casey-cycling-pose2-final.png` and
`production-bike-unoccupied-final.png` show both occupied poses and the cleared
console after Casey dismounts. Direct and independent adversarial review passed.
The wall regression test
recreates the rejected forward shift, detects overlap `(216,158,232,178)`,
and confirms the corrected assembly has none. A small
rear-base floor overhang also appears in the pre-existing bike screenshot;
the base and Save V1 placement are unchanged in this batch.
The console has no modeled three-dimensional surface; its occupied occlusion
uses the established bike-before-body layer. Physical console depth is not
claimed. The saved hand targets are outside the torso/head and match the grips
within 0.0003 native pixels. Non-SE bike contacts remain unaccepted.

## Publication

PR CI run `34511706992` passed native checks but timed out in the atlas's
generic Buffer equality assertion (533 other web tests passed). Replacing
recursive object comparison with exact `Buffer.equals` reduced the focused
local test from 2.8 seconds to 5 milliseconds. A one-byte in-memory mutation
failed with `expected false to be true` (exit 1); the mutation was removed.
No PNG, generated manifest, runtime behavior, or test timeout changed.

Publication completed on 2026-09-10. [PR checks](https://github.com/thisnameissoclever/terrilives/actions/runs/34514418696)
passed for `9e63f000785e5ab7b566b293e227994456ea598a`.
[PR #60](https://github.com/thisnameissoclever/terrilives/pull/60) merged as
`a3559cd44988cc5dbd1d2c5e54f2bbfd571d8f96`; both
[main CI](https://github.com/thisnameissoclever/terrilives/actions/runs/34519115566)
and [Pages deployment](https://github.com/thisnameissoclever/terrilives/actions/runs/34519324149)
passed for that exact revision. The live played check and served atlas hash
are recorded in the [release evidence](https://github.com/thisnameissoclever/terrilives/pull/60#issuecomment-5624190618).
Remaining furniture-contact defects above are not a pending publication gate
for that completed Sim release.
