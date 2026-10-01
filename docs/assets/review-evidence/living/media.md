# Television and radio visual replacement

## Scope and source

Replace the television and radio art with eight registered renders. IDs,
prices, positions, 1x1 footprints, saved facings, interaction slots, action
durations and effects are unchanged. Only their content sprite fields and
the TV's lighting-prefix lookup change at runtime.

Both physical fronts are local -Y. The existing camera/export rotations map
that to SE game +X, SW +Y, NW -X and NE -Y. Old radio art painted its controls
onto rear views; the new model uses proper rear occlusion instead.

Candidates live under `assets/models/living/owner-review-pending`, with one
subdirectory per object. Deterministic Blender 4.5.14 LTS, accepted Sim toon
materials and registered camera. No paid requests or new dependencies.
Four 768x960 RGBA originals per object become 192x240 textures on a 96x120
logical canvas. Origin: (48.000011,116.000437) logical pixels.

1. TV proof digest:
   `b96fe1c8a9fb2bbbf31e9856d50335ca1ed4bc0fb0b1c245b64f047cf34cf34d`.
   Model digest:
   `d98eef7a214ddaf32e3f0683b878749fe1048296588fed16efb62d8659545858`.
2. Radio proof digest:
   `b5da0c9ad702e23da13b4faa8c3b2afa2eddf9aaa3e4b7d8f8d16ac3cde9ff53`.
   Model digest:
   `03fb113af82a9795bd5fdaa6c8139564760c482d2b595e2ce1598f2293fecbdb`.
3. Primary and independent source review: TV 92/100, radio 91/100. Clear
   controls, grounded supports, real rear views, matching material treatment
   and no visible clipping. The radio's plain rear is less distinctive at
   small scale; its antenna remains legible.
4. Construction: 27 contact witnesses combined, four grounded feet per model,
   fixed centers/dimensions, cycle-free support paths and footprint clearance.
   Seven damaged copies per model must fail for their specific intended reason.
   Initial journals caught coordinate changes before testing contact. Independent
   review also found a floating cyclic assembly could fool the pure tests.
   Both proof gaps were corrected without altering the model or rendered art.
   Journal 03 records a checker-only error on an assertion without a message;
   the corrected guard-deletion helper and final checks are in journal 04.
   Both final journals passed, including four deliberately deleted guards
   combined. Each deleted guard makes its negative-test proof fail for using
   the wrong rejection reason. Clean saved models reload and retain their hashes.

## Rendering and played evidence

`media-four-facing-gpu.png` covers 24 actual WASM/GPU scenes: four facings,
five colourways, selected Build preview, midnight and the existing generic-use
action for each object. No synthetic furniture rows replace the simulation.
GPU validation and page-error lists were empty in the successful isolated proof.

`media-room.png` is the production build at normal room scale. `media-played.png`
shows the actual TV use in flat lighting. `media-night.png` is automatic lighting
at Day 1, 00:15. `media-day.png` is the same room after normal 3x play reaches
noon (captured at tick 721, displayed 12:00). Bundle `index-RmtGZlf5.js` and
WASM `terri_wasm_bg-DY0oLSKD.wasm` were fetched by the production preview.

Production Build controls committed SW, NW, NE and SE for both IDs 16 and 17,
with actual simulation-facing checks after each commit. Initial UI checks that
only rotated the preview were insufficient and are not the committed-facing
evidence. Clicking the rendered radio and TV started their existing actions.
Tim used the radio at tick 5 and TV at tick 15, activity 7. Acceptance required
the action at the front of the queue, not merely a matching queued string.
The GPU proof and unit tests confirm visual action 0 and no interaction target:
these are standing generic-use poses, not new listening/watching animations.

A separate settled production run drained UI commands before both state reads.
All eight rotations returned to the same tick 0, SE facings, colourway 0,
3,152 save bytes and world hash `17915876210895145737`. An earlier comparison
sampled pending UI commands and returned unequal hashes; it is not preservation
evidence. Independent isolated-WASM rotations likewise preserved their entire
save and world hash.

