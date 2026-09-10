# Shared Sim rig

`source/approved-neutral.blend` is the accepted body, face, clothing and Tripo
hair. Its SHA-256 is
`a90fd5be6c2c60b89216d4881b9f4265a45fb662d913299daa12cc3b247d9ece`.
The original inputs remain unchanged. This work uses local Blender actions;
it makes no asset-service calls and purchases nothing.

`sim-01-rigged.blend` contains one 17-bone armature. Every visible body part
has normalized vertex weights and an armature modifier. The face and hair are
rigidly attached to the head bone. Arms and trousers deform before their
original subdivision surfaces. Rigid bevelled details retain their evaluated
accepted geometry so baking object scale cannot change their bevel thickness.
Material names remain separate for hair, shirt, trousers and skin.

## Household shirt variants

Tim uses blue, Bill retains the existing green frames, and Casey uses red.
`render_shirt_variants.py` opens the same saved rig without saving it, selects
its existing actions through `render_job.py`, and changes only RGB values in
the four-stop Color Ramp of these three materials:

1. `Washed sage overshirt`: the body and sleeves.
2. `Sage seam and cuff`: the seams, pocket, placket and cuffs.
3. `Sage folded collar fabric`: the collar leaves.

The shader is Diffuse BSDF -> Shader to RGB -> Color Ramp -> Emission. The
Emission color is linked, so changing its unused default does not recolor the
shirt. Each ramp stop keeps its original per-channel stop/base shading ratio;
positions, interpolation, alpha and every non-shirt material remain unchanged.
This preserves the authored shading structure, not constant perceived brightness.
Blue's linear base RGB is [0.045, 0.18, 0.38]; red's is [0.40, 0.06, 0.045].
The script declares darker seam and lighter collar targets separately.

Use the background launcher command below with `render_shirt_variants.py` in
place of `build_rig.py`, adding `-- --preview` for two front-facing idle views
per color. Wait for `shirt-variants-preview-status.json` to report `complete`,
then run `python -B assets/models/sims/sim-01/export_shirt_variants.py --preview`.
The comparison is `review/shirt-variants/shirt-color-contact-6x.png`.
For all nine actions, omit `-- --preview`, wait for
`shirt-variants-batch-status.json`, and run the exporter without `--preview`.

`export/blue/manifest.json` and `export/red/manifest.json` retain schema 1 and
add their `variant` name. Each contains 148 native RGBA frames, with names
prefixed `rigSimBlue` or `rigSimRed`. Clip geometry, physical anchors and eating
hand/depth metadata are copied from the green manifest. Native alpha must match
the existing green frame exactly. The batch proof records unchanged evaluated
geometry, camera and visibility per frame, unchanged mesh topology and material
assignments, the exact material changes, and hashes proving that the saved rig,
green manifest and all 148 green PNGs remain byte-identical.

Run `python -B -m unittest discover -s assets/models/sims/sim-01 -p test_shirt_variants.py -v`
to check the ramp calculation, complete exports, alpha, metadata and source
preservation. These checks do not resolve the exact saved-rig reading RGB replay
failure documented below, or add an exercise action to the nine-action rig.

## Supplemental bike poses

`build_exercise.py` reads `sim-01-rigged.blend` and writes a separate
`sim-01-exercise.blend`. It adds two opposite crank positions using the same
17-bone rig and unchanged mesh/material assignments. Each pose holds for eight
simulation ticks: two samples at 1.25 samples per second. This preserves the
existing two-position action, not a smooth eight-sample cycling animation.
The original nine-action rig, manifests and native PNGs remain unchanged.

The first two SE previews were rejected because the original high, narrow
handlebars placed both hands beside the approved model's head. Their evidence
remains in `review/exercise/pilot-v1/` and `pilot-v2/`. A third fit moved the
assembly 18 pixels forward and nine down. It passed the isolated composite but
crossed the divider in the played scene; `pilot-v3/` preserves that rejection.
The corrected `_bike` moves the original bar fork, tips, console and screen
zero native pixels horizontally and 25 down. The lower attachment [9,-45], frame, saddle, crank, pedals,
flywheel and mat stay fixed. Coordinates here are relative to the bike's bottom
anchor. Relative to the tile centre, the reviewed grips are [-4,-17] and
[12,-18], the pedal points are [-5,8] and [-14,-9], and the projected hip centre
is approximately [0,-13.8262]. Saved-action contact checks use the actual camera
and posed bones after reopening the additive source.

The wrist solve fixes each wrist to its shoulder's anatomical side before
solving the camera-ray contact. Both saved grips are outside the torso, hips
and head, with no torso/head occluder toward the camera. The nearest shirt
surface distances are 0.0634 and 0.0885 model units. Contact residuals are below
0.0003 native pixels. `exercise-contact-measurements.json` records these checks.
The console is a 2D sprite, not a modeled 3D surface: its occupied occlusion
follows bike-before-body drawing and does not establish physical console depth.

`review/exercise/se-bike-wall-proxy-4x.png` includes the actual neighboring
divider tiles, occupied and unoccupied. `test_exercise_wall.py` checks the
saved bike at (4,11) against the wall at (5,11), then mutates only the upper
assembly back to the rejected forward translation. The old version produces
an overlap box [216,158,232,178] on the 400-pixel generator canvas; the corrected
version has no upper-assembly overlap. This negative control prevents another
isolated-contact approval from overlooking the room envelope.

