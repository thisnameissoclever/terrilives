# Approved Sim: rig and sprite animation

The owner approved the small-front-curl model on 2026-09-09 and authorized
local rigging, animation and game integration. This document describes work in
progress, not a shipped feature. No further model generation or paid requests
are needed for this stage.

## Source and scope

Use `assets/models/sims/sim-01/source/approved-neutral.blend`. Preserve its
neutral geometry and approved face, hair and clothing. Hair, shirt and pants
remain separate material regions for later recoloring. One skeleton drives
named actions; never generate another model for each animation frame.

The same appearance may represent every Sim while testing. Entity identity,
simulation actions, saves and object interaction rules do not change. Future
hairstyles and a recoloring interface are separate work.

The authoring worker owns `assets/models/sims/sim-01/`. Integration and
documentation changes have one separate editor. Both work in
`D:/VIBES/.worktrees/terrilives/rigged-sim-animation`; the original checkout's
uncommitted work is preserved. Background Blender is authorized. Foreground
computer interaction still requires separate permission immediately beforehand.

## Export contract

1. Render idle, an eight-sample walk and seated reading first. These expose
   knee, shoulder, elbow, hand contact and neck problems before a larger batch.
   A pilot is not a substitute for the remaining game actions.
2. Render four actual model rotations. Runtime facing order is SE (+X), NW
   (-X), SW (+Y), NE (-Y). Preview filenames alone do not prove this mapping:
   check the projected nose and chest against the game's world axes.
3. Retain full-resolution renders in `review/`. Export native RGBA PNG frames
   in `export/`, with their antialiased alpha intact. Clip-specific canvases
   preserve physical scale: the initial idle canvas is 38 by 88, while walking
   and seated reading use 52 by 104 to contain their limbs and props. Record
   the projected model origin and compute the physical pixel anchor as
   `[originX, originY + 21]`, matching the game's half-tile drop. The measured
   anchors are approximately [19, 100] and [26, 108], respectively. Anchors
   may be fractional and outside the crop; this is valid ground registration,
   not an instruction to move the model. Share the resulting offset between
   drawing and picking. Socket-bound actions must preserve world scale and
   contact points; do not shrink every action to conceal clipping.
4. `export/manifest.json` records schema version 1, dimensions, anchor, clips
   and individual frames. A clip declares `frame_count`, `sample_fps`, `loop`,
   `source_action`, its dimensions and physical anchor. A frame declares
   `name`, `action`, `facing`, zero-based `frame`, relative `path` and SHA-256
   of its PNG bytes. Eating frames also record `hand_anchor` in native image
   coordinates, so runtime food follows the same selected body sample.
   `hand_in_front` records the camera-space depth decision: a far meal must
   sit behind the body, not appear on the back of the head.
5. Names use `rigSim` plus the action stem, facing and sample, such as
   `rigSimWalkSE0`. The importer orders actions explicitly, then runtime
   facings, then samples. Every declared clip needs all four facings and every
   sample. Reject missing files, changed hashes, name collisions, out-of-folder
   paths and wrong dimensions. A required-clip gate prevents publishing a
   partial pilot as a complete character.
6. Append records after the existing 360 sprites. Never renumber old content
   or replace legacy pixel expectations to make a failed baseline pass.
   Select the new appearance through presentation code only after its required
   actions and attachment contracts pass review.

## Motion and visual checks

1. Walk timing follows travelled world distance, not wall time. More than two
   samples requires direction-aware phase; test negative-axis movement,
   corners, pause, reduced motion and save/load reconstruction.
2. Other actions use simulation ticks and explicit clip timing. Idle breathing
   must not move the feet. Reduced motion holds an appropriate action pose.
3. Examine full-size and native-size sequences in all facings. Trace joint
   outlines, cuffs, hair attachment, foot contact and prop contact. Changing
   pixels does not prove a walk; the limbs must articulate plausibly.
4. Obtain an independent adversarial visual review before requesting owner
   feedback. Save the images and specific defects rather than describing a
   failed result as complete. After three similar failures, reconsider the
   approach with a fresh-context better-way reviewer.
5. Seated, sleeping and exercise poses must also pass in-game socket and
   occlusion checks. Food must follow the hand without a duplicate baked prop.
   A clean Blender contact sheet cannot establish these runtime properties.

## Verification commands

### Approved household palettes (2026-09-10)

The owner approved the existing character and requested that every household
Sim use it: Tim wears blue, Bill retains the approved green, and Casey wears
red. Their face, hair, body, trousers and animation poses remain shared.
Select the palette using the persistent Sim ID from the render buffer, never
the entity index, render-row position or animation phase. The current authored
household IDs are Tim 0, Bill 1 and Casey 2. Unnamed/new Sims use green.

Keep the original green exports and saved rig unchanged. Render blue and red
from the same saved actions, camera and registration data. The approved toon
shader derives its visible color from a four-stop Color Ramp; change only
those RGB values on the three shirt materials, retaining the graph, alpha,
stop positions and interpolation. Transform each palette from the immutable
original, not from a previously recolored variant. Geometry and material
preservation checks supplement, but do not replace, visual inspection.

