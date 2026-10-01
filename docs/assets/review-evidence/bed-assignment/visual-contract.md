# Evidence for the occupied-bed export pilot

The proposed reuse of body and furniture colour is still an experiment. The
accepted lower-bunk images already reject exact pose-independent furniture RGB.
They do not establish an unacceptable approximation for the double bed, which
has no accepted two-person pose or joint-render comparison yet.

## Accepted source comparison

An independent reviewer traced the existing material and export paths, then
compared accepted green furniture samples 0 and 3. The root comparison reproduced
the measurements using Pillow alone and verified every input against the
accepted receipt. `bunk-colour-comparison.json` retains image paths, hashes,
dimensions and metrics. No render was started and no asset was changed.

| Facing | Raw common opaque interior | Different RGB pixels | Maximum channel difference | Exported different pixels | Exported maximum |
|---|---:|---:|---:|---:|---:|
| SE | 354,671 | 755 | 5 | 52 | 2 |
| NW | 348,932 | 574 | 5 | 37 | 2 |
| SW | 350,496 | 528 | 2 | 35 | 1 |
| NE | 355,137 | 103 | 1 | 4 | 1 |

Differences are 8-bit PNG channel values, not linear-light error. Raw pixels must
be fully opaque in both images throughout a 9 by 9 neighborhood; exported
pixels use a 3 by 3 neighborhood. Image boundaries count as transparent. These
are separate measurements at different resolutions, not the same pixel set.

A genuine coverage multiplier is one at fully opaque pixels. One reusable RGB
image multiplied by that coverage cannot produce both measured colours. Changing
alpha to imitate darkening would no longer represent visibility correctly.

The accepted receipt does not contain an identical-state noise control. This
comparison proves unequal RGB regardless of its cause; it does not attribute
each difference to moving geometry, quantify perceptual harm, or prove that a
second sleeper necessarily casts a visible shadow.

Run from the repository root, with a receipt whose referenced raw PNGs exist:

```powershell
python -B docs/assets/review-evidence/bed-assignment/compare-bunk-colours.py D:/VIBES/.worktrees/terrilives/bike-chair-four-facings/assets/models/bedroom/bunk-reviewed.json
python -B -m unittest discover -s docs/assets/review-evidence/bed-assignment -p test_bunk_colour_comparison.py
```

The raw images currently reside in the visual owner's worktree. This command
only reads them. The receipt and exported files also exist in this checkout,
but its raw PNGs are absent. No dependency was added; Pillow is existing asset
tooling. A zero exit status means the measurement ran, not that colour reuse
passed. The comparison command exited zero and reproduced the table; the four
counterexample tests passed with exit zero.

## Existing rendering contract

`assets/models/sims/sim-01/shirt-source-materials.json` records a Diffuse BSDF,
Shader to RGB, Color Ramp and Emission chain (lines 1324-1328). Furniture copies
that material in `assets/models/furniture/build_parts.py`. The hair material
also uses ambient occlusion (links at lines 96-102, distance at line 187).
These are possible sources of scene-dependent colour. They do not prove colour
bounce is enabled or measure the effect of a second sleeper.

`assets/models/furniture/animation_export.py::render_pass` keeps both object
collections present with reciprocal holdouts. The bunk contribution runner
renders each pose and palette; `assets/models/bedroom/export_bunk.py` retains
their RGB, encodes the contributions, and compares the reconstruction with a
separate beauty render. `layer_partition.py` premultiplies RGB and resamples
channels separately. It does not replace scene-specific RGB with coverage.
Existing reconstruction tolerances are nonzero.

## Required next experiment

After the independent pose-clearance gate, use one facing with maximum overlap,
fixed camera and render settings, and independently owned contrasting shirt
materials. Render sample pairs (0, 0), (0, 3), (3, 0), (3, 3), either lane alone
at samples 0 and 3, and empty. Repeat one identical joint state as the noise
control. The current shirt-variant helper edits globally named materials, so
independent colour control for two people must first be demonstrated.

Retain full-scene beauty, per-scene owner RGB contributions, genuine coverage
and outlines. Compare both reused-colour and per-scene-colour reconstructions
with the same beauty reference. Measure opaque interior colour separately from
partial edges after the real export resampling, as well as outlines and contact
regions. This separates possible colour-reuse error from holdout/reconstruction
error. Do not introduce an unreviewed tolerance or call a shading residual
"visibility."

The established fallback retains per-scene RGB contributions. If the pilot
proves RGB independence from the other occupant's shirt palette, including for
furniture, and palette-independent outlines, four facings require up to 480
body contributions, 96 furniture contributions and 96 outlines before crop and
deduplication. The 480 body count comprises 384 double-occupied and 96
single-occupied contributions. Empty beds reuse existing sprites. These 672
images are a conditional estimate, not a selected format. Without that palette
independence, the count can grow further. Cropping, deduplication and any shading
residual all require measurements before committing to an atlas budget.