The TV keeps its existing always-on light profile (0.25,0.12,0.04) and 0.85
whole-sprite emissive strength in every facing. This is not a screen-only mask.
Radio intrinsic emissivity is zero; the neighboring TV contributes 0.04 to its
rendered location. Neither object has media audio or a power-state transition.

Independent runtime capture review passed at TV 92/100 and radio 91/100.
The reviewer inspected captures, not a separate live browser session. Existing
room arrangement remains imperfect: the TV faces +X while the sofa opens +Y,
so they are not arranged for sofa-to-screen viewing. This batch preserves
layout/save behavior; it does not claim to fix seating interactions or layout.

Browser setup failures were not game defects. Help intercepted the first pause
click; a proof that replaced the live DOM broke the running UI; and an outdated
assumption treated the lighting button as a select. A fresh-context review
confirmed the control contracts. The successful GPU proof uses its own HTML
document; the successful production proof leaves the game's DOM intact.
Every owned browser context closes in a finally block.
Both task-owned preview servers were stopped after verification.

## Preservation and verification

Atlas: 1,270 records, 8192x4267. SHA256:
`406d0c726fbc61b8b1fda9d3fcb3edcf9af6a76f09351feba24537b030910381`.
TV indices 1262..1265; radio 1266..1269. All 1,262 preceding decoded crops,
names, dimensions and densities retain prefix digest
`a573c237c978642df26f5cc057fd2541085129c5a5be43535e9130df4db91ea1`.
Packing coordinates may change; decoded historical sprites must not.

Before/after release-WASM initial save bytes have the identical SHA256
`0750a0db68fcf8040ace390d8a22c4cb2c0044d2108e0f12f31c25ce4700dac4`.
Historical save fixtures also load through the production bridge tests.

1. All 1,336 web tests in 95 files pass, including 14 new media tests.
2. Rust workspace run: 106 core, 267 data, one integration and 692 sim tests
   passed; the remaining sim test correctly rejected its obsolete expected
   radio/TV indices. Updating only those two expectations made that focused
   test pass. All 147 WASM tests then passed. Total: 1,214 passing tests across
   the workspace run and the scoped correction/completion runs.
3. Rust formatting, clippy, release WASM, TypeScript and Vite build pass.
4. All 93 sprite tests and eight living-model tests pass.
5. Deliberately restoring the old TV light prefix caused five test failures;
   removing NW caused one; making radio emissive caused four. Each run exited
   1. Restored lighting source digest before/after:
   `2ba8574c4d6e925e266e3e8356a48cfcc9c446ced41169a848e9bbf07149be57`.
   All 22 restored lighting tests pass, exit 0.
6. Changing one historical sprite pixel in memory makes the prefix test fail;
   restoring the unmodified reader passes. No image bytes were changed on disk.
7. A clean export of staged tree `64daa00a6bd7ba7457fc45b936d8de786bcee4f4`
   passes the atlas freshness check, all 93 sprite tests and eight living-model
   tests without ignored originals. Both objects' source, render and model
   hashes match the retained proofs in that export.
8. Final independent review confirms all 1,262 historical decoded crops and
   non-packing metadata are unchanged, including anchors and interaction maps.
   The eight new crops exactly match the reviewed importer output. Parsed
   content differs only in the two sprite names. The review caught a weaker
   queued-action assertion in the retained helpers; both now require the
   requested action at index zero. All 14 focused media tests and TypeScript
   pass after that correction. The corrected 24-scene GPU helper also passes
   with empty validation/page-error lists, both requested actions active,
   visual action zero and interaction target 4294967295.

Local acceptance, source merge and public deployment are separate facts.
No claim that GitHub Pages is serving this revision follows from these local
checks. Release state belongs in the delivery report.