Each palette owns its native frames and manifest. The importer requires equal
clip registration and timing across palettes and validates every PNG hash.
Runtime body drawing, picking, bubble placement and held-food attachment must
sample the same named palette. Atlas records remain append-only; packing may
widen the texture to keep both dimensions within the renderer's supported
limits. A remaining legacy action is a migration gap, not another approved
appearance, and must be addressed before claiming all Sims are migrated.

The owner has authorized live publication of this batch after verification.
That does not waive CI, the played visual pass or the separate boundary around
taking foreground computer control. Record the actual deployed commit and
live verification evidence when publication completes.

### Current three-palette integration

Each palette has 148 base frames and eight supplemental exercise frames.
All ten actions use the approved character, including cycling. The atlas has
836 records at 1024 by 4596 pixels. Original indices 0 through 359 are stable;
eight chair foregrounds precede the appended model frames.

The separate exercise source preserves the original rig and source images.
Its two poses hold for eight simulation ticks each. To fit the approved head
and arms, only the bike bar/console assembly moves 25 screen pixels down,
retaining its original horizontal extent. The saddle, pedals, base, footprint and persistence key do not
change. SE contact passes the offline review; the other three bike facings
fail because the bike artwork mirrors rather than rotating in three dimensions.
Do not use those rotations as accepted furniture-contact examples.

Current checks and played findings are recorded in
`../assets/review-evidence/sim-01/2026-09-10-shirt-verification.md` and
`../alpha-feel-notes.md` under `[A-household-rig-shirts]`.

### Earlier single-palette checkpoint

This earlier checkpoint used nine clips and 148 native frames, plus eight
chair foreground records. Existing sprite indices 0 through 359 remain stable.
All Sims use the approved appearance except cycling, which explicitly retains
legacy sprites while the owner decides whether to replace the inconsistent
bike art. That is an unfinished migration, not a completed animation suite.

The ordinary armchair's default seat faces SW, matching its +Y opening. Both
chair types expose their physically near surfaces through the existing
foreground column. No height-cut mask or new simulation component is used.
The NW/NE wingback composites still expose a small isolated wing fragment over
the upper shoulder, despite the torso clearing the wing in model coordinates.
Those rotated chair combinations remain an open visual defect. The shipped
SE reading placement does not show that fragment.
The lower-bunk SE composite passes basic registration and foreground checks;
its folded-knee posture is visibly cramped. Other bed orientations have not
passed furniture-contact acceptance merely because the Sim has four rotations.

The background preview/browser launch was rejected by the execution policy.
Do not record a played browser pass or deployment from offline composites and
unit tests. No foreground computer control was used.

Saved-file validation proves normalized weights, neutral shape preservation,
loop closure and physical contact landmarks. Exact render replay remains
incomplete: idle, walk and eating samples reproduce, but the reading sample
differs by at most 3/255 in RGB with identical alpha. A fresh-context review
identified duplicated render-job state ownership; the implementation now shares
one complete job setup and lets keyed drivers own visibility. The bounded
recheck still found the same color drift. The failed proof is retained in
`saved-rig-render-replay.json`; no tolerance relaxation, warm-up sequence or
claim of exact reproducibility has replaced it.

### Earlier single-palette mechanical verification

All commands below ran in the implementation worktree and exited 0:

1. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`:
   21 tests passed, including alpha preservation and chair source-pixel checks.
2. `python -B -m unittest discover -s assets/models/sims/sim-01 -p 'test_*.py'`:
   10 model/export tests passed.
3. `python -B assets/sprites/gen/build.py --check`:
   516 sprites, 512 by 5234, current atlas confirmed.
4. From `web`, `node node_modules/vitest/vitest.mjs run --maxWorkers=1`:
   526 tests passed across 36 files.
5. From `web`, `node node_modules/typescript/bin/tsc --noEmit` and
   `node node_modules/vite/bin/vite.js build`: typecheck and production build passed.
6. `cargo test -p terri-data --locked -j 2`: 182 tests passed.
7. `cargo test -p terri-sim render_buffer::tests --locked -j 2 -- --test-threads=2`:
   51 focused render-buffer tests passed; 274 other tests were not run here.
8. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --mode no-install -- --locked -j 2`:
   browser WebAssembly rebuilt successfully without dependency changes.

These passing checks do not supersede the visual and replay failures above.

Run from the implementation worktree using its existing Python environment:

```powershell
python -B -m unittest discover -s assets/sprites/gen -p test_offline_sims.py
python -B -m unittest discover -s assets/models/sims/sim-01 -p test_rig_math.py
python -B assets/sprites/gen/build.py --check
```

Report command exit codes separately. Atlas freshness, source geometry checks,
animation visual review, played local acceptance and deployed acceptance are
separate results. Do not mark the entire feature shipped from a passing unit
test or static image.