Run `build_exercise.py` through the background launcher, with `-- --preview`
for the two green SE samples. Wait for `exercise-preview-status.json`, then run
`python -B assets/models/sims/sim-01/export_exercise.py --preview`. Omit the
preview flag on both commands for the 24-frame supplemental batch. Native
manifests are `export/exercise/{green,blue,red}/manifest.json`. All palettes
share the 104 by 120 registered canvas, anchors, geometry and alpha.

The shipped SE bike placement passed the offline composite review. SW, NW and
NE did not: the body makes true 3D rotations while the existing bike only
mirrors. Those composites visibly miss the saddle and grips. Inspect
`review/exercise/all-facing-bike-contact-3x.png`; four exported model facings
do not establish four accepted furniture contacts. Correcting those placements
requires matching directional bike art, not per-facing body offsets that hide
the mismatch. Runtime and owner acceptance remain separate.

## Build and verify

Use the installed Blender launcher in background mode with two threads:

```powershell
Start-Process -FilePath 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' -ArgumentList '--background --threads 2 --python-exit-code 1 --python D:/VIBES/.worktrees/terrilives/rigged-sim-animation/assets/models/sims/sim-01/build_rig.py' -WindowStyle Hidden -PassThru
```

The launcher detaches. Read `build-status.json`; a returned launcher process
does not prove completion. Failure records include a traceback. After the
status reaches `complete`, run `export_frames.py` with the installed Python
and Pillow. `--only=walk,read,stand_read` after Blender's `--` separator renders
only those clips; it still rebuilds the complete editable rig. Existing frames
must correspond to the unchanged action definitions when using a partial render.

Run `python -m unittest test_rig_math.py test_exports.py -v` for math, clip
coverage, hashes, image padding and native motion. Run `validate_rig.py` through
the same background Blender launcher for saved-file skinning, loop closure,
mesh motion, hand contact and seated floor/contact evidence. Its result is
`saved-rig-validation.json`.

## Registration and playback

The source faces local -Y, with +X right and +Z up. Game facings map to root Z
rotations SE=90, SW=0, NW=270 and NE=180 degrees. The accepted orthographic
projection produces 32 horizontal and 21 vertical pixels per horizontal model
axis unit. All clips retain that physical scale.

Idle uses a 38 by 88 canvas. Upright action and seated canvases add seven pixels
on each horizontal side and eight pixels above and below, giving 52 by 104.
The added transparent area does not scale or move the model. The build verifies
the world-origin landmark shift numerically in `registered-canvas-proof.json`.
No facing or sample is centred from its silhouette bounds.

Each clip exports its measured `world_origin` and physical `anchor`. The
renderer adds a 21-pixel tile-front offset, so anchor Y is world-origin Y plus
21. Anchors may sit outside the image. The old preview anchors 19,88 and 26,96
are not physical ground registration.

Walking travels one model axis unit per complete eight-sample loop. A planted
foot moves backward locally by the same distance that the Sim travels forward.
The hip rises at midstance and the swing toe lifts. Runtime phase must remain
distance-owned. The 10fps review loop is half game speed; the separate
`walk-loop-at-game-speed.webp` uses 20fps for the game's 2.5-tile-per-second walk.

Eating exports a per-frame `hand_anchor` in native image pixels. Food is not
baked into the body; runtime snack and dinner art use this gripping point.
Each eating frame also exports `hand_in_front`. A camera-parallel ray from the
grip tests evaluated body geometry, excluding the gripping palm, thumb and
forearm so the holding limb does not occlude its own attachment. NE samples intersect the head
or torso; SE, SW and NW grip rays are unobstructed. `food_depth.py` updates this
metadata from the saved rig without rendering images, and records named hits
in `food-depth-proof.json`. This scalar layer order describes the grip, not a
per-pixel depth map for arbitrary replacement food art.
Reading has a skinned open book. Its supporting hand belongs below the cover;
the other hand rests on the page.

Sleep uses a 104 by 76 registered canvas and an additional shared eight-pixel
upward camera crop. This preserves the same physical scale in landscape format
and gives every facing transparent padding. The root pose puts the torso and
heels on the lower mattress and the back of the head on the pillow, with folded
knees to fit the existing mattress length. The head, hips and shoes remain
planted while the hands move. Sleep-only eyelids and reading-book visibility
are driven by properties keyed in the saved actions, so selecting an action
in the editable file also selects its correct expression and prop visibility.

Seated hips use canonical Y=-0.06. That moves the upper back clear of the
wingback chair while keeping the butt inside its cushion and the feet grounded.

## Evidence boundaries

`review/` contains full-size PNGs, nearest-neighbour native contact sheets and
animated WebP loops. `review/pilot-v1/` preserves the first pilot before the
independent walk and book-support critique. Mechanical checks do not replace
played chair, prop, bed and bike contact review. Runtime integration and final
owner acceptance remain separate from the offline rig and image export.

Exact saved-rig render replay is still unresolved. `replay_rig.py` reproduces
idle-SE-0, walk-SW-2 and eat-SE-2 exactly after decoding RGBA, but read-SE-0
differs by at most 3 of 255 RGB levels with identical alpha. PNG timestamps
were excluded from the comparison. Reopening the saved file and using the
shared `render_job.py` contract with driver-owned visibility did not remove
that reading mismatch. `saved-rig-render-replay.json` preserves the failure;
it must not be described as an exact reproduction pass. No tolerance was
relaxed and no renderer warmup sequence was added. Saved mesh motion, material
identity and contact checks are separate from this failed pixel-level proof.
