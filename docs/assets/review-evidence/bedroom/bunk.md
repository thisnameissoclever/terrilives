# Lower-bunk replacement

Candidate 02 preserves the existing one-slot sleep interaction, centered socket,
SE placement, 2x1 footprint and approved Sim rig. It uses the established
object-centered composite renderer. The former `bedBunkForeground` mapping is
removed; its sprite remains unchanged for legacy coverage.

## Geometry and source review

Primary and independent reviewers accepted the source and sixteen occupied
views at 91/100, a subjective visual score. The warm oak frame has two supported
mattresses, grounded posts and ladder, and a supported upper guard. The lower
bunk has a sage fitted sheet, not a flat blanket cutting through the sleeper.
Candidate 01 and its rejected occupied pilot remain retained.

The immutable Sim's folded sleep pose is translated by (0,-0.50151527,0) in the
authoring scene and rotated with the bed. No body scaling, mesh edit or action
rewrite is applied. This proves a clothed folded-pose nap, not full-extension
adult fit, upper-bunk use or a cloth simulation.

All four samples pass evaluated-vertex checks against thirty obstacles. The
checker requires the exact structural inventory and rejects unhandled visible
geometry. Contact reports include 149 torso samples, 82 on each sole and 305
head/pillow samples with nonzero footprint spans. Soft-bedding tolerance is
-0.025 to +0.01 world units; head/pillow compression reaches about 0.012.
Three displaced bedding/platform checks and four saved-scene support mutations
fail as intended; clean scenes pass with unchanged source hashes.

## Export and validation

`contributions-02` contains 196 originals: four empty views and 48 groups of
independent beauty, visible body, furniture and shared-outline renders. Each
group corresponds to one facing, sample and shirt color. All 48 reconstructed
groups pass the pre-existing error limits; observed maximum channel error is
23 and maximum 95th-percentile error is 10 on an 8-bit scale. Bed/outline bytes
and geometry coverage remain identical across shirt colors.

Batch 01 passed image checks but was superseded after review found missing
Blender-build validation on resume. Original helper files remain in that
directory. Batch 02 rendered afresh under the corrected guard. All 196 decoded
images match batch 01 exactly; PNG file bytes differ because of metadata.

The export keeps two physical texels per logical pixel. A verified empty-margin
crop changes the texture from 320x352 to 200x272 and the logical anchor from
(80,144.00044) to (50,124.00044). Every discarded alpha value must be zero.
The 76 added records occupy 1137 through 1212; atlas size is 4096x7848.
All 1,137 previous records retain exact metadata except packed X/Y and exact
decoded pixels, including the corrected fridge. Their regression hash is
`0f83ad823c288923f6cf7d13b4ef8db1e655a0a511286426920c1e3873f84336`.

The build requires `bunk-reviewed.json`. Its hashes bind the manifest, completed
raw proof and full comparison report. Atlas import verifies exported bytes,
render dependencies, comparison implementation, registration and coverage.
Full local generation acceptance additionally requires and hashes all 196 raw
images. These are separate named entry points, never an automatic fallback
when a file is missing. Originals remain local under the existing render-storage
policy; CI checks the accepted export and deterministic atlas assembly, not
fresh Blender rendering. Tests exercise both gates and deliberately change
each binding, a dependency, an image and the encoder.

## Played and GPU evidence

`bunk-played.png` shows Bill sleeping in the actual room at Day 1 02:07.
`bunk-close.png` records ordinary wheel zoom. Independent review accepted the
observed SE fit beside the desk and standing Tim. The foreground room wall
hides some lower structure; it cannot prove all foot contacts on its own.

`bunk-four-facing-gpu.png` shows sample 2 in all facings and colors using the
actual GPU renderer. Validation scope returned null and no uncaptured errors
were observed. SE/NW match the fixed two-tile floor strip. SW/NE are source
rotations, not supported rotated gameplay placements; the screenshot deliberately
does not invent a rotated gameplay footprint.

Normal controls selected Sleepeazy Deluxe > Sleep. Bill entered Sleeping by
02:07; pause held 02:08 during inspection. After resume, he returned to Walking
by 04:20. Energy changed from 80 to 99.9; comfort from 91.7 to 86.6. No claim of
increased comfort is made. Automated production-WASM tests additionally verify
exact target binding, body picking, frozen frames without ticks, reduced-motion
sample zero, mid-sleep Save/Load replay, absent obsolete foreground and cancel.

The played build served `index-BT8Ylmgg.js`, `terri_wasm_bg-BHPpwU9y.wasm` and
atlas `97fd1e00c71311e5dd439625b570211c9d0c4015ff842aa2c4118cae510cdd8d`.
The only observed console error was a missing `favicon.ico` (404). The existing
invalid zero-byte browser save fixture was left untouched. Save/Load evidence
here is the production-WASM test, not a browser storage acceptance claim.
Both dedicated review tabs were closed after inspection.

## Checks and publication

Local checks passed: 689 Rust tests, 707 web tests, typecheck, WASM compilation,
Vite production build, twelve bedroom Python tests and 61 sprite tests.
Full gate mutations and exact-prefix comparison passed. Publication must
be recorded separately after merge, exact-head CI and live verification.

A staged-only export, with no ignored raw PNGs, also passed atlas freshness
(1,213 sprites, 4096x7848) and all 61 sprite tests. The first clean-checkout
attempt exposed Git line-ending conversion in signed JSON. Scoped `-text`
attributes now preserve those bytes; the index was re-normalized under the
new attributes before the successful check. No acceptance hash was changed.
