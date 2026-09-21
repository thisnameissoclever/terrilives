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

After integrating front-door `69c0052`, a fresh native workspace run passed all
881 tests (95 core, 226 data, one data integration, 468 simulation and 91 WASM).
Formatting, documentation IDs and the merge diff check passed. Independent
review found no loss of V3 facing-before-geometry validation in the merge.

The final spawn-boundary correction from `c441f3f` then passed 883 native
workspace tests and all 93 unfiltered release-mode WASM-boundary tests.

## Main's wall-depth correction

Main's `1d4b9ed` wall-plane renderer was integrated before release. Its instance
rows grew to ten floats; builder and preview tests now use the shared stride
instead of literal eight-float offsets. Sentinel checks prove all preview rows
clear wall-only projection fields. Removing either writer assignment separately
failed the corresponding assertion; the original source SHA256 was restored.
TypeScript, all 819 browser tests across 67 files and the production build passed.

The frozen `index-CqDpBPu4.js` / `terri_wasm_bg-BnbcxhuJ.wasm` production bundle
was played again. Load restored the edited open-door save at 3790. Desktop and
390x844 views showed a clean NW table preview; the compact Confirm placed it
without advancing the clock. Load discarded that unsaved test edit. The
restored crossing completed at 3795, with funds still 360 and correct door/body
depth. Nearby fridge and laundry silhouettes retained main's correction.
`wall-depth-builder.png` and `wall-depth-mobile.png` record the preview.
Warnings/errors were empty, the viewport was reset, and the tab and server
were closed. The public household was untouched. Exact-head CI and Pages remain
release gates.

## Socket-validation follow-up

The first release wakeup consolidated duplicated authored/rotated bounds checks
without changing their call order or error details. Three shared OR mutations
failed assertions; removing the direction caller failed a compiler test with no
lot placement. The restored source passed 885 native tests, strict Clippy,
formatting, TypeScript and all 819 browser tests. No mutation allowance changed.

The regenerated production bundle `index-CNlwmRfW.js` /
`terri_wasm_bg-Bd_X_DVp.wasm` was played on the disposable 4191 origin.
UI Load restored tick 3790 and funds 360. The NW table preview remained clean;
Confirm placed it while paused. Load discarded the unsaved edit. The restored
return closed the door at 3795 with funds still 360; the Sim stood inside the
entry and the nearby furniture retained correct wall depth. Warnings and errors
were empty. The test tab and server were closed; public saves were untouched.
Exact-head CI and post-merge Pages verification remain outstanding.

## Export-boundary follow-up

Main's deployed door merge `d26b60e` was integrated at `0fd81ab`; the merge
changed no builder source. Four additional WASM-boundary tests caught the exact
V1 truncation, missing foreground, facing-shift and revision mutations. One
equivalent OR/XOR expression became a sum of unique direction bits. No baseline
allowance changed. Independent review passed. Restored verification passed 889
native tests, all 97 release-mode WASM tests, strict Clippy, formatting,
TypeScript, all 819 browser tests and the production build.

The rebuilt `index-BvV0TBxn.js` / `terri_wasm_bg-CfFbLFMP.wasm` was played on
disposable origin4191. The NW table preview was clean; Confirm changed revision
1 to2 while tick3863 stayed paused. UI Load restored tick3790, funds360 and the
edited SW table. The restored open door and returning body retained correct
layering. No warnings/errors appeared. Tab17 and server91068 were closed.
Public gameplay was not used for this builder check. The separate door live
check's autosave incident is documented in its evidence and lessons learned.
