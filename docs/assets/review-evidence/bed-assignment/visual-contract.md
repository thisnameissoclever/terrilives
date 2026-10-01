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

## Pose constraints after the rejected arm diagnostic

The visual owner and independent visual review rejected the phase-zero outer-arm
image: elbows appear held up and the right wrist sharply bent. Root inspected
the same image, SHA-256
`b2f86a30920d7342150a6278a51fe1d1d35038e5c8c12cd924d1a0e050131313`,
at `output/double-bed-outer-arm-inspection-01/unapproved-outer-arms-SE.png`
in the visual worktree. Passing lane and crossing screens did not make it a
natural sleeping pose. Same-arm attachment pairs also remained unresolved.

Fresh adversarial review identified three distinct restrictions. The diagnostic
froze both wrist positions and complete hand rotations, searched only elbow
heights at or above wrist and shoulder, and selected against a 0.69-wide lane.
The chosen left and right branches were limited by lane margins of approximately
0.00004628 and 0.00000486 respectively, while forearm and cuff gap residuals
were positive. These results are in
`output/double-bed-arm-clearance-02/status.json`, SHA-256
`3b98c75080ba926db98a29ca9165ce64ed1ef9521dc84b7fc5804d29b6a4e902`.

An independent direction-only calculation used the recorded elbow circles and
the nominal hand axis from `build_rig.py`, transformed by the recorded contact
rotation. The minimum directional wrist angles were approximately 3.94 degrees
left and 27.33 right over each complete circle. Restricting to the chosen upper
arc left the first unchanged and raised the second to 33.24 degrees; the posed
right wrist measured 48.31 degrees. An analytic circle extremum agreed with
10,000 sampled directions per arm. The source contact receipt hash is
`62b5e149a49668e589bc7a37143fc9773981e6a09d2d77c53cccb0fdd7a77aca`.
This calculation excludes twist, evaluated meshes, collisions and comfort; none
of these angles is an acceptance threshold or proof of a viable alternative.

The spec now distinguishes physical fit from conservative lane construction.
Preserve body data, bed footprint, support, collision and walking-space rules.
Record lane bounds without treating them as a necessary shape for every part.
Do not simply widen the threshold to accept the rejected pose. The next bounded
family places supported hands beside the hips and solves contacts and complete
arms together; its feasibility is still unproved. Inspect a credible phase-zero
silhouette before repeating full certificates, then establish all samples and
two-body separation before advancing to the export pilot.

If actual bodies cross the assumed X intervals, joint owner coverage must
replace global near-lane picking. The current renderer admits one owner per
object, and current picking uses rectangles. A future bed group therefore needs
both logical Sim rows, three owner contributions, registered CPU ownership
coverage, and explicit rules for partial pixels and outlines. Each person must
remain visibly selectable, and furniture must still draw once. None of those
renderer changes or their costs is accepted by this geometry-contract revision.

## Relaxed-pose fit decision, 2026-10-01

The visual owner's final relaxed-leg diagnostic and independent review withdraw
the earlier folded-leg visual pass. The more natural slight-bend pose measures
2.03865 along the mattress axis, versus the unchanged 1.86 mattress. Its
0.17865 excess cannot be removed by translating the body. The previous pose
bent each knee approximately 133 degrees; further certification of that family
has stopped. This does not prove every possible natural pose impossible.

The completed receipt is
`output/double-bed-relaxed-legs-inspection-01/status.json` in
`D:/VIBES/.worktrees/terrilives/bike-chair-four-facings`, SHA-256
`ca80884c40789e0cc86d8927808ac936f69a9b36490f150e21fcefdcae80ea53`.
Its adjacent `visual-review.md` records source-byte and approved-data preservation
and the SE/SW image review. These are failed-fit diagnostics, not accepted art.

The visual owner has asked for approval to lengthen the bed and reserve a 2x3
footprint while preserving the Sim. That decision and final dimensions remain
pending. Runtime dimensions, content, navigation, saves and the starting layout
remain unchanged. A conditional runtime impact review may prepare the change;
it does not authorize a migration or a new footprint. Do not hide unsupported
overhang, shrink the Sim or render into unreserved walking tiles.

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
