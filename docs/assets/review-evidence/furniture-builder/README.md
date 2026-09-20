# Furniture builder: played verification

Local implementation checkpoint: `b051734`, 2026-09-20. Public deployment is
still pending. All browser actions used the disposable origin
`http://127.0.0.1:4191/?stress=0`; the public saved household was untouched.

## Preview and controls

The corrected preview bundle was `index-kO73rBU8.js` with
`terri_wasm_bg-Bf2CONbM.wasm`. Its actual desktop and 390x844 phone views were
inspected after the first visual pass found overlapping old chair/table art.
Valid intersecting previews now replace only that object's presentation;
Cancel restores it and does not change save bytes. The original position
marker remains visible. A lighter tint retains furniture detail.

`table-mobile.png` shows the rectangular table preview at `(2,2)`, SW, 1x2,
with touch-sized controls, explicit Household paused status and compact touch
instructions. Desktop keyboard, native Confirm activation, Help/Tab/Escape,
unsupported aquarium rotation, invalid placement, Save/Load and camera drag
and wheel zoom were played. Reduced motion and evening lighting were inspected.
Native pinch was not played: this browser's automation does not support touch
dispatch. Existing touch-pointer tests are separate evidence.

## Rebuilt game and interactions

Final local bundle after the reviewed Rust cleanup:
`index-D9jh9BcD.js`, `terri_wasm_bg-DwfFooPr.wasm`,
`save-worker-BusLFi6F.js`. The served build was frozen throughout this pass.
Ordinary game menus issued actions; read-only activity/clock observations helped
pause on short-lived poses without directly stepping the simulation.

1. Bill reached the saved SW reading chair. At tick2937, the HUD said Reading
   and the seated body, book and chair arms lined up. `reading-sw-night.png`.
2. Casey reached the saved SW bike. At tick3077, activity9 (Exercising) matched
   the displayed pose; Tim and Bill both had activity4 (Talking) beside the
   desk. A second observed pedal phase was captured at3083. `bike-sw-night.png`.
3. Cycling completed at3126, with no queued order remaining. Casey's displayed
   fun rose from83.6 to96.1 and satisfaction from21 to23. UI Save at3083 and
   confirmed UI Load restored3083, the active bike pose, facing1 and funds240.
4. Build moved table7 from `(2,3)`, 2x1 SE to `(2,2)`, 1x2 SW at3083. Actual
   placement result succeeded, lot revision advanced2 to3 and time stayed3083.
   Bill then reached and used it at3128. The table still uses the generic
   standing interaction; proper dining-seat animation remains unfinished.
5. After these edits, Tim's departure opened at3303; the inspected opening was
   at3304. He was at work at3310. The door subsequently closed. Return opening
   was observed at3785, and at3790 he crossed with funds increasing240 to360.
6. UI Save at3790, advance to3813/closed, and confirmed UI Load restored3790,
   open state2, funds360 and SW facings for table7, bike22 and chair26.
   Completing the crossing again to3812/closed left funds360.
   `edited-return-restored.png` shows the restored crossing.

The final saved primary was2827 bytes, SHA256
`1f08147e16ef17ee87a850e9a254b4660dc9ba8b12bdd1de0b7cd585daab0fb9`.
The V2 recovery backup remained2781 bytes with its original SHA256
`c9325dd26c71b0be2495d71054a82539ba0b276c7aa9bd565b9ae57919a7c8c0`.
Browser warnings/errors were empty. Test tabs and preview servers were closed;
temporary viewport and reduced-motion overrides were reset.

## Automated checks

1. Native workspace:871 passed (92 core,225 data,1 integration,462 simulation,
   91 WASM). Strict Clippy, formatting, documentation IDs and diff checks passed.
2. Release WASM generation and all91 native release-mode WASM tests passed.
3. Against regenerated bindings: TypeScript passed;815 browser tests across
   66 files passed with one worker; production build passed. Native compilation
   did not overlap the atlas-inclusive browser suite.
4. The immutable placement sweep tested155 mutations:131 caught,18 missed,
   six unviable and zero timeouts. All17 distinguishable misses subsequently
   failed exact regression probes. One equivalent duplicate bounds check was
   removed after independent review. This is focused causal evidence, not a
   claim that the original sweep was green. Full exact-head CI remains a gate.
